/**
 * Ukiyo-e woodblock print. Flat blocks of a few inks printed slightly off a steady black
 * keyline, bokashi in the sky, striated distant ranges with snow, long banded clouds,
 * scalloped water with foam curls, and pines with flat stacked canopies. Faint wood grain
 * shows through the large flat areas.
 */
import { smoothstep } from '../../core/math';
import { hash01 } from '../../core/rng';
import {
  CHUNK_SECONDS,
  LAYERS,
  chunkIndexAt,
  chunkStart,
  type WorldObject,
} from '../../world/scene';
import { objectsAround, ridgeAt, sampleRidge, waterAround } from '../shared/ridge';
import type { ChunkEnv, Style } from '../types';
import { drawBlock, drawKeyline, drawSnow, drawStriations, drawWater, keylineWidth } from './land';
import { buildLook } from './look';
import { drawCut, type Cut } from './plants';
import { drawAtmosphere, drawSky, drawSkyStrip } from './sky';

const ukiyoe: Style = {
  id: 'ukiyoe',
  name: 'Ukiyo-e woodblock',
  description: 'Flat inks off a black keyline, bokashi skies, banded clouds and scalloped waves.',
  author: 'Topotone',

  setup(env) {
    buildLook(env.seed, env.dpr);
  },

  drawSky,
  drawSkyStrip,
  drawAtmosphere,

  drawLayerChunk(ctx, chunk, env: ChunkEnv) {
    const layer = Math.max(
      0,
      LAYERS.findIndex((l) => l.role === chunk.role),
    );
    const line = sampleRidge(chunk, env, 2);
    const objects = objectsAround(chunk, env.neighbors);
    drawBlock(ctx, chunk, env, line, layer);
    drawStriations(ctx, chunk, env, line, layer);
    drawSnow(ctx, chunk, env, line);
    if (chunk.role === 'ground') drawWater(ctx, chunk, env, waterAround(chunk, env.neighbors));
    drawKeyline(ctx, env, line);

    const k = env.scale * (0.4 + 0.6 * chunk.depth);
    const bright = env.sky.brightness;
    const cut: Cut = {
      ctx,
      k,
      line: Math.max(1, keylineWidth(env) * (0.6 + 0.4 * chunk.depth)),
      // Blossom needs a bright mood, and only trees clear of their chunk's edges may
      // blossom: a tree across an edge is drawn by two chunks with different skies, and
      // must look the same in both.
      blossom: (o) =>
        hash01(o.seed, 'blossom') < 0.6 * smoothstep(0.45, 0.7, bright) && clearOfEdges(o, env, k),
    };
    for (const o of objects) {
      if (o.kind === 'lone-peak') continue;
      const x = env.toX(o.t);
      if (x < -90 * env.scale || x > env.width + 90 * env.scale) continue;
      const y = env.toY(ridgeAt(chunk, env.neighbors, o.t));
      drawCut(cut, o, x, y);
    }
  },
};

/**
 * True when a round tree drawn at this size stays inside the chunk that owns it: its crown
 * and blossoms reach about half its height to each side, plus the misregistration.
 */
function clearOfEdges(o: WorldObject, env: ChunkEnv, k: number): boolean {
  const start = chunkStart(chunkIndexAt(o.t));
  const reach = ((18 + 34 * o.size) * k) / env.pxPerSecond;
  return o.t - reach > start && o.t + reach < start + CHUNK_SECONDS;
}

export default ukiyoe;
