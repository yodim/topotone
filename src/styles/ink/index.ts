/**
 * Ink painting. Rice paper, ranges as washes that fade downward into mist, a pressing and
 * lifting brush along each ridge, and texture strokes where the land is steep. Distance is
 * shown by tone alone. Water is left as bare paper.
 */
import { objectsAround, ridgeAt, sampleRidge, waterAround } from '../shared/ridge';
import type { ChunkEnv, Style } from '../types';
import { drawOutline, drawTexture, drawWash, drawWater, toneFor } from './land';
import { buildLook } from './look';
import { drawAtmosphere, drawOverlay, drawSky } from './sky';
import { drawMark, type Brush } from './trees';

const ink: Style = {
  id: 'ink',
  name: 'Ink painting',
  description: 'Ink washes on rice paper, brush outlines and drifting mist.',
  author: 'Topotone',

  setup(env) {
    buildLook(env.seed, env.dpr);
  },

  drawSky,
  drawAtmosphere,
  drawOverlay,

  drawLayerChunk(ctx, chunk, env: ChunkEnv) {
    const tone = toneFor(chunk.depth);
    const line = sampleRidge(chunk, env, 2);
    drawWash(ctx, chunk, env, line, tone);
    drawTexture(ctx, chunk, env, tone);
    drawOutline(ctx, chunk, env, line, tone);
    // Water is bare paper laid over the land, so nothing of the riverbed shows through.
    if (chunk.role === 'ground') drawWater(ctx, chunk, env, waterAround(chunk, env.neighbors));

    const brush: Brush = { ctx, k: env.scale * (0.4 + 0.6 * chunk.depth), tone };
    for (const o of objectsAround(chunk, env.neighbors)) {
      const x = env.toX(o.t);
      if (x < -80 * env.scale || x > env.width + 80 * env.scale) continue;
      const y = env.toY(ridgeAt(chunk, env.neighbors, o.t));
      drawMark(brush, o, x, y);
    }
  },
};

export default ink;
