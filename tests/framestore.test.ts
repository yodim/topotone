import { describe, expect, it } from 'vitest';
import type { FeatureFrame } from '../src/audio/features';
import { BYTES_PER_FRAME, FrameStore } from '../src/audio/framestore';

const HOP = 512 / 48000;

function frame(i: number): FeatureFrame {
  const v = (k: number) => ((i * 7 + k * 13) % 101) / 100;
  return {
    t: i * HOP,
    rms: v(0),
    low: v(1),
    mid: v(2),
    high: v(3),
    centroid: v(4),
    flux: v(5),
    onset: i % 9 === 0 ? v(6) : 0,
    onsetLow: i % 9 === 0 ? v(7) : 0,
    onsetMid: 0,
    onsetHigh: i % 5 === 0 ? v(8) : 0,
    pitch: i % 3 === 0 ? null : v(9),
    pitchConfidence: v(10),
  };
}

describe('FrameStore', () => {
  const n = 10_000; // more than two blocks
  const store = new FrameStore();
  for (let i = 0; i < n; i++) store.push(frame(i));

  it('gives back every frame, to 32-bit precision, across blocks', () => {
    expect(store.length).toBe(n);
    for (const i of [0, 1, 4095, 4096, 4097, 8191, 8192, n - 1]) {
      const got = store.frame(i);
      const want = frame(i);
      expect(got.t).toBe(want.t);
      for (const key of Object.keys(want) as (keyof FeatureFrame)[]) {
        if (want[key] === null) expect(got[key]).toBeNull();
        else expect(got[key]).toBeCloseTo(want[key] as number, 6);
      }
    }
  });

  it('reads the same frame the same way every time', () => {
    expect(store.frame(5000)).toEqual(store.frame(5000));
    expect(store.frame(5000)).not.toBe(store.frame(5000));
  });

  it('finds frames by time and slices within bounds', () => {
    expect(store.indexAt(-1)).toBe(0);
    expect(store.indexAt(4096 * HOP)).toBe(4096);
    expect(store.indexAt(4096 * HOP + 1e-9)).toBe(4097);
    expect(store.indexAt(1e9)).toBe(n);
    const slice = store.slice(store.indexAt(10), store.indexAt(11));
    expect(slice.length).toBe(Math.ceil(11 / HOP) - Math.ceil(10 / HOP));
    expect(slice.every((f) => f.t >= 10 && f.t < 11)).toBe(true);
    expect(store.slice(n - 2, n + 5).length).toBe(2);
  });

  it('takes 56 bytes a frame', () => {
    expect(BYTES_PER_FRAME).toBe(56);
  });
});
