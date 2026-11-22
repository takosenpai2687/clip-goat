'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CLIP_MARKER = '_clip_';

const VIDEO_EXTS = ['.mp4', '.mkv', '.mov', '.webm', '.m4v', '.avi', '.ts', '.m2ts', '.flv', '.wmv', '.mpg', '.mpeg', '.3gp'];

function isVideoFile(filename) {
  return VIDEO_EXTS.includes(path.extname(String(filename)).toLowerCase());
}

function isClippedFile(filename) {
  return path.basename(String(filename)).includes(CLIP_MARKER);
}

// "Game_clip_1s-2s.mp4" -> { head: "Game", tail: "1s-2s" }; tail is empty for originals.
function splitClipName(filename) {
  const name = path.basename(String(filename));
  const at = name.lastIndexOf(CLIP_MARKER);
  if (at < 0) return { head: name, tail: '' };
  const rest = name.slice(at + CLIP_MARKER.length);
  return { head: name.slice(0, at), tail: rest.slice(0, rest.length - path.extname(rest).length) };
}

// 112.5 -> "112.5", 115.83 -> "115.83", 3 -> "3"
function formatSeconds(sec) {
  return String(Number(Number(sec).toFixed(2)));
}

// {original-name}_clip_{start}s-{end}s.mp4; joined clips add "_{n}parts".
function buildClipName(inputPath, segments, ext = '.mp4') {
  const base = path.basename(inputPath, path.extname(inputPath));
  const first = segments[0];
  const last = segments[segments.length - 1];
  const range = `${formatSeconds(first.start)}s-${formatSeconds(last.end)}s`;
  const parts = segments.length > 1 ? `_${segments.length}parts` : '';
  return `${base}${CLIP_MARKER}${range}${parts}${ext}`;
}

function defaultOutputPath(inputPath, segments, ext = '.mp4') {
  return path.join(path.dirname(inputPath), buildClipName(inputPath, segments, ext));
}

// A clip records where it came from in the file's own comment tag:
//   clipgoat:{"v":1,"source":"Game.mp4","segments":[[112.5,115.8]]}
// source is the original video's file name; segments are ranges on the original's timeline.
const ORIGIN_PREFIX = 'clipgoat:';
const round3 = (n) => Math.round(n * 1000) / 1000;

function encodeOrigin(origin) {
  return ORIGIN_PREFIX + JSON.stringify({ v: 1, source: origin.source, segments: origin.segments.map((s) => [round3(s.start), round3(s.end)]) });
}

function parseOrigin(comment) {
  if (typeof comment !== 'string' || !comment.startsWith(ORIGIN_PREFIX)) return null;
  try {
    const data = JSON.parse(comment.slice(ORIGIN_PREFIX.length));
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
function mapToSource(segments, originSegments) {
  const out = [];
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
function lineage(origin, inputName, segments) {
  if (origin) {
    const mapped = mapToSource(segments, origin.segments);
    if (mapped.length) return { source: origin.source, segments: mapped };
  }
  return { source: path.basename(inputName), segments };
}

// name.mp4 -> name_2.mp4 -> name_3.mp4 ...
function uniquePath(filePath, exists = fs.existsSync) {
  if (!exists(filePath)) return filePath;
  const ext = path.extname(filePath);
  const stem = filePath.slice(0, filePath.length - ext.length);
  for (let i = 2; ; i++) {
    const candidate = `${stem}_${i}${ext}`;
    if (!exists(candidate)) return candidate;
  }
}

module.exports = {
  CLIP_MARKER,
  VIDEO_EXTS,
  isVideoFile,
  isClippedFile,
  splitClipName,
  formatSeconds,
  buildClipName,
  defaultOutputPath,
  uniquePath,
  encodeOrigin,
  parseOrigin,
  mapToSource,
  lineage,
};
