import fs from 'node:fs';
import { ffmpegPath } from './binaries';
import { ClipError, run } from './proc';
import type { ProxyLevel } from './types';

export interface ProxyOptions {
  input: string;
  output: string;
  level: ProxyLevel;
  duration: number;
  audioOnly?: boolean;
  audioTrack?: number;
  onProgress?: (p: { percent: number }) => void;
  signal?: AbortSignal;
}

// Builds an MP4 the <video> tag can play when it cannot play the source.
//  level 'remux'     -> stream copy into MP4 (seconds; fixes container-only problems such as MKV)
//  level 'transcode' -> 720p H.264 proxy (slower; fixes unsupported codecs)
// Export always reads the original file, so the proxy never affects output quality.
export async function makePreviewProxy({ input, output, level, duration, audioOnly = false, audioTrack = 0, onProgress, signal }: ProxyOptions): Promise<string> {
  if (!Number.isInteger(audioTrack) || audioTrack < 0) throw new ClipError('BAD_AUDIO', 'Invalid preview audio track.');
  const args = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-i', input];
  if (!audioOnly) args.push('-map', '0:v:0');
  args.push('-map', `0:a:${audioTrack}?`);
  if (level === 'remux') {
    args.push('-c', 'copy');
  } else if (audioOnly) {
    args.push('-c:a', 'aac', '-b:a', '192k');
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
