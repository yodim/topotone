import { describe, expect, it } from 'vitest';
import { FeatureCache } from '../src/audio/cache';
import { SyntheticSource } from '../src/audio/sources/synthetic';

describe('FeatureCache', () => {
  it('returns exactly what the source returns', () => {
    const source = new SyntheticSource(3, () => 0);
    const cache = new FeatureCache(source);
    expect(cache.frames(-5.3, 7.9)).toEqual(source.frames(-5.3, 7.9));
    expect(cache.frames(1, 1)).toEqual([]);
  });

  it('stays within its block limit', () => {
    const cache = new FeatureCache(new SyntheticSource(3, () => 0), 2, 10);
    for (let t = 0; t < 100; t += 2) cache.frames(t, t + 2);
    expect(cache.size).toBe(10);
    expect(cache.frames(0, 2).length).toBeGreaterThan(0);
  });
});
