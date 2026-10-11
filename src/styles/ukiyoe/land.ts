/**
 * Land as woodblock prints: each range is a flat block of color with a gentle bokashi,
 * printed a little off its black keyline. Distant ranges carry parallel striations and snow
 * above a height line. Water is a Prussian blue block with rows of scalloped waves and foam
 * curls where it is rough. Every shape is a function of music time, so chunks join cleanly.
 */
import { clamp01, mod, smoothstep } from '../../core/math';
import { noise1 } from '../../core/noise';
import { hashSeed } from '../../core/rng';
import type { LayerChunk } from '../../world/scene';
import { alignedPattern } from '../shared/grain';
import { css, shade } from '../shared/palette';
import {
  layerDistance,
  ridgeAt,
  timeAt,
  waterRuns,
  waterValueAt,
  bandRuns,
  type RidgeLine,
} from '../shared/ridge';
import type { ChunkEnv } from '../types';
import { look } from './look';
import { KEYLINE, LAYER_INKS, PAPER, SNOW, WATER, WAVE } from './palette';

/** How far each color block is printed off its keyline, in CSS pixels at scale 1. */
export const MISREGISTER = { x: 1.5, y: 1 };

export function keylineWidth(env: ChunkEnv): number {
  return 1.6 * env.scale;
}

function polygon(
  ctx: CanvasRenderingContext2D,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  bottom: number,
  dx = 0,
  dy = 0,
): void {
  const n = xs.length;
  ctx.beginPath();
  ctx.moveTo((xs[0] as number) + dx, bottom);
  for (let i = 0; i < n; i++) ctx.lineTo((xs[i] as number) + dx, (ys[i] as number) + dy);
  ctx.lineTo((xs[n - 1] as number) + dx, bottom);
  ctx.closePath();
}

/** Lays the wood grain over whatever the current path covers. */
function woodGrain(ctx: CanvasRenderingContext2D, env: ChunkEnv, alpha: number): void {
  const { wood } = look();
  if (!wood) return;
  const pattern = alignedPattern(ctx, wood, env.toX(0));
  if (!pattern) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pattern;
  ctx.fill();
  ctx.restore();
}

/** The color block of a range, with its bokashi, printed slightly off register. */
export function drawBlock(
  ctx: CanvasRenderingContext2D,
  chunk: LayerChunk,
  env: ChunkEnv,
  line: RidgeLine,
  layer: number,
): void {
  const ink = LAYER_INKS[layer] ?? LAYER_INKS[0];
  if (!ink) return;
  const k = env.scale;
  const g = ctx.createLinearGradient(0, env.toY(0.95), 0, env.toY(0.05));
  g.addColorStop(0, css(ink.top));
  g.addColorStop(1, css(ink.bottom));
  polygon(ctx, line.xs, line.ys, env.height + 4, MISREGISTER.x * k, MISREGISTER.y * k);
  ctx.fillStyle = g;
  ctx.fill();
  woodGrain(ctx, env, 0.09);
}

/**
 * Parallel striations under the crest: a few lines that follow a smoothed ridge downward,
 * broken where the noise says, fewer as they go down.
 */
export function drawStriations(
  ctx: CanvasRenderingContext2D,
  chunk: LayerChunk,
  env: ChunkEnv,
  line: RidgeLine,
  layer: number,
): void {
  const ink = LAYER_INKS[layer];
  if (!ink || chunk.depth > 0.5) return;
  const k = env.scale;
  const seed = hashSeed('ukiyoe', chunk.role, 'striations');
  const reach = Math.min(0.8, (30 * k) / env.pxPerSecond);
  const smooth = (t: number) => {
    let sum = 0;
    for (let i = -4; i <= 4; i++) sum += ridgeAt(chunk, env.neighbors, t + (i / 4) * reach);
    return env.toY(sum / 9);
  };
  const smoothed = Array.from(line.ts, smooth);
  const gap = (6 + 4 * chunk.depth) * k;
  ctx.strokeStyle = css(shade(ink.top, -0.3), 0.55);
  ctx.lineWidth = 1.1 * k;
  ctx.lineCap = 'round';
  for (let row = 1; row <= 5; row++) {
    ctx.beginPath();
    let on = false;
    for (let i = 0; i < line.xs.length; i++) {
      const t = line.ts[i] as number;
      const u = layerDistance(env, t);
      const y = Math.max(
        (line.ys[i] as number) + 4 * k + row * 2 * k,
        (smoothed[i] as number) + gap * row * (1 + 0.2 * row),
      );
      const draw = noise1(hashSeed(seed, row), u / 38) > -0.15 + 0.12 * row;
      if (!draw) {
        on = false;
        continue;
      }
      const x = line.xs[i] as number;
      if (on) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      on = true;
    }
    ctx.stroke();
  }
}

/**
 * Snow lines, as ridge heights. They depend on the ridge alone: under live input a neighbor
 * chunk can be rebuilt with other objects, and snow that followed objects would break there.
 */
const SNOW_LINE: Partial<Record<LayerChunk['role'], number>> = {
  'far-range': 0.66,
  'mid-range': 0.86,
};

/** Snow above the snow line, ending in a jagged edge like runnels down the slope. */
export function drawSnow(
  ctx: CanvasRenderingContext2D,
  chunk: LayerChunk,
  env: ChunkEnv,
  line: RidgeLine,
): void {
  const base = SNOW_LINE[chunk.role];
  if (base === undefined) return;
  const k = env.scale;
  const seed = hashSeed('ukiyoe', chunk.role, 'snow');
  const n = line.xs.length;
  const bottoms = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = line.ts[i] as number;
    const u = layerDistance(env, t);
    // Teeth: a sawtooth with a little noise, so the edge runs down in tongues.
    const saw = Math.abs(mod(u / 13 + 0.3 * noise1(seed, u / 50), 2) - 1);
    const tongue = (3 + 9 * saw * saw) * k;
    bottoms[i] = env.toY(base) + tongue;
  }
  const mx = MISREGISTER.x * k;
  const my = MISREGISTER.y * k;
  for (const [start, end] of bandRuns(line.ys, bottoms)) {
    const trace = (dx: number, dy: number) => {
      ctx.beginPath();
      for (let j = start; j <= end; j++) {
        const x = (line.xs[j] as number) + dx;
        const y = (line.ys[j] as number) + dy;
        if (j === start) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let j = end; j >= start; j--)
        ctx.lineTo((line.xs[j] as number) + dx, (bottoms[j] as number) + dy);
      ctx.closePath();
    };
    trace(mx, my);
    ctx.fillStyle = css(SNOW);
    ctx.fill();
    // The keyline along the lower edge of the snow.
    ctx.beginPath();
    for (let j = start; j <= end; j++) {
      const x = line.xs[j] as number;
      const y = Math.max(line.ys[j] as number, bottoms[j] as number);
      if (j === start) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = css(KEYLINE, 0.75);
    ctx.lineWidth = 1.1 * k;
    ctx.stroke();
  }
}

/** The keyline along the ridge: the same width everywhere, as cut in the key block. */
export function drawKeyline(ctx: CanvasRenderingContext2D, env: ChunkEnv, line: RidgeLine): void {
  ctx.beginPath();
  for (let i = 0; i < line.xs.length; i++) {
    const x = line.xs[i] as number;
    const y = line.ys[i] as number;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = css(KEYLINE);
  ctx.lineWidth = keylineWidth(env);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** Seconds over which the water block curves down at each end of a run. */
const END = 0.7;

export function drawWater(
  ctx: CanvasRenderingContext2D,
  chunk: LayerChunk,
  env: ChunkEnv,
  spans: LayerChunk['water'],
): void {
  if (spans.length === 0) return;
  const k = env.scale;
  const left = timeAt(chunk, env, -8);
  const right = timeAt(chunk, env, env.width + 8);
  const step = 2 / env.pxPerSecond;
  const bottom = env.height + 4;
  const seed = hashSeed('ukiyoe', 'water');
  const toTime = (u: number) => (u * env.scale) / env.pxPerSecond;

  for (const run of waterRuns(spans)) {
    const from = Math.max(run.t0 - 0.1, left);
    const to = Math.min(run.t1 + 0.1, right);
    if (to <= from) continue;
    const surface = (t: number) => {
      const land = waterValueAt(run, t, (s) => ridgeAt(chunk, env.neighbors, (s.t0 + s.t1) / 2));
      const width = waterValueAt(run, t, (s) => s.width);
      const y = env.toY(land + 0.03 + 0.06 * width);
      const edge = Math.min(t - (run.t0 - 0.1), run.t1 + 0.1 - t);
      return y + (1 - smoothstep(0, END, edge)) * (bottom - y);
    };
    const ts: number[] = [];
    for (let t = from; t < to; t += step) ts.push(t);
    ts.push(to);
    const xs = ts.map((t) => env.toX(t));
    const ys = ts.map(surface);

    polygon(ctx, xs, ys, bottom, MISREGISTER.x * k, MISREGISTER.y * k);
    ctx.fillStyle = css(WATER);
    ctx.fill();
    woodGrain(ctx, env, 0.07);

    // Scalloped rows, clipped to the water. Rough water gets taller scallops.
    ctx.save();
    polygon(ctx, xs, ys, bottom);
    ctx.clip();
    ctx.strokeStyle = css(WAVE);
    ctx.lineWidth = 1.2 * k;
    const spacing = 15;
    const u0 = layerDistance(env, from);
    const u1 = layerDistance(env, to);
    for (let row = 0; row < 7; row++) {
      ctx.beginPath();
      const shift = (row % 2) * spacing * 0.5;
      for (
        let n = Math.floor((u0 - shift) / spacing) - 1;
        n * spacing + shift <= u1 + spacing;
        n++
      ) {
        const t = toTime(n * spacing + shift);
        if (t < run.t0 - 0.1 || t > run.t1 + 0.1) continue;
        const calm = waterValueAt(run, t, (s) => s.calm);
        const r = 6 * k;
        const x = env.toX(t);
        const y = surface(t) + (9 + 9 * row) * k;
        if (y - r > bottom) continue;
        ctx.moveTo(x + r, y);
        ctx.ellipse(x, y, r, r * (0.35 + 0.65 * (1 - calm)), 0, 0, Math.PI, true);
      }
      ctx.stroke();
    }
    ctx.restore();

    // The keyline along the surface.
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      if (i === 0) ctx.moveTo(xs[i] as number, ys[i] as number);
      else ctx.lineTo(xs[i] as number, ys[i] as number);
    }
    ctx.strokeStyle = css(KEYLINE);
    ctx.lineWidth = 1.6 * k;
    ctx.stroke();

    // Foam curls on the crest where the water is rough.
    ctx.fillStyle = css(PAPER);
    ctx.strokeStyle = css(KEYLINE, 0.8);
    ctx.lineWidth = 1 * k;
    const curl = 44;
    for (let n = Math.floor(u0 / curl); n * curl <= u1; n++) {
      const t = toTime(n * curl + 9 * noise1(seed, n));
      if (t < run.t0 + 0.2 || t > run.t1 - 0.2) continue;
      const calm = waterValueAt(run, t, (s) => s.calm);
      if (clamp01(0.5 + 0.5 * noise1(hashSeed(seed, 'curl'), n * 0.37)) < 0.35 + 0.6 * calm)
        continue;
      const x = env.toX(t);
      const y = surface(t);
      const r = 6.5 * k;
      ctx.beginPath();
      ctx.arc(x, y - r * 0.6, r, Math.PI * 0.9, Math.PI * 2.35);
      ctx.arc(x + r * 0.35, y - r * 0.75, r * 0.45, Math.PI * 0.35, Math.PI * 1.6, true);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}
