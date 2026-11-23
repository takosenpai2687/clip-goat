import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Filmstrip } from '../lib/filmstrip';
import { clamp, formatTime } from '../lib/format';
import { nearestKeyframe, type Edge, type Range } from '../lib/segments';
import type { Segment } from '../../../shared/types';
import { useT } from '../lib/i18n';

const PAD = 12;
const TRACK_HEIGHT = 64;
const SNAP_PX = 8;

interface TimelineProps {
  src: string | null;
  duration: number;
  fps: number;
  aspect: number;
  /** The part of the video the track currently shows. */
  view: Segment;
  onView: (view: Segment) => void;
  segments: Range[];
  activeId: number | null;
  onActivate: (id: number) => void;
  onEdge: (id: number, edge: Edge, time: number) => void;
  currentTime: number;
  onSeek: (time: number) => void;
  keyframes: number[] | null;
}

interface Tile {
  x: number;
  w: number;
  time: number;
}

export default function Timeline({
  src,
  duration,
  fps,
  aspect,
  view,
  onView,
  segments,
  activeId,
  onActivate,
  onEdge,
  currentTime,
  onSeek,
  keyframes,
}: TimelineProps) {
  const t = useT();
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const filmRef = useRef<Filmstrip | null>(null);
  const dragRef = useRef<{ id: number; edge: Edge; offset: number } | null>(null);
  const [width, setWidth] = useState(0);
  const [tick, setTick] = useState(0);
  const [drag, setDrag] = useState<{ id: number; edge: Edge; snapped: boolean } | null>(null);

  const span = view.end - view.start;
  const pps = width > 0 ? width / span : 0;
  const xOf = (time: number): number => (time - view.start) * pps;

  const timeAt = useCallback(
    (clientX: number): number => {
      const rect = (shellRef.current as HTMLDivElement).getBoundingClientRect();
      return view.start + ((clientX - rect.left - PAD) / Math.max(1, rect.width - PAD * 2)) * (view.end - view.start);
    },
    [view],
  );

  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => setWidth(Math.max(0, el.clientWidth - PAD * 2)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const film = new Filmstrip(() => setTick((n) => n + 1));
    filmRef.current = film;
    return () => film.destroy();
  }, []);

  useEffect(() => {
    if (filmRef.current) filmRef.current.setSource(src);
  }, [src]);

  // Tiles sit on a time grid that halves with each zoom level, so panning reuses captured frames.
  const tiles = useCallback((): Tile[] => {
    if (!width || !duration) return [];
    const baseSlots = Math.max(1, Math.round(width / (TRACK_HEIGHT * (aspect || 16 / 9))));
    const level = Math.max(0, Math.round(Math.log2(duration / span)));
    const step = duration / baseSlots / 2 ** level;
    const out: Tile[] = [];
    for (let k = Math.floor(view.start / step); k * step < view.end; k++) {
      out.push({ x: xOf(k * step), w: step * pps, time: Math.min(Math.max(0, duration - 0.05), k * step + step / 2) });
    }
    return out;
  }, [width, duration, aspect, span, view.start, view.end, pps]);

  useEffect(() => {
    if (!src) return undefined;
    const timer = setTimeout(() => filmRef.current?.request(tiles().map((tile) => tile.time)), 80);
    return () => clearTimeout(timer);
  }, [src, tiles]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return undefined;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(TRACK_HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    const film = filmRef.current;
    if (!ctx || !film) return undefined;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, TRACK_HEIGHT);

    const now = performance.now();
    let fading = false;
    for (const tile of tiles()) {
      const exact = film.get(tile.time);
      const entry = exact || film.nearest(tile.time);
      if (!entry) continue;
      const alpha = exact ? clamp((now - exact.at) / 220, 0, 1) : 0.45;
      if (exact && alpha < 1) fading = true;
      const img = entry.canvas;
      const scale = Math.max(tile.w / img.width, TRACK_HEIGHT / img.height);
      const sw = tile.w / scale;
      const sh = TRACK_HEIGHT / scale;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, tile.x, 0, tile.w + 0.5, TRACK_HEIGHT);
    }
    ctx.globalAlpha = 1;

    // Keyframe marks, only when they are far enough apart to read.
    if (keyframes && keyframes.length > 1 && pps * (duration / keyframes.length) >= 7) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (const kf of keyframes) {
        if (kf < view.start) continue;
        if (kf > view.end) break;
        ctx.fillRect(Math.round(xOf(kf)), TRACK_HEIGHT - 6, 1, 6);
      }
    }

    if (!fading) return undefined;
    const raf = requestAnimationFrame(() => setTick((n) => n + 1));
    return () => cancelAnimationFrame(raf);
  }, [tick, tiles, width, keyframes, duration, pps, view.start, view.end]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!duration) return;
      event.preventDefault();
      const minSpan = Math.min(duration, Math.max(1, 30 / (fps || 30)));
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const delta = ((event.deltaX || event.deltaY) / Math.max(1, width)) * span;
        const start = clamp(view.start + delta, 0, duration - span);
        onView({ start, end: start + span });
        return;
      }
      const anchor = clamp(timeAt(event.clientX), view.start, view.end);
      const nextSpan = clamp(span * Math.exp(event.deltaY * 0.0015), minSpan, duration);
      const start = clamp(anchor - (anchor - view.start) * (nextSpan / span), 0, duration - nextSpan);
      onView({ start, end: start + nextSpan });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [duration, fps, width, span, view, onView, timeAt]);

  const frame = (time: number): number => (fps > 0 ? Math.round(time * fps) / fps : time);

  const startHandleDrag = (event: PointerEvent<HTMLElement>, seg: Range, edge: Edge) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onActivate(seg.id);
    dragRef.current = { id: seg.id, edge, offset: timeAt(event.clientX) - seg[edge] };
    setDrag({ id: seg.id, edge, snapped: false });
  };

  const moveHandle = (event: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    let time = clamp(timeAt(event.clientX) - d.offset, 0, duration);
    let snapped = false;
    if (d.edge === 'start' && keyframes && keyframes.length && !event.altKey) {
      const kf = nearestKeyframe(keyframes, time);
      if (kf !== null && Math.abs(kf - time) * pps <= SNAP_PX) {
        time = kf;
        snapped = true;
      }
    }
    if (!snapped) time = frame(time);
    onEdge(d.id, d.edge, time);
    setDrag((prev) => (prev && prev.snapped !== snapped ? { ...prev, snapped } : prev));
  };

  const endHandleDrag = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const nudge = (event: KeyboardEvent<HTMLElement>, seg: Range, edge: Edge) => {
    const step = (event.shiftKey ? 1 : 1 / (fps || 30)) * (event.key === 'ArrowLeft' ? -1 : 1);
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    onActivate(seg.id);
    onEdge(seg.id, edge, clamp(seg[edge] + step, 0, duration));
  };

  const scrub = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const time = clamp(timeAt(event.clientX), 0, duration);
    const hit = segments.find((s) => time >= s.start && time <= s.end);
    if (hit) onActivate(hit.id);
    onSeek(time);
  };

  const scrubMove = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onSeek(clamp(timeAt(event.clientX), 0, duration));
  };

  // Pan by dragging the overview thumb.
  const panRef = useRef<{ x: number; start: number; width: number } | null>(null);
  const startPan = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { x: event.clientX, start: view.start, width: (event.currentTarget.parentElement as HTMLElement).clientWidth };
  };
  const movePan = (event: PointerEvent<HTMLElement>) => {
    const p = panRef.current;
    if (!p) return;
    const start = clamp(p.start + ((event.clientX - p.x) / p.width) * duration, 0, duration - span);
    onView({ start, end: start + span });
  };

  const gaps: [number, number][] = [];
  let cursor = view.start;
  for (const seg of segments) {
    if (seg.start > cursor) gaps.push([cursor, Math.min(seg.start, view.end)]);
    cursor = Math.max(cursor, seg.end);
  }
  if (cursor < view.end) gaps.push([cursor, view.end]);

  const dragged = drag && segments.find((s) => s.id === drag.id);
  const zoomed = span < duration - 1e-6;

  return (
    <div className="timeline">
      <div className="bubble-layer">
        <AnimatePresence>
          {dragged && (
            <motion.div
              key="bubble"
              className="bubble num"
              style={{ left: PAD + clamp(xOf(dragged[drag.edge]), 0, width) }}
              initial={{ opacity: 0, y: 6, scale: 0.96, x: '-50%' }}
              animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
              exit={{ opacity: 0, y: 4, scale: 0.98, x: '-50%' }}
              transition={{ duration: 0.14 }}
            >
              {formatTime(dragged[drag.edge])}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div
        ref={shellRef}
        className="track-shell"
        role="group"
        aria-label={t.timeline}
        onPointerDown={scrub}
        onPointerMove={scrubMove}
      >
        <div className="track">
          <canvas ref={canvasRef} className="filmstrip" style={{ width, height: TRACK_HEIGHT }} />

          {gaps.map(([a, b], i) => (
            <div key={i} className="shade" style={{ left: xOf(a), width: Math.max(0, xOf(b) - xOf(a)) }} />
          ))}

          {segments.map((seg) => {
            const active = seg.id === activeId;
            const isDragging = drag && drag.id === seg.id;
            return (
              <div
                key={seg.id}
                className={`range${active ? ' is-active' : ''}`}
                style={{ left: xOf(seg.start), width: Math.max(0, xOf(seg.end) - xOf(seg.start)) }}
              >
                {(['start', 'end'] as const).map((edge) => (
                  <motion.button
                    key={edge}
                    type="button"
                    className={`handle handle-${edge}${isDragging && drag.edge === edge ? ' is-dragging' : ''}`}
                    aria-label={`${edge === 'start' ? t.startHandle : t.endHandle} ${formatTime(seg[edge])}`}
                    onPointerDown={(event) => startHandleDrag(event, seg, edge)}
                    onPointerMove={moveHandle}
                    onPointerUp={endHandleDrag}
                    onPointerCancel={endHandleDrag}
                    onKeyDown={(event) => nudge(event, seg, edge)}
                    animate={{ scaleY: isDragging && drag.edge === edge ? (drag.snapped ? 1.12 : 1.06) : 1 }}
                    transition={{ type: 'spring', stiffness: 700, damping: 26 }}
                  >
                    <span className="grip" />
                  </motion.button>
                ))}
              </div>
            );
          })}

          {currentTime >= view.start && currentTime <= view.end && (
            <div className="playhead" style={{ transform: `translateX(${xOf(currentTime)}px)` }} />
          )}
        </div>
      </div>

      <div className="overview">
        <span className="num">{formatTime(view.start)}</span>
        <div className={`overview-bar${zoomed ? ' is-zoomed' : ''}`}>
          <div
            className="overview-thumb"
            style={{ left: `${(view.start / duration) * 100}%`, width: `${(span / duration) * 100}%` }}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={() => (panRef.current = null)}
            onPointerCancel={() => (panRef.current = null)}
          />
        </div>
        <span className="num">{formatTime(view.end)}</span>
      </div>
    </div>
  );
}
