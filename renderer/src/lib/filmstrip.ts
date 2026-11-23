const THUMB_HEIGHT = 96;
const MAX_ENTRIES = 600;

const keyOf = (t: number): number => Math.round(t * 100);

export interface Thumb {
  canvas: HTMLCanvasElement;
  time: number;
  /** When the frame was captured, for the fade-in. */
  at: number;
}

// Captures small frames of a video by seeking a hidden <video>, one at a time, and caches them by time.
export class Filmstrip {
  private cache = new Map<number, Thumb>();
  private queue: number[] = [];
  private busy = false;
  private token = 0;
  private video: HTMLVideoElement;
  private onUpdate: () => void;

  constructor(onUpdate: () => void) {
    this.onUpdate = onUpdate;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.preload = 'auto';
    this.video.crossOrigin = 'anonymous';
  }

  setSource(src: string | null): void {
    this.token++;
    this.cache.clear();
    this.queue = [];
    if (src) {
      this.video.src = src;
    } else {
      this.video.removeAttribute('src');
    }
    this.video.load();
  }

  get(t: number): Thumb | null {
    return this.cache.get(keyOf(t)) || null;
  }

  // Closest cached frame, shown until the exact one arrives.
  nearest(t: number): Thumb | null {
    let best: Thumb | null = null;
    let bestDist = Infinity;
    for (const entry of this.cache.values()) {
      const dist = Math.abs(entry.time - t);
      if (dist < bestDist) {
        best = entry;
        bestDist = dist;
      }
    }
    return best;
  }

  request(times: number[]): void {
    this.queue = times.filter((t) => !this.cache.has(keyOf(t)));
    void this.pump();
  }

  private seek(t: number): Promise<void> {
    const video = this.video;
    return new Promise((resolve, reject) => {
      const done = (fn: () => void) => {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        fn();
      };
      const onSeeked = () => done(resolve);
      const onError = () => done(reject);
      const timer = setTimeout(() => done(reject), 5000);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);
      const go = () => {
        video.currentTime = t;
      };
      if (video.readyState >= 1) go();
      else video.addEventListener('loadedmetadata', go, { once: true });
    });
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const token = this.token;
    while (this.queue.length && token === this.token) {
      const t = this.queue.shift() as number;
      if (this.cache.has(keyOf(t))) continue;
      try {
        await this.seek(t);
      } catch {
        continue;
      }
      if (token !== this.token) break;
      const { videoWidth, videoHeight } = this.video;
      if (!videoWidth || !videoHeight) continue;
      const canvas = document.createElement('canvas');
      canvas.height = THUMB_HEIGHT;
      canvas.width = Math.round((THUMB_HEIGHT * videoWidth) / videoHeight);
      canvas.getContext('2d')?.drawImage(this.video, 0, 0, canvas.width, canvas.height);
      if (this.cache.size >= MAX_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(keyOf(t), { canvas, time: t, at: performance.now() });
      this.onUpdate();
    }
    this.busy = false;
    if (token !== this.token && this.queue.length) void this.pump();
  }

  destroy(): void {
    this.setSource(null);
  }
}
