import type { AudioMode } from './types';

export const AUDIO_MODES: AudioMode[] = ['original', 'mono', 'left', 'right'];

export function isAudioMode(value: string): value is AudioMode {
  return AUDIO_MODES.some((mode) => mode === value);
}

export function supportsAudioMode(mode: AudioMode, channels: number): boolean {
  return mode === 'original' || ((channels === 1 || channels === 2) && (mode !== 'right' || channels === 2));
}

/** Source L/R to output L, then source L/R to output R. */
export function channelGains(mode: AudioMode, channels: number): [number, number, number, number] {
  if (channels === 1 || mode === 'left') return [1, 0, 1, 0];
  if (mode === 'right') return [0, 1, 0, 1];
  if (mode === 'mono') return [0.5, 0.5, 0.5, 0.5];
  return [1, 0, 0, 1];
}

export function channelFilter(mode: AudioMode, channels: number): string | null {
  if (mode === 'original') return null;
  if (channels === 1) return 'pan=mono|c0=c0';
  const [left, right] = channelGains(mode, channels);
  return `pan=mono|c0=${left}*c0+${right}*c1`;
}
