import { describe, expect, it } from 'vitest';
import { createRng, hash01, hashSeed, randomSeed } from '../src/core/rng';

describe('createRng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('gives different sequences for close seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('keeps a fixed sequence across versions', () => {
    const rng = createRng(12345);
    expect(Array.from({ length: 3 }, () => rng.next().toFixed(8))).toMatchInlineSnapshot(`
      [
        "0.18020393",
        "0.15502425",
        "0.51363186",
      ]
    `);
  });

  it('stays in range and looks uniform', () => {
    const rng = createRng(7);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 10000).toBeCloseTo(0.5, 1);
  });

  it('has working helpers', () => {
    const rng = createRng(3);
    const ints = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const r = rng.range(2, 3);
      expect(r).toBeGreaterThanOrEqual(2);
      expect(r).toBeLessThan(3);
      ints.add(rng.int(1, 4));
    }
    expect([...ints].sort()).toEqual([1, 2, 3, 4]);
    expect(['a', 'b']).toContain(rng.pick(['a', 'b']));
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    expect(() => rng.pick([])).toThrow();
  });

  it('gives a roughly normal gaussian', () => {
    const rng = createRng(9);
    const n = 20000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const g = rng.gaussian(10, 2);
      sum += g;
      sq += g * g;
    }
    const mean = sum / n;
    expect(mean).toBeCloseTo(10, 1);
    expect(Math.sqrt(sq / n - mean * mean)).toBeCloseTo(2, 1);
  });
});

describe('hashSeed', () => {
  it('is stable and returns 32-bit unsigned integers', () => {
    const h = hashSeed(1, 'hills', 12);
    expect(h).toBe(hashSeed(1, 'hills', 12));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });

  it('separates different inputs', () => {
    const seen = new Set([
      hashSeed(1, 'a'),
      hashSeed(1, 'b'),
      hashSeed(2, 'a'),
      hashSeed('ab', 'c'),
      hashSeed('a', 'bc'),
      hashSeed(0.5),
      hashSeed(0.25),
    ]);
    expect(seen.size).toBe(7);
  });

  it('treats -0 and 0 alike', () => {
    expect(hashSeed(-0)).toBe(hashSeed(0));
  });

  it('gives hash01 values in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const v = hash01('x', i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('randomSeed', () => {
  it('returns a 32-bit unsigned integer', () => {
    const s = randomSeed();
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
  });
});
