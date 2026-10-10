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
