import fs from 'node:fs';
import path from 'node:path';
import type { ClipLabel, Origin, Segment, VideoInfo } from './types';

export const CLIP_MARKER = '_clip_';

export const VIDEO_EXTS = ['.mp4', '.mkv', '.mov', '.webm', '.m4v', '.avi', '.ts', '.m2ts', '.flv', '.wmv', '.mpg', '.mpeg', '.3gp'];
export const AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.aiff', '.aif', '.wma'];
export const MEDIA_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS];

export function isMediaFile(filename: string): boolean {
  return MEDIA_EXTS.includes(path.extname(String(filename)).toLowerCase());
}

export function defaultExtension(info: Pick<VideoInfo, 'video'>): string {
  return info.video ? '.mp4' : '.m4a';
}

export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTS.includes(path.extname(String(filename)).toLowerCase());
}

export function isClippedFile(filename: string): boolean {
  return path.basename(String(filename)).includes(CLIP_MARKER);
}

// "Game_clip_1s-2s.mp4" -> { head: "Game", tail: "1s-2s" }; tail is empty for originals.
export function splitClipName(filename: string): ClipLabel {
  const name = path.basename(String(filename));
  const at = name.lastIndexOf(CLIP_MARKER);
  if (at < 0) return { head: name, tail: '' };
  const rest = name.slice(at + CLIP_MARKER.length);
  return { head: name.slice(0, at), tail: rest.slice(0, rest.length - path.extname(rest).length) };
}

// 112.5 -> "112.5", 115.83 -> "115.83", 3 -> "3"
export function formatSeconds(sec: number): string {
  return String(Number(Number(sec).toFixed(2)));
}

// {original-name}_clip_{length}s.mp4, where length is the total duration of the clip.
// Where the clip was cut from is kept in the file's metadata, not in its name.
export function buildClipName(inputPath: string, segments: Segment[], ext = '.mp4'): string {
  const base = path.basename(inputPath, path.extname(inputPath));
  const length = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  return `${base}${CLIP_MARKER}${formatSeconds(length)}s${ext}`;
}

export function defaultOutputPath(inputPath: string, segments: Segment[], ext = '.mp4'): string {
  return path.join(path.dirname(inputPath), buildClipName(inputPath, segments, ext));
}

// A clip records where it came from in the file's own comment tag:
//   clipgoat:{"v":1,"source":"Game.mp4","segments":[[112.5,115.8]]}
// source is the original video's file name; segments are ranges on the original's timeline.
const ORIGIN_PREFIX = 'clipgoat:';
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function encodeOrigin(origin: Origin): string {
  return ORIGIN_PREFIX + JSON.stringify({ v: 1, source: origin.source, segments: origin.segments.map((s) => [round3(s.start), round3(s.end)]) });
}

export function parseOrigin(comment: unknown): Origin | null {
  if (typeof comment !== 'string' || !comment.startsWith(ORIGIN_PREFIX)) return null;
  try {
    const data = JSON.parse(comment.slice(ORIGIN_PREFIX.length)) as { source?: unknown; segments: [unknown, unknown][] };
    const source = path.basename(String(data.source || ''));
    const segments = data.segments.map(([start, end]) => ({ start: Number(start), end: Number(end) }));
    if (!source || /[\\/:*?"<>|]/.test(source)) return null;
    if (!segments.length || segments.some((s) => !(s.start >= 0) || !(s.end > s.start))) return null;
    return { source, segments };
  } catch {
    return null;
  }
}

// Translates ranges on a clip's timeline into ranges on its original's timeline.
// The clip's timeline is its origin segments laid end to end.
export function mapToSource(segments: Segment[], originSegments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    let offset = 0;
    originSegments.forEach((o, i) => {
      const length = o.end - o.start;
      const last = i === originSegments.length - 1;
      const from = Math.max(seg.start, offset);
      const to = last ? seg.end : Math.min(seg.end, offset + length);
      if (to - from > 1e-6) out.push({ start: round3(o.start + from - offset), end: round3(o.start + to - offset) });
      offset += length;
    });
  }
  return out;
}

// Where a new clip comes from: the input itself, or the input's own original when the input is a clip.
export function lineage(origin: Origin | null | undefined, inputName: string, segments: Segment[]): Origin {
  if (origin) {
    const mapped = mapToSource(segments, origin.segments);
    if (mapped.length) return { source: origin.source, segments: mapped };
  }
  return { source: path.basename(inputName), segments };
}

// name.mp4 -> name_2.mp4 -> name_3.mp4 ...
export function uniquePath(filePath: string, exists: (p: string) => boolean = fs.existsSync): string {
  if (!exists(filePath)) return filePath;
  const ext = path.extname(filePath);
  const stem = filePath.slice(0, filePath.length - ext.length);
  for (let i = 2; ; i++) {
    const candidate = `${stem}_${i}${ext}`;
    if (!exists(candidate)) return candidate;
  }
}
