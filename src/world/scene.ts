/**
 * The scene contract. What the generator produces and every style consumes.
 * Scene data describes shapes and roles, never colors, brushes or textures.
 *
 * Change this file only deliberately. Record any change in PLAN.md.
 */

/** Seconds of music covered by one chunk. */
export const CHUNK_SECONDS = 4;

/**
 * Ridge intervals per chunk. A ridge holds RIDGE_SAMPLES + 1 heights: the last one sits
 * exactly at the start of the next chunk, and both chunks compute it from the same function,
 * so the edge value matches on both sides.
 */
export const RIDGE_SAMPLES = 128;

export type LayerRole = 'far-range' | 'mid-range' | 'hills' | 'ground';

export interface LayerSpec {
  role: LayerRole;
  /** 0 is the horizon, 1 is the foreground. */
  depth: number;
}

/** Ordered far to near. */
export const LAYERS: readonly LayerSpec[] = [
  { role: 'far-range', depth: 0.1 },
  { role: 'mid-range', depth: 0.35 },
  { role: 'hills', depth: 0.65 },
  { role: 'ground', depth: 1 },
];

export type WorldObjectKind = 'tree' | 'rock' | 'grass' | 'bird' | 'lone-peak';

export interface WorldObject {
  kind: WorldObjectKind;
  /** Music time it belongs to, in seconds. */
  t: number;
  /** 0..1 */
  size: number;
  /** 0..1, each style decides what it means (species, shape). */
  variant: number;
  /** Per-object seed for deterministic detail. */
  seed: number;
}

export interface WaterSpan {
  t0: number;
  t1: number;
  /** 0..1 */
  width: number;
  /** 0 rough, 1 mirror-still. */
  calm: number;
}

export interface SkyState {
  /** 0 calm, 1 dramatic. */
  mood: number;
  /** 0 dusk, 1 bright day. */
  brightness: number;
  cloudiness: number;
  mist: number;
  /** Palette temperature hint. Styles may use or ignore it. */
  warmth: number;
}

/** One layer of the world over one stretch of music time. Generated once, then frozen. */
export interface LayerChunk {
  role: LayerRole;
  depth: number;
  /** Covers music time [index * CHUNK_SECONDS, (index + 1) * CHUNK_SECONDS). */
  index: number;
  /** Derived from the world seed, role and index. */
  seed: number;
  /**
   * Heights 0..1, RIDGE_SAMPLES + 1 values evenly spaced from the chunk start to the
   * chunk end, both included.
   */
  ridge: Float32Array;
  objects: WorldObject[];
  water: WaterSpan[];
}

/** Music time at the start of a chunk. */
export function chunkStart(index: number): number {
  return index * CHUNK_SECONDS;
}

/** Index of the chunk that contains music time t. */
export function chunkIndexAt(t: number): number {
  return Math.floor(t / CHUNK_SECONDS);
}
