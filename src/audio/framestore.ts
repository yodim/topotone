/**
 * Feature frames packed into typed arrays, one column per field, for histories that keep
 * growing (the mic). Kept as objects, a frame measured about 290 bytes in V8, so an hour of
 * listening (about 340,000 frames) held close to 100 MB. Packed, a frame takes 56 bytes and an
 * hour about 19 MB.
 *
 * Time is kept in 64 bits and every other value in 32. A missing pitch is stored as NaN and
 * read back as null. Frames read back are new objects, so the store never changes under
 * whoever holds them.
 */
import type { FeatureFrame } from './features';

/** The fields stored in 32 bits, in column order. */
const FIELDS = [
  'rms',
  'low',
  'mid',
  'high',
  'centroid',
  'flux',
  'onset',
  'onsetLow',
  'onsetMid',
  'onsetHigh',
  'pitch',
  'pitchConfidence',
] as const;

export const BYTES_PER_FRAME = 8 + 4 * FIELDS.length;

/**
 * Frames per block. The store grows a block at a time, so it never copies what it holds and
 * wastes at most one block (about 230 KB).
 */
const BLOCK = 4096;

interface Block {
  times: Float64Array;
  values: Float32Array;
}

export class FrameStore {
  private size = 0;
  private readonly blocks: Block[] = [];

  get length(): number {
    return this.size;
  }

  /** Adds a frame. Frames must arrive in time order. */
  push(frame: FeatureFrame): void {
    const i = this.size % BLOCK;
    if (i === 0) {
      this.blocks.push({
        times: new Float64Array(BLOCK),
        values: new Float32Array(BLOCK * FIELDS.length),
      });
    }
    const block = this.blocks[this.blocks.length - 1] as Block;
    block.times[i] = frame.t;
    const at = i * FIELDS.length;
    FIELDS.forEach((key, k) => {
      const v = frame[key];
      block.values[at + k] = v === null ? Number.NaN : v;
    });
    this.size++;
  }

  /** Time of frame i. */
  timeOf(i: number): number {
    return (this.blocks[Math.floor(i / BLOCK)] as Block).times[i % BLOCK] as number;
  }

  /** Frame i, as a new object. */
  frame(i: number): FeatureFrame {
    const block = this.blocks[Math.floor(i / BLOCK)] as Block;
    const at = (i % BLOCK) * FIELDS.length;
    const v = (k: number) => block.values[at + k] as number;
    const pitch = v(10);
    return {
      t: block.times[i % BLOCK] as number,
      rms: v(0),
      low: v(1),
      mid: v(2),
      high: v(3),
      centroid: v(4),
      flux: v(5),
      onset: v(6),
      onsetLow: v(7),
      onsetMid: v(8),
      onsetHigh: v(9),
      pitch: Number.isNaN(pitch) ? null : pitch,
      pitchConfidence: v(11),
    };
  }

  /** Frames from index `from` up to, not including, `to`. */
  slice(from: number, to: number): FeatureFrame[] {
    const out: FeatureFrame[] = [];
    for (let i = Math.max(0, from); i < Math.min(to, this.size); i++) out.push(this.frame(i));
    return out;
  }

  /** Index of the first frame at or after t. */
  indexAt(t: number): number {
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.timeOf(mid) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
