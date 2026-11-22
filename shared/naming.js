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
};
