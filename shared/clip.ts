import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpegPath } from './binaries';
import { ClipError, errorCode, errorMessage, run } from './proc';
import { probe, keyframes as readKeyframes } from './probe';
import { buildClipName, uniquePath, encodeOrigin, lineage, defaultExtension } from './naming';
import { AUDIO_MODES, channelFilter, supportsAudioMode } from './audio';
import type { AudioSettings, ClipMode, ClipProgress, ClipResult, ExportMode, Segment, VideoInfo } from './types';

type Container = 'mp4' | 'mov' | 'matroska' | 'mp3' | 'adts' | 'wav' | 'flac' | 'ogg' | 'opus' | 'aiff' | 'asf' | 'webm' | 'avi' | 'mpegts' | 'flv' | 'mpeg' | '3gp';

const FORMATS: Record<string, Container> = {
  '.mp4': 'mp4', '.m4a': 'mp4', '.m4v': 'mp4', '.mov': 'mov', '.mkv': 'matroska',
  '.mp3': 'mp3', '.aac': 'adts', '.wav': 'wav', '.flac': 'flac', '.ogg': 'ogg',
  '.opus': 'opus', '.aiff': 'aiff', '.aif': 'aiff', '.wma': 'asf',
  '.webm': 'webm', '.avi': 'avi', '.ts': 'mpegts', '.m2ts': 'mpegts',
  '.flv': 'flv', '.wmv': 'asf', '.mpg': 'mpeg', '.mpeg': 'mpeg', '.3gp': '3gp',
};

function audioEncodeArgs(format: Container, info: VideoInfo, audio?: AudioSettings): string[] {
  const tracks = audio?.track === undefined ? info.audio : [info.audio[audio.track]];
  if (format === 'ogg') {
    return tracks.flatMap((track, i) => [`-c:a:${i}`, track.codec === 'opus' ? 'libopus' : track.codec === 'flac' ? 'flac' : 'libvorbis']);
  }
  if (format === 'wav' || format === 'aiff') {
    const endian = format === 'wav' ? 'le' : 'be';
    const args = tracks.flatMap((track, i) => {
      const match = /^pcm_(s16|s24|s32|f32|f64)(?:le|be)$/.exec(track.codec);
      const codec = match ? `pcm_${match[1]}${endian}` : format === 'wav' && track.codec === 'pcm_u8' ? 'pcm_u8' : `pcm_s16${endian}`;
      return [`-c:a:${i}`, codec];
    });
    return args;
  }
  const codec = format === 'mp3' || format === 'mpeg' ? 'libmp3lame'
    : format === 'flac' ? 'flac'
      : format === 'opus' || format === 'webm' ? 'libopus'
        : format === 'asf' ? 'wmav2' : 'aac';
  return ['-c:a', codec, ...(codec === 'flac' ? [] : ['-b:a', '192k'])];
}

function addOutputArgs(args: string[], format: Container, out: string): void {
  if (format === 'mp4' || format === 'mov' || format === '3gp') args.push('-movflags', '+faststart');
  if (format === 'adts') args.push('-write_id3v2', '1');
  args.push('-f', format, out);
}

export function validateAudioSettings(info: VideoInfo, audio?: AudioSettings): void {
  if (audio === undefined) return;
  if (!audio || !AUDIO_MODES.includes(audio.mode)) throw new ClipError('BAD_AUDIO', 'Unknown audio channel mode.');
  if (!info.audio.length) throw new ClipError('BAD_AUDIO', 'This file has no audio stream.');
  if (audio.track !== undefined && (!Number.isInteger(audio.track) || audio.track < 0 || audio.track >= info.audio.length)) {
    throw new ClipError('BAD_AUDIO', 'The selected audio track does not exist.');
  }
  const tracks = audio.track === undefined ? info.audio : [info.audio[audio.track]];
  if (tracks.some((track) => !supportsAudioMode(audio.mode, track.channels))) {
    throw new ClipError('BAD_AUDIO', 'Channel processing requires mono or stereo audio; right-only requires a right channel.');
  }
}

// Largest keyframe time <= t (binary search); null when none.
export function previousKeyframe(keyframes: number[], t: number): number | null {
  let lo = 0;
  let hi = keyframes.length - 1;
  let found: number | null = null;
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

export function nearestKeyframe(keyframes: number[], t: number): number | null {
  const prev = previousKeyframe(keyframes, t);
  const next = keyframes.find((k) => k > t);
  if (prev === null) return next === undefined ? null : next;
  if (next === undefined) return prev;
  return t - prev <= next - t ? prev : next;
}

// A start counts as "on a keyframe" within half a frame.
export function keyframeTolerance(fps: number): number {
  return fps > 0 ? 0.5 / fps : 0.017;
}

export function validateSegments(segments: unknown, duration: number): Segment[] {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new ClipError('BAD_RANGE', 'At least one start/end range is required.');
  }
  return (segments as Partial<Segment>[]).map((seg, i) => {
    const start = Number(seg.start);
    let end = Number(seg.end);
    const label = segments.length > 1 ? ` (range ${i + 1})` : '';
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new ClipError('BAD_RANGE', `Start and end must be numbers${label}.`);
    }
    if (start < 0) throw new ClipError('BAD_RANGE', `Start must not be negative${label}.`);
    if (end <= start) throw new ClipError('BAD_RANGE', `End must be greater than start${label}.`);
    if (start >= duration) {
      throw new ClipError('BAD_RANGE', `Start ${start}s is past the end of the file (${duration.toFixed(2)}s)${label}.`);
    }
    end = Math.min(end, duration);
    return { start, end };
  });
}

export interface SegmentPlan {
  mode: ExportMode;
  segments: Segment[];
}

// Decides copy vs encode.
//  auto   -> copy only when every start already sits on a keyframe, otherwise encode (frame-exact)
//  copy   -> snap every start back to its keyframe (instant, clip may begin slightly earlier)
export function planSegments(segments: Segment[], keyframes: number[] | null | undefined, mode: ClipMode, fps: number, hasVideo = true): SegmentPlan {
  if (!hasVideo) return { mode: mode === 'encode' ? 'encode' : 'copy', segments };
  if (mode === 'encode' || !keyframes || keyframes.length === 0) {
    return { mode: 'encode', segments };
  }
  const tol = keyframeTolerance(fps);
  const snapped: Segment[] = [];
  for (const seg of segments) {
    const kf = mode === 'copy' ? previousKeyframe(keyframes, seg.start + tol) : nearestKeyframe(keyframes, seg.start);
    if (kf === null || kf >= seg.end) return { mode: 'encode', segments };
    if (mode === 'auto' && Math.abs(kf - seg.start) > tol) return { mode: 'encode', segments };
    snapped.push({ start: kf, end: seg.end });
  }
  return { mode: 'copy', segments: snapped };
}

interface BuildArgs {
  input: string;
  seg: Segment;
  out: string;
  format: Container;
  mode: ExportMode;
  info: VideoInfo;
  comment?: string;
  audio?: AudioSettings;
}

export function buildArgs({ input, seg, out, format, mode, info, comment, audio }: BuildArgs): string[] {
  const args = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats'];
  // The 1ms nudge keeps a float-rounded seek from landing on the previous keyframe.
  if (seg.start > 0) args.push('-ss', (mode === 'copy' ? seg.start + 0.001 : seg.start).toFixed(6));
  args.push('-i', input, '-t', (seg.end - seg.start).toFixed(6));
  if (info.video) args.push('-map', '0:v:0');
  args.push('-map', audio?.track === undefined ? '0:a?' : `0:a:${audio.track}`);

  if (mode === 'copy') {
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
    if (info.video?.codec === 'hevc' && format !== 'matroska') args.push('-tag:v', 'hvc1');
  } else {
    if (info.video && (info.video.width % 2 || info.video.height % 2)) {
      args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
    }
    if (info.video) args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p');
    args.push(...audioEncodeArgs(format, info, audio));
    // Never spend more bits than the source had: CRF alone can overshoot on noisy game footage.
    if (info.video && info.video.bitrate > 0) {
      args.push('-maxrate', String(Math.round(info.video.bitrate)), '-bufsize', String(Math.round(info.video.bitrate * 2)));
    }
  }
  if (audio && audio.mode !== 'original') {
    const tracks = audio.track === undefined ? info.audio : [info.audio[audio.track]];
    tracks.forEach((track, i) => {
      const filter = channelFilter(audio.mode, track.channels);
      if (filter) args.push(`-filter:a:${i}`, filter);
    });
    args.push(...audioEncodeArgs(format, info, audio));
  }
  if (comment) args.push('-metadata', `comment=${comment}`);
  addOutputArgs(args, format, out);
  return args;
}

function concatArgs({ listFile, out, format, info, comment }: { listFile: string; out: string; format: Container; info: VideoInfo; comment?: string }): string[] {
  const args = ['-hide_banner', '-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-map', '0', '-c', 'copy'];
  if (info.video?.codec === 'hevc' && format !== 'matroska') args.push('-tag:v', 'hvc1');
  if (comment) args.push('-metadata', `comment=${comment}`);
  addOutputArgs(args, format, out);
  return args;
}

function audioConcatArgs({ input, segments, out, format, info, comment, audio }: Omit<BuildArgs, 'seg' | 'mode'> & { segments: Segment[] }): string[] {
  const args = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-i', input];
  const filters: string[] = [];
  const tracks = audio?.track === undefined ? info.audio.map((_, i) => i) : [audio.track];
  for (const track of tracks) {
    const parts = segments.map((seg, i) => {
      const label = `a${track}s${i}`;
      filters.push(`[0:a:${track}]atrim=start=${seg.start.toFixed(6)}:end=${seg.end.toFixed(6)},asetpts=PTS-STARTPTS[${label}]`);
      return `[${label}]`;
    });
    const filter = channelFilter(audio?.mode || 'original', info.audio[track].channels);
    filters.push(`${parts.join('')}concat=n=${segments.length}:v=0:a=1${filter ? `,${filter}` : ''}[a${track}]`);
  }
  args.push('-filter_complex', filters.join(';'));
  for (const track of tracks) args.push('-map', `[a${track}]`);
  args.push(...audioEncodeArgs(format, info, audio));
  if (comment) args.push('-metadata', `comment=${comment}`);
  addOutputArgs(args, format, out);
  return args;
}

function rm(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

async function runFfmpeg(args: string[], { signal, onTime }: { signal?: AbortSignal; onTime?: (seconds: number) => void } = {}): Promise<void> {
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

interface Attempt {
  input: string;
  segments: Segment[];
  mode: ExportMode;
  tmpOut: string;
  format: Container;
  info: VideoInfo;
  comment: string;
  signal?: AbortSignal;
  onProgress?: (p: ClipProgress) => void;
  audio?: AudioSettings;
}

// Runs one attempt (copy or encode) into tmpOut and checks the result is a real clip of the expected length.
async function attempt({ input, segments, mode, tmpOut, format, info, comment, signal, onProgress, audio }: Attempt): Promise<VideoInfo> {
  const total = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  let done = 0;
  const report = (t: number) => {
    if (onProgress) onProgress({ percent: Math.max(0, Math.min(99, ((done + t) / total) * 100)), mode: audio && audio.mode !== 'original' ? 'encode' : mode });
  };

  if (segments.length === 1) {
    await runFfmpeg(buildArgs({ input, seg: segments[0], out: tmpOut, format, mode, info, comment, audio }), { signal, onTime: report });
  } else if (!info.video && mode === 'encode') {
    // Encode once after joining samples, so AAC priming does not accumulate at every cut.
    await runFfmpeg(audioConcatArgs({ input, segments, out: tmpOut, format, info, comment, audio }), { signal, onTime: report });
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-goat-'));
    try {
      const parts: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const part = path.join(dir, `part${i}.mkv`);
        await runFfmpeg(buildArgs({ input, seg, out: part, format: 'matroska', mode, info, audio }), { signal, onTime: report });
        done += seg.end - seg.start;
        parts.push(part);
      }
      const listFile = path.join(dir, 'list.txt');
      fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
      await runFfmpeg(concatArgs({ listFile, out: tmpOut, format, info, comment }), { signal });
    } finally {
      rm(dir);
    }
  }

  let out: VideoInfo;
  try {
    out = await probe(tmpOut, { signal });
  } catch (err) {
    if (errorCode(err) === 'ABORTED') throw err;
    throw new ClipError('BAD_OUTPUT', 'The exported file is not valid audio/video.', errorMessage(err));
  }
  // Some audio demuxers retain substantial seek preroll on copy; re-encode instead of
  // accepting that extra sound as part of the selected range.
  const slack = info.video ? Math.max(0.5, total * 0.05) : 0.1;
  if (Math.abs(out.duration - total) > slack) {
    throw new ClipError('BAD_OUTPUT', `Exported ${out.duration.toFixed(2)}s but expected ${total.toFixed(2)}s.`);
  }
  if (out.audio.length !== (audio?.track === undefined ? info.audio.length : 1)
    || (audio && audio.mode !== 'original' && out.audio.some((track) => track.channels !== 1))) {
    throw new ClipError('BAD_OUTPUT', 'The exported audio does not match the selected track/channel settings.');
  }
  return out;
}

export interface ClipOptions {
  input: string;
  /** Ranges in seconds. */
  segments: Segment[];
  /** Defaults to {name}_clip_{length}s with .mp4 for video or the input extension for audio. */
  output?: string;
  /** Keep the default name but write it into this folder. */
  outputDir?: string;
  mode?: ClipMode;
  overwrite?: boolean;
  /** Pass cached keyframes to skip the scan. */
  keyframes?: number[];
  onProgress?: (p: ClipProgress) => void;
  signal?: AbortSignal;
  audio?: AudioSettings;
}

/**
 * Cuts one or more ranges out of a video and writes them, joined in order, to one file.
 * Tries stream copy when the plan allows it and falls back to re-encoding when copy fails.
 */
export async function clip(opts: ClipOptions): Promise<ClipResult> {
  const { input, mode = 'auto', overwrite = false, onProgress, signal, audio } = opts;
  if (!input) throw new ClipError('BAD_INPUT', 'An input file is required.');
  if (!['auto', 'copy', 'encode'].includes(mode)) throw new ClipError('BAD_INPUT', `Unknown mode: ${mode}`);

  const info = await probe(input, { signal });
  validateAudioSettings(info, audio);
  const segments = validateSegments(opts.segments, info.duration);

  let plan: SegmentPlan = { mode: 'encode', segments };
  if (!info.video) {
    plan = planSegments(segments, null, audio && audio.mode !== 'original' ? 'encode' : mode, 0, false);
  } else if (mode !== 'encode') {
    let kfs: number[] | null | undefined = opts.keyframes;
    if (!kfs) {
      try {
        kfs = await readKeyframes(input, { signal, startTime: info.startTime });
      } catch (err) {
        if (errorCode(err) === 'ABORTED') throw err;
        kfs = null;
      }
    }
    plan = planSegments(segments, kfs, mode, info.video.fps);
  }

  // The file name reports the ranges actually written (copy may have moved a start to its keyframe).
  // A clip cut from a clip is named after, and points back to, the original video.
  const origin = lineage(info.origin, input, plan.segments);
  const comment = encodeOrigin(origin);
  let output = opts.output
    ? path.resolve(opts.output)
    : path.join(opts.outputDir ? path.resolve(opts.outputDir) : path.dirname(path.resolve(input)), buildClipName(origin.source, origin.segments, defaultExtension(info, input)));
  const ext = path.extname(output).toLowerCase();
  const format = FORMATS[ext];
  if (!format) {
    throw new ClipError('BAD_OUTPUT_PATH', `Unsupported output extension "${ext}".`);
  }
  if (info.video && !['.mp4', '.m4v', '.mov', '.mkv'].includes(ext)) {
    throw new ClipError('BAD_OUTPUT_PATH', 'Use .mp4, .m4v, .mov or .mkv for video.');
  }
  // A default name that collides with the input just gets a counter below.
  if (path.resolve(input).toLowerCase() === output.toLowerCase() && (opts.output || overwrite)) {
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
  const common = { input, tmpOut, format, info, comment, signal, onProgress, segments: plan.segments, audio };
  let usedMode: ExportMode = audio && audio.mode !== 'original' ? 'encode' : plan.mode;
  let fellBack = false;
  let out: VideoInfo;

  try {
    try {
      out = await attempt({ ...common, mode: plan.mode });
    } catch (err) {
      if (errorCode(err) === 'ABORTED' || plan.mode === 'encode') throw err;
      fellBack = true;
      usedMode = 'encode';
      out = await attempt({ ...common, mode: 'encode' });
    }
    fs.renameSync(tmpOut, output);
  } catch (err) {
    rm(tmpOut);
    if (errorCode(err) === 'ABORTED') throw err;
    throw new ClipError('EXPORT_FAILED', `Export failed: ${errorMessage(err)}`, (err as ClipError).detail);
  }

  if (onProgress) onProgress({ percent: 100, mode: usedMode });
  return {
    output,
    mode: usedMode,
    fellBack,
    segments: plan.segments,
    source: origin.source,
    duration: out.duration,
    size: out.size,
  };
}
