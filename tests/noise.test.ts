import { describe, expect, it } from 'vitest';
import { fbm1, fbm2, noise1, noise2 } from '../src/core/noise';

describe('noise', () => {
  it('is deterministic', () => {
    expect(noise1(5, 1.37)).toBe(noise1(5, 1.37));
    expect(noise2(5, 1.37, -4.2)).toBe(noise2(5, 1.37, -4.2));
    expect(fbm1(5, 9.1)).toBe(fbm1(5, 9.1));
    expect(fbm2(5, 9.1, 3.3)).toBe(fbm2(5, 9.1, 3.3));
  });

  it('depends on the seed', () => {
    expect(noise1(1, 0.5)).not.toBe(noise1(2, 0.5));
    expect(noise2(1, 0.5, 0.5)).not.toBe(noise2(2, 0.5, 0.5));
  });

  it('stays within [-1, 1] and uses most of the range', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const x = i * 0.0137 - 100;
      for (const v of [noise1(3, x), noise2(3, x, x * 0.7 + 3), fbm1(3, x), fbm2(3, x, -x)]) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    expect(min).toBeLessThan(-0.6);
    expect(max).toBeGreaterThan(0.6);
  });

  it('is continuous', () => {
    for (let i = 0; i < 1000; i++) {
      const x = i * 0.173 - 50;
      expect(Math.abs(noise1(8, x + 1e-4) - noise1(8, x))).toBeLessThan(1e-3);
      expect(Math.abs(noise2(8, x + 1e-4, x) - noise2(8, x, x))).toBeLessThan(1e-3);
    }
  });

  it('is zero on integer lattice points', () => {
    expect(noise1(4, 3)).toBe(0);
    expect(noise2(4, 3, -2)).toBe(0);
  });
});
