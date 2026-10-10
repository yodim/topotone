/**
 * Caches feature frames in fixed blocks of time, so the generator can ask for overlapping
 * ranges (neighbor chunks, sky windows) without recomputing or re-reading frames.
 * Least recently used blocks are dropped once the cache is full.
 */
import type { FeatureFrame, FeatureSource } from './features';

export class FeatureCache {
  private readonly blocks = new Map<number, FeatureFrame[]>();

  constructor(
    private readonly source: FeatureSource,
    private readonly blockSeconds = 2,
    private readonly maxBlocks = 256,
  ) {}

  /** Frames with t in [from, to), in time order. */
  frames(from: number, to: number): FeatureFrame[] {
    const out: FeatureFrame[] = [];
    if (!(to > from)) return out;
    const first = Math.floor(from / this.blockSeconds);
    const last = Math.floor(to / this.blockSeconds);
    for (let b = first; b <= last; b++) {
      for (const frame of this.block(b)) {
        if (frame.t >= from && frame.t < to) out.push(frame);
      }
    }
    return out;
  }

  get size(): number {
    return this.blocks.size;
  }

  private block(b: number): FeatureFrame[] {
    const hit = this.blocks.get(b);
    if (hit) {
      // Move to the back: the map's insertion order doubles as the LRU order.
      this.blocks.delete(b);
      this.blocks.set(b, hit);
      return hit;
    }
    const frames = this.source.frames(b * this.blockSeconds, (b + 1) * this.blockSeconds);
    this.blocks.set(b, frames);
    while (this.blocks.size > this.maxBlocks) {
      const oldest = this.blocks.keys().next().value;
      if (oldest === undefined) break;
      this.blocks.delete(oldest);
    }
    return frames;
  }
}
