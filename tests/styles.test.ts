import { describe, expect, it } from 'vitest';
import { SyntheticSource } from '../src/audio/sources/synthetic';
import { createRng } from '../src/core/rng';
import { DEFAULT_STYLE, STYLES, resolveStyle } from '../src/styles/registry';
import type { ChunkEnv } from '../src/styles/types';
import { World } from '../src/world/generator';
import { CHUNK_SECONDS, LAYERS, chunkStart } from '../src/world/scene';

/** A 2D context that accepts every call and records how many were made. */
function fakeContext() {
  let calls = 0;
  const ctx = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'calls') return calls;
        return () => {
          calls++;
          if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
            return { addColorStop() {} };
          }
          if (prop === 'measureText') return { width: 0 };
          return undefined;
        };
      },
      set: () => true,
    },
  );
  return ctx as CanvasRenderingContext2D & { calls: number };
}

describe('style registry', () => {
  it('finds the debug style and uses it by default', () => {
    expect(STYLES.has('debug')).toBe(true);
    expect(resolveStyle(null).id).toBe(DEFAULT_STYLE);
    expect(resolveStyle('no-such-style').id).toBe(DEFAULT_STYLE);
  });

  it('skips the template folder', () => {
    expect(STYLES.has('_template')).toBe(false);
  });
});

describe('every style', () => {
  const world = new World(1, new SyntheticSource(1, () => 0));
  for (const style of STYLES.values()) {
    it(`${style.id} draws every layer without errors`, () => {
      LAYERS.forEach((_, layer) => {
        const chunk = world.chunk(layer, 2);
        const start = chunkStart(2);
        const pps = 40;
        const env: ChunkEnv = {
          rng: createRng(chunk.seed),
          sky: world.skyAt(start),
          neighbors: { prev: world.chunk(layer, 1), next: world.chunk(layer, 3) },
          width: CHUNK_SECONDS * pps + 64,
          height: 400,
          bleed: 32,
          scale: 1,
          toX: (t) => 32 + (t - start) * pps,
          toY: (h) => 380 - h * 300,
        };
        const ctx = fakeContext();
        style.drawLayerChunk(ctx, chunk, env);
        expect(ctx.calls).toBeGreaterThan(0);
      });
      const view = { width: 800, height: 600, dpr: 1, now: 3, clock: 1 };
      style.drawSky(fakeContext(), world.skyAt(3), view);
      style.drawAtmosphere?.(fakeContext(), 0.5, world.skyAt(3), view);
      style.drawOverlay?.(fakeContext(), view);
    });
  }
});
