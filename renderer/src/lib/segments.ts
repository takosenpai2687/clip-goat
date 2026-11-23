import { clamp } from './format';
import type { Segment } from '../../../shared/types';

/** A range on the timeline, with an id so React and drags can follow it. */
export interface Range extends Segment {
  id: number;
}

export type Edge = 'start' | 'end';

let nextId = 1;
export function makeSegment(start: number, end: number): Range {
  return { id: nextId++, start, end };
}

export function totalLength(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start), 0);
}

export function segmentAt(segments: Range[], t: number): Range | null {
  return segments.find((s) => t >= s.start && t < s.end) || null;
}

// Moves one edge, keeping the range at least minLen long and out of its neighbours.
export function moveEdge(segments: Range[], id: number, edge: Edge, time: number, duration: number, minLen: number): Range[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0) return segments;
  const seg = segments[i];
  const lower = i > 0 ? segments[i - 1].end : 0;
  const upper = i < segments.length - 1 ? segments[i + 1].start : duration;
  const next = edge === 'start' ? { ...seg, start: clamp(time, lower, seg.end - minLen) } : { ...seg, end: clamp(time, seg.start + minLen, upper) };
  return segments.map((s) => (s.id === id ? next : s));
}

// Inside a range: split it at t, leaving a small gap. Outside: start a new range at t.
export function addAt(segments: Range[], t: number, duration: number, viewSpan: number, minLen: number): { segments: Range[]; activeId: number } | null {
  const inside = segments.find((s) => t > s.start && t < s.end);
  if (inside) {
    const gap = Math.min(Math.max(0.2, viewSpan * 0.015), (inside.end - inside.start) / 4);
    const left = makeSegment(inside.start, t - gap / 2);
    const right = makeSegment(t + gap / 2, inside.end);
    if (left.end - left.start < minLen || right.end - right.start < minLen) return null;
    const out = segments.flatMap((s) => (s.id === inside.id ? [left, right] : [s]));
    return { segments: out, activeId: right.id };
  }
  const prevEnd = Math.max(0, ...segments.filter((s) => s.end <= t).map((s) => s.end));
  const nextStart = Math.min(duration, ...segments.filter((s) => s.start >= t).map((s) => s.start));
  const end = Math.min(nextStart, t + Math.max(2, viewSpan * 0.1));
  let start = t;
  if (end - start < minLen) start = Math.max(prevEnd, end - Math.max(2, viewSpan * 0.1));
  if (end - start < minLen) return null;
  const seg = makeSegment(start, end);
  const out = [...segments, seg].sort((a, b) => a.start - b.start);
  return { segments: out, activeId: seg.id };
}

function previousIndex(keyframes: number[], t: number): number {
  let lo = 0;
  let hi = keyframes.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function previousKeyframe(keyframes: number[], t: number): number | null {
  const i = previousIndex(keyframes, t);
  return i < 0 ? null : keyframes[i];
}

export function nearestKeyframe(keyframes: number[], t: number): number | null {
  const i = previousIndex(keyframes, t);
  if (i < 0) return keyframes.length ? keyframes[0] : null;
  const prev = keyframes[i];
  const next = keyframes[i + 1];
  return next !== undefined && next - t < t - prev ? next : prev;
}

// Pulls every start back onto its keyframe so the export can be a stream copy.
export function snapStarts(segments: Range[], keyframes: number[]): Range[] {
  return segments.map((seg, i) => {
    const lower = i > 0 ? segments[i - 1].end : 0;
    const kf = previousKeyframe(keyframes, seg.start);
    return kf !== null && kf >= lower ? { ...seg, start: kf } : seg;
  });
}
