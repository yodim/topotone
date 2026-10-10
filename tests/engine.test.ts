import { describe, expect, it } from 'vitest';
import { MAX_DPR, measureSurface } from '../src/render/engine';

describe('measureSurface', () => {
  it('sizes the backing store in device pixels', () => {
    expect(measureSurface(800, 600, 1.5)).toEqual({
      cssWidth: 800,
      cssHeight: 600,
      dpr: 1.5,
      width: 1200,
      height: 900,
    });
  });

  it('caps the device pixel ratio', () => {
    const s = measureSurface(1000, 500, 3);
    expect(s.dpr).toBe(MAX_DPR);
    expect(s.width).toBe(2000);
    expect(s.height).toBe(1000);
  });

  it('falls back to a ratio of 1 for bad values', () => {
    expect(measureSurface(10, 10, 0).dpr).toBe(1);
    expect(measureSurface(10, 10, Number.NaN).dpr).toBe(1);
  });

  it('never returns an empty canvas', () => {
    const s = measureSurface(0, 0, 2);
    expect(s.width).toBe(1);
    expect(s.height).toBe(1);
  });
});
