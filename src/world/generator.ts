/**
 * Builds the world on demand: one LayerChunk per (layer, index), and the sky at any time.
 * Everything is derived from the world seed and the feature frames, so a chunk can be
 * dropped and rebuilt identically at any moment.
 */
import { FeatureCache } from '../audio/cache';
import type { FeatureSource } from '../audio/features';
import { lerp } from '../core/math';
import { hashSeed } from '../core/rng';
import {
  MAPPING,
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

/** Sky states are computed per block of this many seconds, on a fixed grid. */
const SKY_BLOCK_SECONDS = 4;
const MAX_SKY_BLOCKS = 128;

export class World {
  private readonly cache: FeatureCache;
  private readonly store = new ChunkStore(LAYERS.length);
  private readonly skyBlocks = new Map<number, SkyState[]>();
  private built = 0;

  constructor(
    readonly seed: number,
    readonly source: FeatureSource,
  ) {
    this.cache = new FeatureCache(source);
  }

  chunk(layer: number, index: number): LayerChunk {
    return this.store.get(layer, index, () => this.build(layer, index));
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
    const margin = MAPPING.margin;
    const frames = this.cache.frames(t0 - margin, t1 + margin);
    const win = featureWindow(frames);
    const c = MAPPING.crescendo;
    const reach = Math.max(c.peakRadius, c.birdSpread * 1.4);
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
      const half = MAPPING.sky.toneWindow / 2 + 1;
      const win = featureWindow(
        this.cache.frames(from * step - half, (from + perBlock) * step + half),
      );
      states = Array.from({ length: perBlock }, (_, i) => skyAt((from + i) * step, win, this.seed));
      this.skyBlocks.set(block, states);
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
