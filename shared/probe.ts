import fs from 'node:fs';
import { ffprobePath } from './binaries';
import { ClipError, run } from './proc';
import { parseOrigin } from './naming';
import type { VideoInfo } from './types';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  bit_rate?: string;
  duration?: string;
  channels?: number;
  disposition?: { attached_pic?: number };
}

interface ProbeData {
  format?: { duration?: string; start_time?: string; size?: string; format_name?: string; bit_rate?: string; tags?: Record<string, string> };
  streams?: ProbeStream[];
}

function parseRate(rate?: string): number {
  if (!rate) return 0;
  const [n, d] = String(rate).split('/').map(Number);
  if (!n || !d) return 0;
  return n / d;
}

export async function probe(file: string, { signal }: { signal?: AbortSignal } = {}): Promise<VideoInfo> {
  if (!fs.existsSync(file)) throw new ClipError('NOT_FOUND', `File not found: ${file}`);

  const { code, stdout, stderr } = await run(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { signal });

  let data: ProbeData | null = null;
  try {
    data = JSON.parse(stdout) as ProbeData;
  } catch {}
  if (code !== 0 || !data || !data.format) {
    throw new ClipError('PROBE_FAILED', 'Cannot read this file. It may be damaged or not audio/video.', stderr.trim());
  }

  const format = data.format;
  const streams = data.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const audio = streams.filter((s) => s.codec_type === 'audio');
  if (!v && !audio.length) throw new ClipError('NO_VIDEO', 'This file has no audio or video stream.');

  const duration = Number(format.duration) || Number(v?.duration) || Math.max(0, ...audio.map((s) => Number(s.duration) || 0));
  if (!(duration > 0)) throw new ClipError('PROBE_FAILED', 'Cannot read the duration of this file. It may be damaged.');

  const tags = format.tags || {};
  return {
    duration,
    startTime: Number(format.start_time) || 0,
    size: Number(format.size) || 0,
    format: format.format_name || '',
    origin: parseOrigin(tags.comment || tags.COMMENT),
    video: v ? {
      codec: v.codec_name || '',
      width: Number(v.width) || 0,
      height: Number(v.height) || 0,
      fps: parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) || 0,
      pixFmt: v.pix_fmt || '',
      bitrate: Number(v.bit_rate) || Number(format.bit_rate) || 0,
    } : null,
    audio: audio.map((s) => ({ codec: s.codec_name || '', channels: Number(s.channels) || 0 })),
  };
}

// Keyframe times in seconds on the same timeline ffmpeg's -ss uses (relative to the file's start time).
// Reads packet headers only, so no decoding happens.
export async function keyframes(file: string, { signal, startTime }: { signal?: AbortSignal; startTime?: number } = {}): Promise<number[]> {
  const offset = startTime === undefined ? (await probe(file, { signal })).startTime : startTime;
  const times: number[] = [];
  const { code, stderr } = await run(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', file], {
    signal,
    onStdoutLine(line) {
      const comma = line.indexOf(',');
      if (comma < 0 || !line.includes('K', comma)) return;
      const t = Number(line.slice(0, comma));
      if (Number.isFinite(t)) times.push(Math.max(0, Number((t - offset).toFixed(6))));
    },
  });
  if (code !== 0) throw new ClipError('PROBE_FAILED', 'Cannot read keyframes.', stderr.trim());
  times.sort((a, b) => a - b);
  // A file whose first frame sits a few ms after its start time (audio priming) still begins on a keyframe.
  if (times.length && times[0] <= 0.1) times[0] = 0;
  return times.filter((t, i) => i === 0 || t !== times[i - 1]);
}
