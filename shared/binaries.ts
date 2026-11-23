// Resolution order: env override -> bundled binary -> system PATH.
function unpacked(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked');
}

function bundled(pkg: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: unknown = require(pkg);
    const p = typeof mod === 'string' ? mod : (mod as { path?: string } | null)?.path;
    return p ? unpacked(p) : null;
  } catch {
    return null;
  }
}

export function ffmpegPath(): string {
  return process.env.CLIP_GOAT_FFMPEG || bundled('ffmpeg-static') || 'ffmpeg';
}

export function ffprobePath(): string {
  return process.env.CLIP_GOAT_FFPROBE || bundled('ffprobe-static') || 'ffprobe';
}
