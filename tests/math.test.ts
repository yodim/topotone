import { describe, expect, it } from 'vitest';
import { softClamp01 } from '../src/core/math';

describe('softClamp01', () => {
  it('leaves the middle alone and never leaves 0..1', () => {
    expect(softClamp01(0.5)).toBe(0.5);
    for (let x = -3; x <= 4; x += 0.01) {
      const y = softClamp01(x);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('keeps rising past the top, so peaks stay rounded', () => {
    expect(softClamp01(1.2)).toBeGreaterThan(softClamp01(1));
    expect(softClamp01(1)).toBeLessThan(1);
    expect(softClamp01(-0.2)).toBeLessThan(softClamp01(0));
  });

  it('is continuous at the knees', () => {
    for (const k of [0.15, 0.85]) {
      expect(Math.abs(softClamp01(k + 1e-9) - softClamp01(k - 1e-9))).toBeLessThan(1e-8);
    }
  });
});
