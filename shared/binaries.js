'use strict';

// Resolution order: env override -> bundled binary -> system PATH.
function unpacked(p) {
  return p ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

function bundled(pkg) {
  try {
    const mod = require(pkg);
    const p = typeof mod === 'string' ? mod : mod && mod.path;
    return p ? unpacked(p) : null;
  } catch {
    return null;
  }
}

function ffmpegPath() {
  return process.env.CLIP_GOAT_FFMPEG || bundled('ffmpeg-static') || 'ffmpeg';
}

function ffprobePath() {
  return process.env.CLIP_GOAT_FFPROBE || bundled('ffprobe-static') || 'ffprobe';
}

module.exports = { ffmpegPath, ffprobePath };
