/**
 * Paper cutout. Each layer is a sheet of colored paper cut along the ridge, with a soft
 * shadow on the sheet behind it and its own fiber texture. Trees, rocks and birds are small
 * cut pieces glued on top; water is a paler sheet with a couple of cut wave strips.
 */
import { hashSeed } from '../../core/rng';
import { LAYERS, type LayerChunk } from '../../world/scene';
import { noShadow, softShadow } from '../shared/canvas';
import { edgeOffset, roughen, type Roughness } from '../shared/edges';
import { alignedPattern } from '../shared/grain';
import { css, mix, shade, type Rgb } from '../shared/palette';
import { layerDistance, objectsAround, ridgeAt, sampleRidge, waterAround } from '../shared/ridge';
import type { ChunkEnv, Style } from '../types';
import { buildLook, look } from './look';
import { drawPiece, drawSnow, type PieceContext } from './objects';
import { shadow } from './palette';
import { drawAtmosphere, drawSky, drawSkyStrip } from './sky';
import { drawWater } from './water';

/** Scissors are not perfectly steady: a slow wobble and a fine jitter along every cut. */
function roughness(role: string, back: boolean): Roughness {
  return {
    seed: hashSeed('paper', role, back ? 'back' : 'front'),
    wobble: 1.3,
    wobbleLength: 46,
    jitter: 0.45,
    jitterLength: 5,
  };
}

/** Fills the current path as a sheet: shadow behind it first, then the grain on top. */
function sheet(
  ctx: CanvasRenderingContext2D,
  color: Rgb,
  grain: CanvasPattern | null,
  blur: number,
  shadowAlpha: number,
): void {
  softShadow(ctx, shadow(shadowAlpha), blur, 0, blur * 0.15);
  ctx.fillStyle = css(color);
  ctx.fill();
  noShadow(ctx);
  if (grain) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = grain;
    ctx.fill();
    ctx.restore();
  }
}

function tracePolygon(
  ctx: CanvasRenderingContext2D,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  bottom: number,
): void {
  const n = xs.length;
  ctx.beginPath();
  ctx.moveTo(xs[0] as number, bottom);
  for (let i = 0; i < n; i++) ctx.lineTo(xs[i] as number, ys[i] as number);
  ctx.lineTo(xs[n - 1] as number, bottom);
  ctx.closePath();
}

function layerIndex(chunk: LayerChunk): number {
  const i = LAYERS.findIndex((l) => l.role === chunk.role);
  return i < 0 ? 0 : i;
}

/** Far range ridge height above which there is snow. Lone peaks rise well above it. */
const SNOW_LINE = 0.74;

/** How far a back sheet's ridge is shifted in time, in seconds. Stays inside the neighbors. */
const BACK_SHIFT = 1.3;

const paper: Style = {
  id: 'paper',
  name: 'Paper cutout',
  description: 'Layers of colored paper cut along the ridges, with soft shadows between them.',
  author: 'Topotone',

  setup(env) {
    buildLook(env.seed, env.dpr);
  },

  drawSky,
  drawSkyStrip,
  drawAtmosphere,

  drawLayerChunk(ctx, chunk, env: ChunkEnv) {
    const { papers, grain, pieceGrain } = look();
    const li = layerIndex(chunk);
    const color = papers.layers[li] ?? papers.layers[0];
    const next = papers.layers[li + 1] ?? shade(color, -0.25);
    const k = env.scale;
    const depth = chunk.depth;
    const bottom = env.height + 4;
    const tile = grain[li];
    const pattern = tile ? alignedPattern(ctx, tile, env.toX(0)) : null;
    const piecePattern = pieceGrain ? alignedPattern(ctx, pieceGrain, env.toX(0)) : null;
    const blur = (10 + 6 * depth) * k;

    const line = sampleRidge(chunk, env, 2);
    const along = Array.from(line.ts, (t) => layerDistance(env, t));
    const ys = roughen(line.ys, along, roughness(chunk.role, false), k);
    tracePolygon(ctx, line.xs, ys, bottom);
    sheet(ctx, color, pattern, blur, 0.24 + 0.14 * depth);

    const pieces: PieceContext = {
      ctx,
      papers,
      sheet: color,
      depth,
      k: k * (0.35 + 0.65 * depth),
      grain: piecePattern,
    };

    // Snow on the high peaks of the far range, before anything is laid in front of it.
    if (chunk.role === 'far-range') drawSnow(pieces, line.xs, ys, along, env.toY(SNOW_LINE));

    // Far and middle ranges get a second, lower sheet in front: foothills cut from a paper
    // between this layer's and the next one's, which doubles the sense of depth.
    if (chunk.role === 'far-range' || chunk.role === 'mid-range') {
      const back = Array.from(line.ts, (t) => {
        const h = ridgeAt(chunk, env.neighbors, t - BACK_SHIFT);
        return env.toY(0.62 * h - 0.04);
      });
      const bys = roughen(back, along, roughness(chunk.role, true), k);
      tracePolygon(ctx, line.xs, bys, bottom);
      sheet(ctx, mix(color, next, 0.38), pattern, blur * 0.8, 0.2 + 0.1 * depth);
    }

    if (chunk.role === 'ground') {
      // A darker verge along the bottom: the nearest strip of land. Water sits behind it.
      const verge = (t: number) =>
        env.toY(-0.1) + edgeOffset(roughness('verge', false), layerDistance(env, t) * 0.35) * 3 * k;
      drawWater(ctx, chunk, env, papers, waterAround(chunk, env.neighbors), piecePattern, verge);
      const vys = Array.from(line.ts, verge);
      const rys = roughen(vys, along, roughness('verge', true), k);
      tracePolygon(ctx, line.xs, rys, bottom);
      sheet(ctx, shade(color, -0.16), pattern, blur * 0.7, 0.3);
    }

    for (const o of objectsAround(chunk, env.neighbors)) {
      if (o.kind === 'lone-peak') continue;
      const x = env.toX(o.t);
      if (x < -80 * k || x > env.width + 80 * k) continue;
      const y = env.toY(ridgeAt(chunk, env.neighbors, o.t)) + 1.5 * k;
      drawPiece(pieces, o, x, y);
    }
  },
};

export default paper;
