import fs from 'node:fs';
import { ffmpegPath } from './binaries';
import { ClipError, run } from './proc';
import type { ProxyLevel } from './types';

export interface ProxyOptions {
  input: string;
  output: string;
  level: ProxyLevel;
  duration: number;
  onProgress?: (p: { percent: number }) => void;
  signal?: AbortSignal;
}

// Builds an MP4 the <video> tag can play when it cannot play the source.
//  level 'remux'     -> stream copy into MP4 (seconds; fixes container-only problems such as MKV)
//  level 'transcode' -> 720p H.264 proxy (slower; fixes unsupported codecs)
// Export always reads the original file, so the proxy never affects output quality.
export async function makePreviewProxy({ input, output, level, duration, onProgress, signal }: ProxyOptions): Promise<string> {
  const args = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-i', input, '-map', '0:v:0', '-map', '0:a:0?'];
  if (level === 'remux') {
    args.push('-c', 'copy');
  } else {
    args.push(
      '-vf', 'scale=-2:min(720\\,trunc(ih/2)*2)',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p', '-g', '30',
      '-c:a', 'aac', '-b:a', '128k',
    );
  }
  args.push('-movflags', '+faststart', '-f', 'mp4', output);

  try {
    const res = await run(ffmpegPath(), args, {
      signal,
      onStdoutLine(line) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && onProgress && duration > 0) {
          onProgress({ percent: Math.min(99, (Number(m[1]) / 1e6 / duration) * 100) });
        }
      },
    });
    if (res.code !== 0) throw new ClipError('PREVIEW_FAILED', 'Cannot build a preview for this file.', res.stderr.trim().slice(-400));
    return output;
  } catch (err) {
    try {
      fs.rmSync(output, { force: true });
    } catch {}
    throw err;
  }
}
