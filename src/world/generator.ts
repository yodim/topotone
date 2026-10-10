/**
 * Builds the world on demand: one LayerChunk per (layer, index), and the sky at any time.
 * Everything is derived from the world seed and the feature frames, so a chunk can be
 * dropped and rebuilt identically at any moment.
 */
import { FeatureCache } from '../audio/cache';
import type { FeatureSource } from '../audio/features';
import { clamp01, lerp, smoothstep } from '../core/math';
import { hashSeed } from '../core/rng';
import {
  MAPPING,
  chunkMargins,
  featureWindow,
  findCrescendos,
  objectsFor,
  ridgeHeight,
  skyAt,
  waterFor,
  type MapContext,
} from './mapping';
import {
  CHUNK_SECONDS,
  LAYERS,
  RIDGE_SAMPLES,
  chunkStart,
  type LayerChunk,
  type SkyState,
} from './scene';
import { ChunkStore } from './store';

/** Live input: how long a far chunk takes to ease from its frozen neighbor's edge. */
const LIVE_JOIN_SECONDS = 2;

/** Sky states are computed per block of this many seconds, on a fixed grid. */
const SKY_BLOCK_SECONDS = 4;
const MAX_SKY_BLOCKS = 128;

/**
 * Near layers are revealed progressively under live input, so their chunks stay open (rebuilt,
 * never cached) until the features for their whole span exist. Far layers are built once from
 * the latest values when they come into view, then frozen.
 */
export function isProgressive(layer: number): boolean {
  return (LAYERS[layer]?.depth ?? 0) >= 0.5;
}

export class World {
  private cache: FeatureCache;
  private causal = false;
  private readonly store = new ChunkStore(LAYERS.length);
  private readonly skyBlocks = new Map<number, SkyState[]>();
  private built = 0;

  constructor(
    readonly seed: number,
    readonly source: FeatureSource,
    /** World time up to which features are final. Finite only while a live source runs. */
    private readonly liveUntil: () => number = () => Infinity,
  ) {
    this.cache = new FeatureCache(source, undefined, undefined, liveUntil);
  }

  chunk(layer: number, index: number): LayerChunk {
    if (this.isOpen(layer, index)) return this.build(layer, index);
    return this.store.get(layer, index, () => this.build(layer, index));
  }

  /** True while a near-layer chunk still waits for live features. */
  isOpen(layer: number, index: number): boolean {
    return (
      this.causal && isProgressive(layer) && chunkStart(index) + CHUNK_SECONDS >= this.liveUntil()
    );
  }

  /**
   * Forgets everything built so far. Called when the source timeline changes (a song starts):
   * the world is frozen per timeline, and a new timeline means new land.
   */
  reset(causal = false): void {
    this.causal = causal;
    this.cache = new FeatureCache(this.source, undefined, undefined, this.liveUntil);
    this.store.clear();
    this.skyBlocks.clear();
  }

  /** Lets the store drop chunks of this layer outside [from, to]. */
  retain(layer: number, from: number, to: number): void {
    this.store.retain(layer, from, to);
  }

  skyAt(t: number): SkyState {
    const step = MAPPING.sky.grid;
    const g = Math.floor(t / step);
    const a = this.skyAtGrid(g);
    const b = this.skyAtGrid(g + 1);
    const u = t / step - g;
    return {
      mood: lerp(a.mood, b.mood, u),
      brightness: lerp(a.brightness, b.brightness, u),
      cloudiness: lerp(a.cloudiness, b.cloudiness, u),
      mist: lerp(a.mist, b.mist, u),
      warmth: lerp(a.warmth, b.warmth, u),
    };
  }

  stats() {
    return {
      chunks: this.store.size,
      chunksBuilt: this.built,
      frameBlocks: this.cache.size,
      skyBlocks: this.skyBlocks.size,
    };
  }

  private build(layer: number, index: number): LayerChunk {
    const spec = LAYERS[layer];
    if (!spec) throw new Error(`No layer ${layer}`);
    const t0 = chunkStart(index);
    const t1 = t0 + CHUNK_SECONDS;
    const { before, after } = chunkMargins(this.causal);
    const frames = this.cache.frames(t0 - before, t1 + after);
    const win = featureWindow(frames, this.causal);
    const c = MAPPING.crescendo;
    // Events that reach into this chunk: peaks on either side, birds, and a drop's lift.
    const reach = Math.max(c.peakRadius, c.birdSpread * 1.4, MAPPING.drop.liftSeconds);
    const ctx: MapContext = {
      seed: this.seed,
      win,
      crescendos: findCrescendos(win, this.seed, t0 - reach, t1 + reach),
    };

    const ridge = new Float32Array(RIDGE_SAMPLES + 1);
    const step = CHUNK_SECONDS / RIDGE_SAMPLES;
    for (let i = 0; i <= RIDGE_SAMPLES; i++) {
      ridge[i] = ridgeHeight(spec.role, t0 + i * step, ctx);
    }
    // Live input: far layers are frozen when they first come into view, so neighbors can be
    // built from different amounts of audio. A chunk built next to a frozen one starts on its
    // edge and eases into its own shape, so the join never shows as a step.
    const prev =
      this.causal && !isProgressive(layer) ? this.store.peek(layer, index - 1) : undefined;
    const edge = prev?.ridge[RIDGE_SAMPLES];
    if (edge !== undefined) {
      const offset = edge - (ridge[0] as number);
      for (let i = 0; i <= RIDGE_SAMPLES; i++) {
        const w = 1 - smoothstep(0, LIVE_JOIN_SECONDS, i * step);
        ridge[i] = clamp01((ridge[i] as number) + offset * w);
      }
    }

    this.built++;
    return {
      role: spec.role,
      depth: spec.depth,
      index,
      seed: hashSeed(this.seed, spec.role, index),
      ridge,
      objects: objectsFor(spec.role, t0, t1, frames, ctx),
      water: spec.role === 'ground' ? waterFor(t0, t1, ctx) : [],
    };
  }

  private skyAtGrid(g: number): SkyState {
    const step = MAPPING.sky.grid;
    const perBlock = Math.round(SKY_BLOCK_SECONDS / step);
    const block = Math.floor(g / perBlock);
    let states = this.skyBlocks.get(block);
    if (!states) {
      const from = block * perBlock;
      const before = this.causal ? MAPPING.sky.toneWindow + 1 : MAPPING.sky.toneWindow / 2 + 1;
      const after = this.causal ? 1 : MAPPING.sky.toneWindow / 2 + 1;
      const end = (from + perBlock) * step;
      const win = featureWindow(this.cache.frames(from * step - before, end + after), this.causal);
      states = Array.from({ length: perBlock }, (_, i) => skyAt((from + i) * step, win, this.seed));
      // A block whose features are still arriving is recomputed next time instead of kept.
      if (end + 1 < this.liveUntil()) this.skyBlocks.set(block, states);
      while (this.skyBlocks.size > MAX_SKY_BLOCKS) {
        const oldest = this.skyBlocks.keys().next().value;
        if (oldest === undefined) break;
        this.skyBlocks.delete(oldest);
      }
    }
    const state = states[g - block * perBlock];
    if (!state) throw new Error('sky grid out of range');
    return state;
  }
}
