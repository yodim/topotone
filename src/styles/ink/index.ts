/**
 * Ink painting. Rice paper, ranges as washes that fade downward into mist, a pressing and
 * lifting brush along each ridge, and texture strokes where the land is steep. Distance is
 * shown by tone alone. Water is left as bare paper.
 */
import { createRng } from '../../core/rng';
import type { LayerChunk, WorldObject } from '../../world/scene';
import { objectsAround, ridgeAt, sampleRidge, waterAround } from '../shared/ridge';
import { variableStroke } from '../shared/stroke';
import { css } from '../shared/palette';
import type { ChunkEnv, Style } from '../types';
import { drawOutline, drawTexture, drawWash, drawWater, toneFor } from './land';
import { INK, buildLook } from './look';
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
      if (o.kind === 'lone-peak') summit(ctx, chunk, o, x, env);
      else drawMark(brush, o, x, y);
    }
  },
};

/** A lone peak gets a few dark strokes at its summit, as if the brush went back to it. */
function summit(
  ctx: CanvasRenderingContext2D,
  chunk: LayerChunk,
  o: WorldObject,
  x: number,
  env: ChunkEnv,
): void {
  const rng = createRng(o.seed);
  const k = env.scale * 0.7;
  ctx.fillStyle = css(INK, 0.45);
  for (let i = 0; i < 6; i++) {
    const t = o.t + rng.range(-0.8, 0.8);
    const sx = env.toX(t);
    const sy = env.toY(ridgeAt(chunk, env.neighbors, t)) + rng.range(4, 18) * k;
    const l = rng.range(6, 14) * k;
    const side = sx < x ? -1 : 1;
    variableStroke(
      ctx,
      [sx, sx + side * l * 0.3, sx + side * l * 0.5],
      [sy, sy + l * 0.5, sy + l],
      (u) => 1.6 * k * (1 - 0.8 * u),
    );
  }
}

export default ink;
