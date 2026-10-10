/**
 * Seeded randomness. The only place in the project allowed to produce random numbers.
 *
 * Everything here uses integer and basic float arithmetic only, never Math.sin, Math.log
 * or Math.exp. Those are not guaranteed to round the same way in every browser, and the
 * world must come out identical everywhere.
 */

export interface Rng {
  /** Next value in [0, 1). */
  next(): number;
  /** Uniform value in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max], both included. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** True with probability p. */
  chance(p: number): boolean;
  /**
   * Roughly normal value: the sum of four uniforms, rescaled. Bounded to about
   * mean ± 3.5 sd, which suits drawing better than a true normal anyway.
   */
  gaussian(mean?: number, sd?: number): number;
}

const TWO_POW_32 = 4294967296;

/** Final mix of murmur3. Spreads every input bit over the whole output. */
function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const floatView = new Float64Array(1);
const wordView = new Uint32Array(floatView.buffer);

function absorb(h: number, word: number): number {
  return (mix32((h ^ word) >>> 0) + 0x9e3779b9) >>> 0;
}

/**
 * Derives a 32-bit seed from any mix of numbers and strings.
 * hashSeed(world, 'hills', 12) is the usual way to get a seed for one part of the world.
 * Numbers are hashed by value, so 3 and 3.0 match, and fractional times work too.
 */
export function hashSeed(...values: readonly (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    if (typeof value === 'string') {
      h = absorb(h, 0x5354_5200 + (value.length & 0xff));
      for (let i = 0; i < value.length; i++) h = absorb(h, value.charCodeAt(i));
    } else {
      floatView[0] = value === 0 ? 0 : value; // folds -0 into 0
      h = absorb(h, wordView[0] ?? 0);
      h = absorb(h, wordView[1] ?? 0);
    }
  }
  return mix32(h);
}

/** A stateless random value in [0, 1) for the given inputs. */
export function hash01(...values: readonly (number | string)[]): number {
  return hashSeed(...values) / TWO_POW_32;
}

/** Fast integer hash for hot loops such as noise: (seed, i) to [0, 1). */
export function hashInt01(seed: number, i: number): number {
  return mix32((seed ^ Math.imul(i | 0, 0x27d4eb2d)) >>> 0) / TWO_POW_32;
}

/** sfc32: small, fast and statistically solid. */
export function createRng(seed: number): Rng {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed >>> 0;

  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / TWO_POW_32;
  };

  // Let the state settle so that close seeds diverge right away.
  for (let i = 0; i < 12; i++) next();

  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from an empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    chance: (p) => next() < p,
    gaussian: (mean = 0, sd = 1) => {
      const sum = next() + next() + next() + next();
      // Four uniforms have variance 4/12; sqrt(3) brings it back to 1.
      return mean + sd * (sum - 2) * 1.7320508075688772;
    },
  };
}

/** A fresh seed for a new world. Used only when the URL does not give one. */
export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  }
  return Math.floor(Math.random() * TWO_POW_32);
}
