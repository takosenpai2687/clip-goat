const THUMB_HEIGHT = 96;
const MAX_ENTRIES = 600;

const keyOf = (t) => Math.round(t * 100);

// Captures small frames of a video by seeking a hidden <video>, one at a time, and caches them by time.
export class Filmstrip {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.cache = new Map();
    this.queue = [];
    this.busy = false;
    this.token = 0;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.preload = 'auto';
    this.video.crossOrigin = 'anonymous';
  }

  setSource(src) {
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

  get(t) {
    return this.cache.get(keyOf(t)) || null;
  }

  // Closest cached frame, shown until the exact one arrives.
  nearest(t) {
    let best = null;
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

  request(times) {
    this.queue = times.filter((t) => !this.cache.has(keyOf(t)));
    this.pump();
  }

  seek(t) {
    const video = this.video;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(reject), 5000);
      const onSeeked = () => done(resolve);
      const onError = () => done(reject);
      function done(fn) {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        fn();
      }
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);
      const go = () => {
        video.currentTime = t;
      };
      if (video.readyState >= 1) go();
      else video.addEventListener('loadedmetadata', go, { once: true });
    });
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    const token = this.token;
    while (this.queue.length && token === this.token) {
      const t = this.queue.shift();
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
      canvas.getContext('2d').drawImage(this.video, 0, 0, canvas.width, canvas.height);
      if (this.cache.size >= MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(keyOf(t), { canvas, time: t, at: performance.now() });
      this.onUpdate();
    }
    this.busy = false;
    if (token !== this.token && this.queue.length) this.pump();
  }

  destroy() {
    this.setSource(null);
  }
}
