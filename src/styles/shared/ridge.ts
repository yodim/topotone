/**
 * Helpers for reading a chunk together with its neighbors, which is what a style needs to
 * draw into the bleed margins.
 */
import { clamp } from '../../core/math';
import {
  CHUNK_SECONDS,
  RIDGE_SAMPLES,
  chunkStart,
  type LayerChunk,
  type WaterSpan,
  type WorldObject,
} from '../../world/scene';
import type { ChunkEnv } from '../types';

export interface Neighbors {
  prev: LayerChunk;
  next: LayerChunk;
}

/** Ridge height at music time t, read from the chunk or its neighbors. Linear between samples. */
export function ridgeAt(chunk: LayerChunk, neighbors: Neighbors, t: number): number {
  const start = chunkStart(chunk.index);
  const source = t < start ? neighbors.prev : t > start + CHUNK_SECONDS ? neighbors.next : chunk;
  const u = clamp(
    ((t - chunkStart(source.index)) / CHUNK_SECONDS) * RIDGE_SAMPLES,
    0,
    RIDGE_SAMPLES,
  );
  const i = Math.min(Math.floor(u), RIDGE_SAMPLES - 1);
  const a = source.ridge[i] ?? 0;
  const b = source.ridge[i + 1] ?? a;
  return a + (b - a) * (u - i);
}

/** Objects of the chunk and of both neighbors, so objects overhanging an edge get drawn. */
export function objectsAround(chunk: LayerChunk, neighbors: Neighbors): WorldObject[] {
  return [...neighbors.prev.objects, ...chunk.objects, ...neighbors.next.objects];
}

/** Water spans of the chunk and of both neighbors. */
export function waterAround(chunk: LayerChunk, neighbors: Neighbors): WaterSpan[] {
  return [...neighbors.prev.water, ...chunk.water, ...neighbors.next.water];
}

/** Music time at chunk-local x. The inverse of env.toX. */
export function timeAt(chunk: LayerChunk, env: ChunkEnv, x: number): number {
  const start = chunkStart(chunk.index);
  return start + (x - env.toX(start)) / env.pxPerSecond;
}

/**
 * A distance along the layer that does not depend on the view size: pixels at the reference
 * height of 1080. Use it to place texture along a ridge, so a pattern keeps its look in the
 * panorama export and in any window.
 */
export function layerDistance(env: ChunkEnv, t: number): number {
  return (t * env.pxPerSecond) / env.scale;
}

/** A ridge sampled across the chunk canvas. */
export interface RidgeLine {
  /** Music time of each sample. */
  ts: Float64Array;
  /** Chunk-local x and y, in CSS pixels. */
  xs: Float64Array;
  ys: Float64Array;
  /** Ridge height 0..1. */
  hs: Float64Array;
}

/**
 * The ridge across the whole chunk canvas, bleed included, every `step` CSS pixels, with
 * one extra sample past each side. Paths built from it start and end outside the canvas.
 */
export function sampleRidge(chunk: LayerChunk, env: ChunkEnv, step = 2): RidgeLine {
  const count = Math.ceil(env.width / step) + 3;
  const line: RidgeLine = {
    ts: new Float64Array(count),
    xs: new Float64Array(count),
    ys: new Float64Array(count),
    hs: new Float64Array(count),
  };
  for (let i = 0; i < count; i++) {
    const x = (i - 1) * step;
    const t = timeAt(chunk, env, x);
    const h = ridgeAt(chunk, env.neighbors, t);
    line.ts[i] = t;
    line.xs[i] = x;
    line.hs[i] = h;
    line.ys[i] = env.toY(h);
  }
  return line;
}

/**
 * Contiguous water cells merged into runs. Water comes in fixed cells of music time, and a
 * river is many cells in a row.
 */
export interface WaterRun {
  t0: number;
  t1: number;
  cells: WaterSpan[];
}

export function waterRuns(spans: readonly WaterSpan[]): WaterRun[] {
  const sorted = [...spans].sort((a, b) => a.t0 - b.t0);
  const runs: WaterRun[] = [];
  for (const span of sorted) {
    const last = runs[runs.length - 1];
    if (last && span.t0 <= last.t1 + 1e-6) {
      if (span.t1 > last.t1) {
        last.t1 = span.t1;
        last.cells.push(span);
      }
    } else {
      runs.push({ t0: span.t0, t1: span.t1, cells: [span] });
    }
  }
  return runs;
}

/**
 * A water value at time t, blended linearly between the centres of neighboring cells, so
 * widths and calm change smoothly along a river.
 */
export function waterValueAt(run: WaterRun, t: number, value: (span: WaterSpan) => number): number {
  const cells = run.cells;
  const first = cells[0];
  if (!first) return 0;
  let prev = first;
  if (t <= (first.t0 + first.t1) / 2) return value(first);
  for (const cell of cells) {
    const c = (cell.t0 + cell.t1) / 2;
    if (t <= c) {
      const p = (prev.t0 + prev.t1) / 2;
      const u = c === p ? 0 : (t - p) / (c - p);
      return value(prev) + (value(cell) - value(prev)) * u;
    }
    prev = cell;
  }
  return value(prev);
}

/**
 * Index ranges [first, last] where `lower` sits below `upper` by more than `min` pixels:
 * the stretches that a band between the two lines covers, such as snow between the ridge and
 * a snow line. Runs shorter than three samples are dropped.
 */
export function bandRuns(
  upper: ArrayLike<number>,
  lower: ArrayLike<number>,
  min = 0.5,
): [number, number][] {
  const runs: [number, number][] = [];
  const n = Math.min(upper.length, lower.length);
  let i = 0;
  while (i < n) {
    if ((lower[i] as number) <= (upper[i] as number) + min) {
      i++;
      continue;
    }
    const first = i;
    while (i < n && (lower[i] as number) > (upper[i] as number) + min) i++;
    if (i - 1 - first >= 2) runs.push([first, i - 1]);
  }
  return runs;
}
