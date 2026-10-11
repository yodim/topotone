import { describe, expect, it } from 'vitest';
import { SyntheticSource } from '../src/audio/sources/synthetic';
import { createRng } from '../src/core/rng';
import template from '../src/styles/_template/index';
import { DEFAULT_STYLE, STYLES, resolveStyle } from '../src/styles/registry';
import type { ChunkEnv, Style } from '../src/styles/types';
import { World } from '../src/world/generator';
import { CHUNK_SECONDS, LAYERS, chunkStart, type LayerChunk } from '../src/world/scene';
import { recordingContext } from './canvas';

describe('style registry', () => {
  it('uses paper by default and keeps debug reachable', () => {
    expect(DEFAULT_STYLE).toBe('paper');
    expect(resolveStyle(null).id).toBe('paper');
    expect(resolveStyle('no-such-style').id).toBe('paper');
    expect(resolveStyle('debug').id).toBe('debug');
  });

  it('skips the template folder', () => {
    expect(STYLES.has('_template')).toBe(false);
    expect(STYLES.has('template')).toBe(false);
  });

  it('gives every style a name, a description and an author', () => {
    for (const style of STYLES.values()) {
      expect(style.name.length).toBeGreaterThan(0);
      expect(style.description.length).toBeGreaterThan(0);
      expect(style.author.length).toBeGreaterThan(0);
    }
  });
});

const world = new World(1, new SyntheticSource(1, () => 0));
const PPS = 40;

function envFor(chunk: LayerChunk, layer: number): ChunkEnv {
  const start = chunkStart(chunk.index);
  return {
    rng: createRng(chunk.seed),
    sky: world.skyAt(start),
    neighbors: {
      prev: world.chunk(layer, chunk.index - 1),
      next: world.chunk(layer, chunk.index + 1),
    },
    width: CHUNK_SECONDS * PPS + 64,
    height: 400,
    bleed: 32,
    scale: 1,
    pxPerSecond: PPS,
    toX: (t) => 32 + (t - start) * PPS,
    toY: (h) => 380 - h * 300,
  };
}

function draw(style: Style, chunk: LayerChunk, layer: number): string[] {
  const { ctx, log } = recordingContext();
  style.drawLayerChunk(ctx, chunk, envFor(chunk, layer));
  return log;
}

describe('every style', () => {
  for (const style of [...STYLES.values(), template]) {
    it(`${style.id} draws every layer, the sky, the atmosphere and the overlay`, () => {
      LAYERS.forEach((_, layer) => {
        for (const index of [2, 7, 13]) {
          const log = draw(style, world.chunk(layer, index), layer);
          expect(log.length).toBeGreaterThan(0);
          expect(log.join('\n')).not.toMatch(/NaN|Infinity/);
        }
      });
      const view = { width: 800, height: 600, dpr: 1, now: 3, clock: 1 };
      const sky = recordingContext();
      style.drawSky(sky.ctx, world.skyAt(3), view);
      expect(sky.log.length).toBeGreaterThan(0);
      style.drawAtmosphere?.(recordingContext().ctx, 0.5, world.skyAt(3), view);
      style.drawOverlay?.(recordingContext().ctx, view);
      if (style.drawSkyStrip) {
        const strip = recordingContext();
        style.drawSkyStrip(strip.ctx, {
          width: 3000,
          height: 600,
          dpr: 1,
          scale: 600 / 1080,
          t0: -10,
          pxPerSecond: 35,
          skyAt: (t) => world.skyAt(t),
        });
        expect(strip.log.length).toBeGreaterThan(0);
        expect(strip.log.join('\n')).not.toMatch(/NaN|Infinity/);
      }
    });

    it(`${style.id} draws the same chunk the same way twice`, () => {
      LAYERS.forEach((_, layer) => {
        const chunk = world.chunk(layer, 5);
        expect(draw(style, chunk, layer)).toEqual(draw(style, chunk, layer));
      });
    });
  }
});
