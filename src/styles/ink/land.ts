/**
 * Ranges in ink: a wash that fades downward into the paper, a brush outline along the ridge
 * that swells, thins and sometimes breaks, short texture strokes on the slopes (more where
 * the land is steep and broken) and moss dots on the crests. Water is left as bare paper
 * with a few thin lines.
 */
import { clamp01, smoothstep } from '../../core/math';
import { noise1 } from '../../core/noise';
import { hashSeed } from '../../core/rng';
import { CHUNK_SECONDS, chunkStart, type LayerChunk } from '../../world/scene';
import { deviceScale } from '../shared/canvas';
import { roughen } from '../shared/edges';
import { css } from '../shared/palette';
import {
  layerDistance,
  ridgeAt,
  timeAt,
  waterRuns,
  waterValueAt,
  type RidgeLine,
} from '../shared/ridge';
import { variableStroke } from '../shared/stroke';
import type { ChunkEnv } from '../types';
import { INK, PAPER } from './look';

/** How dark each depth is painted: distance is shown by tone alone. */
export interface Tone {
  /** Wash alpha just under the ridge, and what is left of it far below. */
  wash: number;
  rest: number;
  /** Outline alpha and width (CSS pixels at scale 1). */
  line: number;
  width: number;
}

export function toneFor(depth: number): Tone {
  return {
    wash: 0.14 + 0.6 * depth,
    rest: depth >= 1 ? 0.2 : 0.03 * depth,
    line: 0.3 + 0.62 * depth,
    width: 1.1 + 2.2 * depth,
  };
}

/** The wash: one column every two device pixels, each with the same gradient, stretched. */
export function drawWash(
  ctx: CanvasRenderingContext2D,
  chunk: LayerChunk,
  env: ChunkEnv,
  line: RidgeLine,
  tone: Tone,
): void {
  const d = deviceScale(ctx);
  const k = env.scale;
  const seed = hashSeed('ink', chunk.role, 'wash');
  const g = ctx.createLinearGradient(0, 0, 0, 100);
  g.addColorStop(0, css(INK, tone.wash));
  g.addColorStop(0.35, css(INK, tone.wash * 0.55));
  g.addColorStop(1, css(INK, tone.rest));
  ctx.fillStyle = g;
  const step = 2 / d;
  const fadeBase = (60 + 120 * chunk.depth) * k;
  const columns = Math.ceil(env.width / step) + 2;
  // The fade is measured from a smoothed ridge, so a jagged crest does not drag the wash up
  // and down from one column to the next.
  const reach = Math.min(0.6, (24 * k) / env.pxPerSecond);
  const smooth = (t: number) => {
    let sum = 0;
    for (let i = -4; i <= 4; i++) sum += ridgeAt(chunk, env.neighbors, t + (i / 4) * reach);
    return env.toY(sum / 9);
  };
  for (let c = 0; c < columns; c++) {
    const x = (c - 1) * step;
    const t = timeAt(chunk, env, x);
    const u = layerDistance(env, t);
    const y = env.toY(ridgeAt(chunk, env.neighbors, t));
    const anchor = smooth(t) - 4 * k;
    // Longer fades and paler patches come and go slowly along the range.
    const fade = fadeBase * (1 + 0.18 * noise1(seed, u / 180));
    const strength = 0.92 + 0.08 * noise1(hashSeed(seed, 'tone'), u / 260);
    const sy = fade / 100;
    ctx.globalAlpha = clamp01(strength);
    // The gradient starts at the anchor; the column itself starts at the ridge.
    ctx.setTransform(d, 0, 0, d * sy, d * x, d * anchor);
    ctx.fillRect(0, (y + 0.5 * k - anchor) / sy, step + 0.02, (env.height - y) / sy + 1);
  }
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.globalAlpha = 1;
}

/** The ridge outline: a brush that presses and lifts, with dry breaks now and then. */
export function drawOutline(
  ctx: CanvasRenderingContext2D,
  chunk: LayerChunk,
  env: ChunkEnv,
  line: RidgeLine,
  tone: Tone,
): void {
  const k = env.scale;
  const seed = hashSeed('ink', chunk.role, 'outline');
  const along = Array.from(line.ts, (t) => layerDistance(env, t));
  const ys = roughen(
    line.ys,
    along,
    { seed, wobble: 0.6, wobbleLength: 30, jitter: 0.25, jitterLength: 4 },
    k,
  );
  ctx.fillStyle = css(INK, tone.line);
  variableStroke(ctx, line.xs, ys, (_, i) => {
    const u = along[i] as number;
    const press = 0.55 + 0.45 * noise1(hashSeed(seed, 'press'), u / 80);
    const dry = smoothstep(0.35, 0.6, noise1(hashSeed(seed, 'dry'), u / 150));
    return tone.width * k * Math.max(0.12, press * (1 - 0.85 * dry));
  });
}

/**
 * Texture strokes (short, tapering, pointing downhill) and moss dots. Candidates come from
 * env.rng in a fixed number and order, and lie wholly inside the chunk, so a redraw or a
 * neighbor never cuts one in half.
 */
export function drawTexture(
  ctx: CanvasRenderingContext2D,
  chunk: LayerChunk,
  env: ChunkEnv,
  tone: Tone,
): void {
  const k = env.scale;
  const pps = env.pxPerSecond;
  const start = chunkStart(chunk.index);
  const spanPx = CHUNK_SECONDS * pps;
  const depth = chunk.depth;
  const size = k * (0.55 + 0.45 * depth);
  const margin = (16 * size) / pps;
  const h = (t: number) => env.toY(ridgeAt(chunk, env.neighbors, t));
  const delta = Math.max(0.08, 6 / pps);
  const fade = (60 + 120 * depth) * k;

  const strokes = Math.round(spanPx / ((depth >= 1 ? 9 : 5) * Math.max(0.5, k)));
  ctx.fillStyle = css(INK, Math.min(0.85, tone.wash + 0.22));
  for (let i = 0; i < strokes; i++) {
    const u = env.rng.next();
    const down = env.rng.next();
    const len = env.rng.next();
    const roll = env.rng.next();
    const t = start + margin + u * (CHUNK_SECONDS - 2 * margin);
    const y0 = h(t - delta);
    const y1 = h(t + delta);
    const y = h(t);
    const slope = (y1 - y0) / (2 * delta * pps);
    const bend = Math.abs(y0 - 2 * y + y1) / (delta * pps);
    // Tall peaks of the distant range get more strokes, as if the brush went back to them.
    const tall = depth < 0.3 ? 0.7 * smoothstep(0.62, 0.9, ridgeAt(chunk, env.neighbors, t)) : 0;
    const rugged = clamp01(0.04 + 0.9 * Math.abs(slope) + 1.5 * bend + tall);
    if (roll > rugged) continue;
    // Downhill along the slope, pulled towards vertical.
    let dx = slope >= 0 ? 1 : -1;
    let dy = Math.abs(slope) + 0.9;
    const n = Math.hypot(dx, dy);
    dx /= n;
    dy /= n;
    const l = (5 + 10 * len) * size;
    const x = env.toX(t);
    const sy = y + (3 + down * 0.55 * fade);
    const w = 1.5 * size;
    variableStroke(
      ctx,
      [x, x + dx * l * 0.5, x + dx * l],
      [sy, sy + dy * l * 0.5, sy + dy * l],
      (q) => w * (1 - 0.8 * q),
    );
  }

  if (depth < 0.3 || depth >= 1) return;
  const dots = Math.round(spanPx / (16 * Math.max(0.5, k)));
  ctx.fillStyle = css(INK, Math.min(0.9, tone.line + 0.1));
  for (let i = 0; i < dots; i++) {
    const u = env.rng.next();
    const roll = env.rng.next();
    const count = 1 + Math.floor(env.rng.next() * 3);
    const t = start + margin + u * (CHUNK_SECONDS - 2 * margin);
    const y = h(t);
    // Crests get dots; slopes rarely.
    const crest = y <= h(t - delta) && y <= h(t + delta);
    if (roll > (crest ? 0.8 : 0.12)) continue;
    for (let j = 0; j < count; j++) {
      const ox = (j - (count - 1) / 2) * 3.2 * size;
      const oy = h(t + ox / pps) - 1.5 * size - Math.abs(ox) * 0.15;
      ctx.beginPath();
      ctx.ellipse(env.toX(t) + ox, oy, 1.5 * size, 1.1 * size, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Seconds over which the water's bare paper curves down at each end of a run. */
const END = 0.8;

/** Water is bare paper, with a few thin broken lines across it. */
export function drawWater(
  ctx: CanvasRenderingContext2D,
  chunk: LayerChunk,
  env: ChunkEnv,
  spans: LayerChunk['water'],
): void {
  if (spans.length === 0) return;
  const k = env.scale;
  const left = timeAt(chunk, env, -4);
  const right = timeAt(chunk, env, env.width + 4);
  const step = 2 / env.pxPerSecond;
  const bottom = env.height + 4;
  const seed = hashSeed('ink', 'water');

  for (const run of waterRuns(spans)) {
    const from = Math.max(run.t0 - 0.1, left);
    const to = Math.min(run.t1 + 0.1, right);
    if (to <= from) continue;
    const surface = (t: number) => {
      const land = waterValueAt(run, t, (s) => ridgeAt(chunk, env.neighbors, (s.t0 + s.t1) / 2));
      const width = waterValueAt(run, t, (s) => s.width);
      const y = env.toY(land + 0.03 + 0.05 * width);
      const edge = Math.min(t - (run.t0 - 0.1), run.t1 + 0.1 - t);
      return y + (1 - smoothstep(0, END, edge)) * (bottom - y);
    };
    const ts: number[] = [];
    for (let t = from; t < to; t += step) ts.push(t);
    ts.push(to);

    ctx.beginPath();
    ctx.moveTo(env.toX(from), bottom);
    for (const t of ts) ctx.lineTo(env.toX(t), surface(t));
    ctx.lineTo(env.toX(to), bottom);
    ctx.closePath();
    ctx.fillStyle = css(PAPER);
    ctx.fill();
    // A soft shore: thin bands of paper above the surface, each paler than the one below,
    // so the land dissolves into the water instead of ending in a cut.
    const bands = 7;
    const shore = 14 * k;
    for (let j = 0; j < bands; j++) {
      ctx.beginPath();
      const lo = (j * shore) / bands;
      const hi = ((j + 1) * shore) / bands;
      ts.forEach((t, i) => {
        const x = env.toX(t);
        const y = surface(t) - hi;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      for (let i = ts.length - 1; i >= 0; i--) {
        const t = ts[i] as number;
        ctx.lineTo(env.toX(t), surface(t) - lo + 0.3);
      }
      ctx.closePath();
      ctx.fillStyle = css(PAPER, (bands - j) / (bands + 1));
      ctx.fill();
    }

    // A few thin lines, broken where the noise says, wavier on rough water.
    ctx.strokeStyle = css(INK, 0.38);
    ctx.lineWidth = 0.9 * k;
    ctx.lineCap = 'round';
    for (let row = 0; row < 4; row++) {
      ctx.beginPath();
      let drawing = false;
      for (const t of ts) {
        const u = layerDistance(env, t);
        // Only where the surface is flat: near the ends it curves down into the banks.
        const inside = t > run.t0 + 0.6 && t < run.t1 - 0.6;
        const on = inside && noise1(hashSeed(seed, row), u / 55) > 0.05 + 0.1 * row;
        if (!on) {
          drawing = false;
          continue;
        }
        const calm = waterValueAt(run, t, (s) => s.calm);
        const wave = (1 - calm) * 1.6 * k * Math.sin(u / 7 + row * 2);
        const x = env.toX(t);
        const y = surface(t) + (5 + 8 * row + 2 * row * row) * k + wave;
        if (y > bottom - 2) continue;
        if (drawing) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        drawing = true;
      }
      ctx.stroke();
    }
  }
}
