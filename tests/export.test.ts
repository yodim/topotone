import { describe, expect, it } from 'vitest';
import { MAX_PANORAMA_AREA, MAX_PANORAMA_WIDTH, panoramaLayout } from '../src/render/export';

describe('panorama layout', () => {
  it('uses the ground speed for a short stretch', () => {
    const l = panoramaLayout(10, 70, 1080, false);
    expect(l.chunkPx).toBe(256);
    expect(l.pxPerSecond).toBe(64);
    expect(l.squeeze).toBe(1);
    expect(Math.abs(l.width - 60 * 64)).toBeLessThanOrEqual(1);
    expect(l.t0).toBeLessThanOrEqual(10);
    expect(l.t0 * l.pxPerSecond).toBe(l.origin);
  });

  it('scales with the height', () => {
    const l = panoramaLayout(0, 30, 720, false);
    // A chunk is a whole number of pixels, so the speed is rounded to a quarter pixel.
    expect(Math.abs(l.pxPerSecond - 64 * (720 / 1080))).toBeLessThanOrEqual(0.125);
    expect(Number.isInteger(l.chunkPx)).toBe(true);
  });

  it('squeezes a long stretch to stay inside the canvas limits', () => {
    for (const caption of [false, true]) {
      const l = panoramaLayout(0, 600, 1080, caption);
      expect(l.squeeze).toBeLessThan(1);
      expect(Number.isInteger(l.chunkPx)).toBe(true);
      expect(l.pxPerSecond).toBe(l.chunkPx / 4);
      expect(l.width).toBeLessThanOrEqual(MAX_PANORAMA_WIDTH);
      expect(l.width * (l.height + l.captionHeight)).toBeLessThanOrEqual(MAX_PANORAMA_AREA);
      // The whole stretch still fits.
      expect(l.t0 + l.width / l.pxPerSecond).toBeGreaterThanOrEqual(600 - 1 / l.pxPerSecond);
    }
  });

  it('keeps a four minute song at nearly full speed', () => {
    expect(panoramaLayout(0, 240, 1080, false).squeeze).toBe(1);
    expect(panoramaLayout(0, 240, 1080, true).squeeze).toBeGreaterThan(0.95);
  });
});
