import { describe, expect, it } from 'vitest';
import { parallax, projectLayer, screenX, timeAtX } from '../src/render/camera';
import { measureSurface } from '../src/render/engine';
import { CHUNK_SECONDS, LAYERS } from '../src/world/scene';

describe('camera', () => {
  it('moves far layers slower than near ones', () => {
    const speeds = LAYERS.map((l) => parallax(l.depth));
    expect(speeds).toEqual([...speeds].sort((a, b) => a - b));
    expect(parallax(1)).toBe(1);
  });

  it('places music time on screen and back', () => {
    const x = screenX(12, 10, 500, 64);
    expect(x).toBe(628);
    expect(timeAtX(x, 10, 500, 64)).toBe(12);
  });

  it('gives whole-pixel chunks and a consistent speed', () => {
    for (const dpr of [1, 1.25, 2]) {
      const surface = measureSurface(1280, 720, dpr);
      for (const spec of LAYERS) {
        const p = projectLayer(spec, surface);
        expect(Number.isInteger(p.chunkPx)).toBe(true);
        expect(p.pxPerSecond * CHUNK_SECONDS * dpr).toBeCloseTo(p.chunkPx, 9);
        expect(p.bleedPx).toBeLessThanOrEqual(p.chunkPx);
        expect(p.topPx + p.heightPx).toBe(surface.height);
      }
    }
  });

  it('maps higher ridges higher on screen, inside the layer canvas', () => {
    const surface = measureSurface(1280, 720, 1);
    for (const spec of LAYERS) {
      const p = projectLayer(spec, surface);
      expect(p.toY(1)).toBeLessThan(p.toY(0));
      expect(p.toY(1)).toBeGreaterThanOrEqual(0);
      expect(p.toY(0)).toBeLessThanOrEqual(p.height);
    }
  });
});
