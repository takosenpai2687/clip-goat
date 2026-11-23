#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { clip, errorCode, errorMessage, type ClipError, type Segment } from '../shared';

// Compiled to dist/cli, so the package manifest sits two folders up.
const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };

const HELP = `clip-goat ${version} - cut a range out of a video

Usage:
  clip-goat --input <file> --start <sec> --end <sec> [options]
  clip-goat --input <file> --segments 10-15,42.5-48 [options]

Options:
  -i, --input <file>     Source video
  -s, --start <sec>      Start in seconds (decimals allowed)
  -e, --end <sec>        End in seconds (decimals allowed)
      --segments <list>  Several ranges joined in order: start-end,start-end
  -o, --output <file>    Output path (.mp4/.mov/.mkv). Default: {name}_clip_{length}s.mp4 next to the input
      --out-dir <dir>    Keep the default file name but write it into this folder
      --fast             Stream copy from the keyframe at or before start (instant; may begin slightly early)
      --force-encode     Always re-encode, skip stream copy
      --overwrite        Replace the output file if it exists
      --json             Print the result as JSON on stdout
  -h, --help
  -v, --version

Default mode: stream copy when start sits on a keyframe, otherwise a frame-exact re-encode.
If stream copy fails, it falls back to re-encoding automatically.

Exit codes: 0 success, 1 export failed, 2 bad arguments.`;

function fail(message: string, code: number): never {
  process.stderr.write(`clip-goat: ${message}\n`);
  process.exit(code);
}

function parseSeconds(value: string | undefined, name: string): number {
  const n = Number(value);
  if (value === undefined || value === '' || !Number.isFinite(n)) {
    fail(`--${name} must be a number of seconds, got "${value}"`, 2);
  }
  return n;
}

function parseSegments(list: string): Segment[] {
  return list.split(',').map((item) => {
    const m = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/.exec(item);
    if (!m) fail(`--segments expects start-end,start-end (got "${item}")`, 2);
    return { start: Number(m[1]), end: Number(m[2]) };
  });
}

function readArgs() {
  try {
    return parseArgs({
      options: {
        input: { type: 'string', short: 'i' },
        start: { type: 'string', short: 's' },
        end: { type: 'string', short: 'e' },
        segments: { type: 'string' },
        output: { type: 'string', short: 'o' },
        'out-dir': { type: 'string' },
        fast: { type: 'boolean' },
        'force-encode': { type: 'boolean' },
        overwrite: { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    }).values;
  } catch (err) {
    return fail(`${errorMessage(err)}\nRun "clip-goat --help" for usage.`, 2);
  }
}

async function main(): Promise<void> {
  const values = readArgs();

  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (values.version) {
    process.stdout.write(`${version}\n`);
    return;
  }

  if (!values.input) fail('--input is required. Run "clip-goat --help" for usage.', 2);
  if (values.fast && values['force-encode']) fail('--fast and --force-encode cannot be combined.', 2);
  if (values.output && values['out-dir']) fail('Use either --output or --out-dir.', 2);

  let segments: Segment[];
  if (values.segments) {
    if (values.start !== undefined || values.end !== undefined) fail('Use either --segments or --start/--end.', 2);
    segments = parseSegments(values.segments);
  } else {
    if (values.start === undefined || values.end === undefined) fail('--start and --end are required.', 2);
    segments = [{ start: parseSeconds(values.start, 'start'), end: parseSeconds(values.end, 'end') }];
  }

  const showProgress = process.stderr.isTTY && !values.json;
  try {
    const result = await clip({
      input: values.input,
      segments,
      output: values.output,
      outputDir: values['out-dir'],
      mode: values['force-encode'] ? 'encode' : values.fast ? 'copy' : 'auto',
      overwrite: values.overwrite,
      onProgress: showProgress
        ? ({ percent, mode }) => process.stderr.write(`\r${mode === 'copy' ? 'copying' : 'encoding'} ${percent.toFixed(0)}%   `)
        : undefined,
    });
    if (showProgress) process.stderr.write('\r                    \r');
    process.stdout.write(values.json ? `${JSON.stringify(result)}\n` : `${result.output}\n`);
  } catch (err) {
    if (showProgress) process.stderr.write('\n');
    const code = errorCode(err) || '';
    const badArgs = ['BAD_RANGE', 'BAD_INPUT', 'BAD_OUTPUT_PATH', 'NOT_FOUND', 'EXISTS'].includes(code);
    const hint = code === 'EXISTS' ? ' (use --overwrite to replace it)' : '';
    const detail = (err as ClipError).detail;
    fail(detail ? `${errorMessage(err)}\n${detail}` : `${errorMessage(err)}${hint}`, badArgs ? 2 : 1);
  }
}

void main();
