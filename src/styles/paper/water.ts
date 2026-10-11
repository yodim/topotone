/**
 * Water as its own paler sheet laid over the ground, with one or two thin wave strips cut
 * from an even lighter paper. Every shape is a function of music time, so a river that
 * crosses a chunk edge is drawn identically on both sides.
 */
import { smoothstep } from '../../core/math';
import type { LayerChunk } from '../../world/scene';
import { noShadow, softShadow } from '../shared/canvas';
import { css } from '../shared/palette';
import { layerDistance, ridgeAt, timeAt, waterRuns, waterValueAt } from '../shared/ridge';
import { variableStroke } from '../shared/stroke';
import type { ChunkEnv } from '../types';
import { shadow, type Papers } from './palette';

/** Seconds over which the water sheet curves down at each end of a run. */
const END = 0.9;

export function drawWater(
  ctx: CanvasRenderingContext2D,
  chunk: LayerChunk,
  env: ChunkEnv,
  papers: Papers,
  spans: LayerChunk['water'],
  grain: CanvasPattern | null,
  /** Where the front verge starts: the water's ends tuck in behind it. */
  verge: (t: number) => number,
): void {
  if (spans.length === 0) return;
  const k = env.scale;
  const left = timeAt(chunk, env, -4);
  const right = timeAt(chunk, env, env.width + 4);
  const step = 2 / env.pxPerSecond;
  const bottom = env.height + 4;

  for (const run of waterRuns(spans)) {
    const from = Math.max(run.t0 - 0.05, left);
    const to = Math.min(run.t1 + 0.05, right);
    if (to <= from) continue;
    // The surface sits a little above the land in the middle of each cell, and is blended
    // between cells, so it stays almost flat.
    const surface = (t: number) => {
      const land = waterValueAt(run, t, (s) => ridgeAt(chunk, env.neighbors, (s.t0 + s.t1) / 2));
      const width = waterValueAt(run, t, (s) => s.width);
      const y = env.toY(land + 0.025 + 0.05 * width);
      // At the ends the sheet curves down behind the verge, like the far shore of a pond.
      const edge = Math.min(t - (run.t0 - 0.05), run.t1 + 0.05 - t);
      const low = verge(t) + 4 * k;
      return Math.min(low, y + (1 - smoothstep(0, END, edge)) * Math.max(0, low - y));
    };
    const ts: number[] = [];
    for (let t = from; t < to; t += step) ts.push(t);
    ts.push(to);
    const xs = ts.map((t) => env.toX(t));
    const ys = ts.map(surface);

    ctx.beginPath();
    ctx.moveTo(xs[0] as number, bottom);
    for (let i = 0; i < xs.length; i++) ctx.lineTo(xs[i] as number, ys[i] as number);
    ctx.lineTo(xs[xs.length - 1] as number, bottom);
    ctx.closePath();
    softShadow(ctx, shadow(), 7 * k, 0, 1.5 * k);
    ctx.fillStyle = css(papers.water);
    ctx.fill();
    noShadow(ctx);
    if (grain) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = grain;
      ctx.fill();
      ctx.restore();
    }

    // Wave strips: thin wavy bands below the surface, rougher water waves more.
    ctx.fillStyle = css(papers.wave);
    for (const [depth, offset, length] of [
      [8, 0.25, 34],
      [19, 0.7, 46],
    ] as const) {
      const s0 = run.t0 + offset;
      const s1 = run.t1 - offset * 0.6;
      if (s1 - s0 < 0.4) continue;
      const a = Math.max(s0, from);
      const b = Math.min(s1, to);
      if (b <= a) continue;
      const sts: number[] = [];
      for (let t = a; t < b; t += step) sts.push(t);
      sts.push(b);
      const sx = sts.map((t) => env.toX(t));
      const sy = sts.map((t) => {
        const calm = waterValueAt(run, t, (s) => s.calm);
        const amp = (0.6 + 2.4 * (1 - calm)) * k;
        const phase = (layerDistance(env, t) / length) * Math.PI * 2;
        return surface(t) + depth * k + amp * Math.sin(phase + depth);
      });
      variableStroke(ctx, sx, sy, (_, i) => {
        const t = sts[i] as number;
        return 2.4 * k * smoothstep(s0, s0 + 0.35, t) * smoothstep(s1, s1 - 0.35, t);
      });
    }
  }
}
