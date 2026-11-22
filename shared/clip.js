'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ffmpegPath } = require('./binaries');
const { ClipError, run } = require('./proc');
const { probe, keyframes: readKeyframes } = require('./probe');
const { buildClipName, defaultOutputPath, uniquePath } = require('./naming');

const FORMATS = { '.mp4': 'mp4', '.m4v': 'mp4', '.mov': 'mov', '.mkv': 'matroska' };

// Largest keyframe time <= t (binary search); null when none.
function previousKeyframe(keyframes, t) {
  let lo = 0;
  let hi = keyframes.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid] <= t) {
      found = keyframes[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function nearestKeyframe(keyframes, t) {
  const prev = previousKeyframe(keyframes, t);
  const next = keyframes.find((k) => k > t);
  if (prev === null) return next === undefined ? null : next;
  if (next === undefined) return prev;
  return t - prev <= next - t ? prev : next;
}

// A start counts as "on a keyframe" within half a frame.
function keyframeTolerance(fps) {
  return fps > 0 ? 0.5 / fps : 0.017;
}

function validateSegments(segments, duration) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new ClipError('BAD_RANGE', 'At least one start/end range is required.');
  }
  return segments.map((seg, i) => {
    const start = Number(seg.start);
    let end = Number(seg.end);
    const label = segments.length > 1 ? ` (range ${i + 1})` : '';
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new ClipError('BAD_RANGE', `Start and end must be numbers${label}.`);
    }
    if (start < 0) throw new ClipError('BAD_RANGE', `Start must not be negative${label}.`);
    if (end <= start) throw new ClipError('BAD_RANGE', `End must be greater than start${label}.`);
    if (start >= duration) {
      throw new ClipError('BAD_RANGE', `Start ${start}s is past the end of the video (${duration.toFixed(2)}s)${label}.`);
    }
    end = Math.min(end, duration);
    return { start, end };
  });
}

// Decides copy vs encode. mode: 'auto' | 'copy' | 'encode'.
//  auto   -> copy only when every start already sits on a keyframe, otherwise encode (frame-exact)
//  copy   -> snap every start back to its keyframe (instant, clip may begin slightly earlier)
function planSegments(segments, keyframes, mode, fps) {
  if (mode === 'encode' || !keyframes || keyframes.length === 0) {
    return { mode: 'encode', segments };
  }
  const tol = keyframeTolerance(fps);
  const snapped = [];
  for (const seg of segments) {
    const kf = mode === 'copy' ? previousKeyframe(keyframes, seg.start + tol) : nearestKeyframe(keyframes, seg.start);
    if (kf === null || kf >= seg.end) return { mode: 'encode', segments };
    if (mode === 'auto' && Math.abs(kf - seg.start) > tol) return { mode: 'encode', segments };
    snapped.push({ start: kf, end: seg.end });
  }
  return { mode: 'copy', segments: snapped };
}

function buildArgs({ input, seg, out, format, mode, info }) {
  const args = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats'];
  // The 1ms nudge keeps a float-rounded seek from landing on the previous keyframe.
  if (seg.start > 0) args.push('-ss', (mode === 'copy' ? seg.start + 0.001 : seg.start).toFixed(6));
  args.push('-i', input, '-t', (seg.end - seg.start).toFixed(6), '-map', '0:v:0', '-map', '0:a?');

  if (mode === 'copy') {
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
    if (info.video.codec === 'hevc' && format !== 'matroska') args.push('-tag:v', 'hvc1');
  } else {
    if (info.video.width % 2 || info.video.height % 2) {
      args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
    }
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k');
    // Never spend more bits than the source had: CRF alone can overshoot on noisy game footage.
    if (info.video.bitrate > 0) {
      args.push('-maxrate', String(Math.round(info.video.bitrate)), '-bufsize', String(Math.round(info.video.bitrate * 2)));
    }
  }
  if (format !== 'matroska') args.push('-movflags', '+faststart');
  args.push('-f', format, out);
  return args;
}

function concatArgs({ listFile, out, format, info }) {
  const args = ['-hide_banner', '-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-map', '0', '-c', 'copy'];
  if (info.video.codec === 'hevc' && format !== 'matroska') args.push('-tag:v', 'hvc1');
  if (format !== 'matroska') args.push('-movflags', '+faststart');
  args.push('-f', format, out);
  return args;
}

function rm(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

async function runFfmpeg(args, { signal, onTime } = {}) {
  const res = await run(ffmpegPath(), args, {
    signal,
    onStdoutLine: onTime
      ? (line) => {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
          if (m) onTime(Number(m[1]) / 1e6);
        }
      : undefined,
  });
  if (res.code !== 0) {
    const tail = res.stderr.trim().split(/\r?\n/).slice(-4).join('\n');
    throw new ClipError('FFMPEG_FAILED', 'ffmpeg failed.', tail);
  }
}

// Runs one attempt (copy or encode) into tmpOut and checks the result is a real clip of the expected length.
async function attempt({ input, segments, mode, tmpOut, format, info, signal, onProgress }) {
  const total = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  let done = 0;
  const report = (t) => {
    if (onProgress) onProgress({ percent: Math.max(0, Math.min(99, ((done + t) / total) * 100)), mode });
  };

  if (segments.length === 1) {
    await runFfmpeg(buildArgs({ input, seg: segments[0], out: tmpOut, format, mode, info }), { signal, onTime: report });
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-goat-'));
    try {
      const parts = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const part = path.join(dir, `part${i}.mkv`);
        await runFfmpeg(buildArgs({ input, seg, out: part, format: 'matroska', mode, info }), { signal, onTime: report });
        done += seg.end - seg.start;
        parts.push(part);
      }
      const listFile = path.join(dir, 'list.txt');
      fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
      await runFfmpeg(concatArgs({ listFile, out: tmpOut, format, info }), { signal });
    } finally {
      rm(dir);
    }
  }

  let out;
  try {
    out = await probe(tmpOut, { signal });
  } catch (err) {
    if (err.code === 'ABORTED') throw err;
    throw new ClipError('BAD_OUTPUT', 'The exported file is not a valid video.', err.message);
  }
  const slack = Math.max(0.5, total * 0.05);
  if (Math.abs(out.duration - total) > slack) {
    throw new ClipError('BAD_OUTPUT', `Exported ${out.duration.toFixed(2)}s but expected ${total.toFixed(2)}s.`);
  }
  return out;
}

/**
 * Cuts one or more ranges out of a video and writes them, joined in order, to one file.
 * Tries stream copy when the plan allows it and falls back to re-encoding when copy fails.
 *
 * @param {object} opts
 * @param {string} opts.input
 * @param {{start:number,end:number}[]} opts.segments seconds
 * @param {string} [opts.output] defaults to {name}_clip_{start}s-{end}s.mp4 next to the input
 * @param {string} [opts.outputDir] keep the default name but write it into this folder
 * @param {'auto'|'copy'|'encode'} [opts.mode]
 * @param {boolean} [opts.overwrite]
 * @param {number[]} [opts.keyframes] pass cached keyframes to skip the scan
 * @param {(p:{percent:number,mode:string})=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 */
async function clip(opts) {
  const { input, mode = 'auto', overwrite = false, onProgress, signal } = opts;
  if (!input) throw new ClipError('BAD_INPUT', 'An input file is required.');
  if (!['auto', 'copy', 'encode'].includes(mode)) throw new ClipError('BAD_INPUT', `Unknown mode: ${mode}`);

  const info = await probe(input, { signal });
  const segments = validateSegments(opts.segments, info.duration);

  let plan = { mode: 'encode', segments };
  if (mode !== 'encode') {
    let kfs = opts.keyframes;
    if (!kfs) {
      try {
        kfs = await readKeyframes(input, { signal, startTime: info.startTime });
      } catch (err) {
        if (err.code === 'ABORTED') throw err;
        kfs = null;
      }
    }
    plan = planSegments(segments, kfs, mode, info.video.fps);
  }

  // The file name reports the ranges actually written (copy may have moved a start to its keyframe).
  let output;
  if (opts.output) output = path.resolve(opts.output);
  else if (opts.outputDir) output = path.join(path.resolve(opts.outputDir), buildClipName(input, plan.segments));
  else output = defaultOutputPath(path.resolve(input), plan.segments);
  const ext = path.extname(output).toLowerCase();
  const format = FORMATS[ext];
  if (!format) {
    throw new ClipError('BAD_OUTPUT_PATH', `Unsupported output extension "${ext}". Use .mp4, .mov or .mkv.`);
  }
  if (path.resolve(input).toLowerCase() === output.toLowerCase()) {
    throw new ClipError('BAD_OUTPUT_PATH', 'The output file must differ from the input file.');
  }
  if (!overwrite) {
    if (opts.output && fs.existsSync(output)) {
      throw new ClipError('EXISTS', `Output already exists: ${output}`);
    }
    output = uniquePath(output);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const tmpOut = `${output}.part`;
  const common = { input, tmpOut, format, info, signal, onProgress };
  let usedMode = plan.mode;
  let fellBack = false;
  let out;

  try {
    try {
      out = await attempt({ ...common, segments: plan.segments, mode: plan.mode });
    } catch (err) {
      if (err.code === 'ABORTED' || plan.mode === 'encode') throw err;
      fellBack = true;
      usedMode = 'encode';
      out = await attempt({ ...common, segments: plan.segments, mode: 'encode' });
    }
    fs.renameSync(tmpOut, output);
  } catch (err) {
    rm(tmpOut);
    if (err.code === 'ABORTED') throw err;
    throw new ClipError('EXPORT_FAILED', `Export failed: ${err.message}`, err.detail);
  }

  if (onProgress) onProgress({ percent: 100, mode: usedMode });
  return {
    output,
    mode: usedMode,
    fellBack,
    segments: plan.segments,
    duration: out.duration,
    size: out.size,
  };
}

module.exports = {
  clip,
  planSegments,
  previousKeyframe,
  nearestKeyframe,
  keyframeTolerance,
  validateSegments,
  buildArgs,
};
