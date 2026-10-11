/**
 * Trees, rocks, grass and birds as brushwork. Every mark comes from the object's own seed.
 *
 * Pines: a bent trunk stroke and layered fans of needles. Leafy trees: a trunk with a few
 * branches and dabbed foliage. Bare trees: branches with small dots. Rocks: a broken outline
 * over a light wash. Birds: two tiny strokes.
 */
import { createRng, type Rng } from '../../core/rng';
import type { WorldObject } from '../../world/scene';
import { roughLoop } from '../shared/edges';
import { css } from '../shared/palette';
import { traceSpline } from '../shared/spline';
import { variableStroke } from '../shared/stroke';
import { INK } from './look';
import type { Tone } from './land';

export interface Brush {
  ctx: CanvasRenderingContext2D;
  /** Size multiplier: view scale times a depth factor. */
  k: number;
  tone: Tone;
}

export function drawMark(b: Brush, o: WorldObject, x: number, y: number): void {
  const rng = createRng(o.seed);
  switch (o.kind) {
    case 'tree':
      if (o.variant < 0.45) pine(b, o, x, y, rng);
      else if (o.variant < 0.82) leafy(b, o, x, y, rng);
      else bare(b, o, x, y, rng);
      break;
    case 'rock':
      rock(b, o, x, y, rng);
      break;
    case 'grass':
      grass(b, o, x, y, rng);
      break;
    case 'bird':
      bird(b, o, x, y, rng);
      break;
    case 'lone-peak':
      break;
  }
}

function ink(b: Brush, extra = 0): string {
  return css(INK, Math.min(0.95, b.tone.line + extra));
}

/** A trunk that leans and bends a little, tapering from base to top. Returns its points. */
function trunk(
  b: Brush,
  x: number,
  y: number,
  h: number,
  base: number,
  rng: Rng,
): { xs: number[]; ys: number[] } {
  const lean = rng.range(-0.18, 0.18) * h;
  const bend = rng.range(-0.1, 0.1) * h;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    xs.push(x + lean * u * u + bend * Math.sin(u * Math.PI));
    ys.push(y + 2 * b.k - h * u);
  }
  b.ctx.fillStyle = ink(b, 0.05);
  variableStroke(b.ctx, xs, ys, (u) => base * (1 - 0.75 * u));
  return { xs, ys };
}

function pine(b: Brush, o: WorldObject, x: number, y: number, rng: Rng): void {
  const { ctx, k } = b;
  const h = (30 + 70 * o.size) * k * rng.range(0.9, 1.1);
  const t = trunk(b, x, y, h, Math.max(1.3 * k, 0.075 * h), rng);
  // Flat plates of needles on short branches, alternating sides, smaller towards the top.
  const plates = h > 60 * k ? 4 : 3;
  for (let i = 0; i < plates; i++) {
    const u = 0.42 + (0.58 * (i + 0.5)) / plates;
    const j = Math.min(6, Math.round(u * 6));
    const cx = t.xs[j] as number;
    const cy = t.ys[j] as number;
    const side = i === plates - 1 ? 0 : i % 2 === 0 ? -1 : 1;
    const reach = h * (0.3 - 0.04 * i) * rng.range(0.85, 1.15);
    const px = cx + side * reach * 0.55;
    const py = cy - reach * 0.12;
    if (side !== 0) {
      ctx.fillStyle = ink(b, 0.05);
      variableStroke(
        ctx,
        [cx, (cx + px) / 2, px],
        [cy, cy - reach * 0.05, py],
        (q) => 1.3 * k * (1 - 0.5 * q),
      );
    }
    plate(b, px, py, reach * 0.62, reach * 0.17, rng);
  }
}

/** A pine's plate of needles: many short strokes in a flat lens, darker at its heart. */
function plate(b: Brush, x: number, y: number, rx: number, ry: number, rng: Rng): void {
  const n = Math.max(10, Math.round(rx / b.k) + 6);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next());
    const sx = x + Math.cos(a) * rx * d;
    const sy = y + Math.sin(a) * ry * d;
    const l = rng.range(2.5, 5) * b.k;
    const tilt = rng.range(-0.5, 0.5);
    b.ctx.fillStyle = ink(b, d < 0.5 ? 0.1 : -0.1);
    variableStroke(
      b.ctx,
      [sx - l, sx, sx + l],
      [sy + tilt * l, sy, sy - tilt * l],
      (q) => 1.6 * b.k * Math.sin(Math.PI * (0.1 + 0.8 * q)),
    );
  }
}

function leafy(b: Brush, o: WorldObject, x: number, y: number, rng: Rng): void {
  const { ctx, k } = b;
  const h = (26 + 62 * o.size) * k * rng.range(0.9, 1.1);
  const t = trunk(b, x, y, h * 0.75, Math.max(1.2 * k, 0.07 * h), rng);
  const top = 6;
  const cx = t.xs[top] as number;
  const cy = (t.ys[top] as number) - h * 0.05;
  // A couple of branches, then dabs of foliage in two tones.
  for (let i = 0; i < 3; i++) {
    const j = 3 + i;
    const bx = t.xs[j] as number;
    const by = t.ys[j] as number;
    const side = i % 2 === 0 ? -1 : 1;
    const ex = bx + side * h * rng.range(0.15, 0.28);
    const ey = by - h * rng.range(0.1, 0.22);
    ctx.fillStyle = ink(b);
    variableStroke(
      ctx,
      [bx, (bx + ex) / 2, ex],
      [by, (by + ey) / 2 + 1, ey],
      (q) => 1.1 * k * (1 - 0.7 * q),
    );
  }
  const r = h * 0.3;
  for (const [count, alpha, spread] of [
    [34, -0.18, 1],
    [22, 0.06, 0.7],
  ] as const) {
    ctx.fillStyle = ink(b, alpha);
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * r * spread;
      const dx = cx + Math.cos(a) * d * 1.25;
      const dy = cy + Math.sin(a) * d * 0.8;
      ctx.beginPath();
      ctx.ellipse(
        dx,
        dy,
        rng.range(1.8, 3.4) * k,
        rng.range(1.2, 2.2) * k,
        rng.range(0, Math.PI),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
}

function bare(b: Brush, o: WorldObject, x: number, y: number, rng: Rng): void {
  const { ctx, k } = b;
  const h = (24 + 60 * o.size) * k * rng.range(0.9, 1.1);
  const t = trunk(b, x, y, h * 0.8, Math.max(1.1 * k, 0.06 * h), rng);
  ctx.fillStyle = ink(b);
  const tips: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const j = 2 + (i % 5);
    const bx = t.xs[Math.min(6, j)] as number;
    const by = t.ys[Math.min(6, j)] as number;
    const side = i % 2 === 0 ? -1 : 1;
    const ex = bx + side * h * rng.range(0.12, 0.3);
    const ey = by - h * rng.range(0.12, 0.3);
    variableStroke(
      ctx,
      [bx, (bx + ex) / 2, ex],
      [by, (by + ey) / 2, ey],
      (q) => 1 * k * (1 - 0.75 * q),
    );
    tips.push([ex, ey]);
  }
  // Dotted foliage around the branch tips.
  ctx.fillStyle = ink(b, -0.05);
  for (const [tx, ty] of tips) {
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(
        tx + rng.range(-5, 5) * k,
        ty + rng.range(-4, 3) * k,
        rng.range(0.8, 1.4) * k,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
}

function rock(b: Brush, o: WorldObject, x: number, y: number, rng: Rng): void {
  const { ctx, k } = b;
  const rx = (7 + 14 * o.size) * k;
  const ry = rx * rng.range(0.55, 0.8);
  const loop = roughLoop(x, y - ry * 0.5, rx, ry, 9, 0.25, o.seed);
  ctx.beginPath();
  traceSpline(ctx, loop.xs, loop.ys, { closed: true, tension: 0.7 });
  ctx.fillStyle = css(INK, b.tone.wash * 0.6);
  ctx.fill();
  // The outline, broken at the bottom where the rock sinks into the ground.
  const xs: number[] = [];
  const ys: number[] = [];
  const n = loop.xs.length;
  const first = Math.floor(n * 0.5);
  for (let i = 0; i <= n * 0.62; i++) {
    xs.push(loop.xs[(first + i) % n] as number);
    ys.push(loop.ys[(first + i) % n] as number);
  }
  ctx.fillStyle = ink(b, 0.05);
  variableStroke(ctx, xs, ys, (u) => 2.2 * k * (0.35 + Math.sin(u * Math.PI)));
  // One fold line on the face.
  const fx = x + rng.range(-0.3, 0.1) * rx;
  variableStroke(
    ctx,
    [fx, fx + rx * 0.2, fx + rx * 0.3],
    [y - ry * 0.9, y - ry * 0.5, y - ry * 0.1],
    (u) => 1.2 * k * (1 - u),
  );
}

function grass(b: Brush, o: WorldObject, x: number, y: number, rng: Rng): void {
  const { ctx, k } = b;
  const blades = rng.int(3, 5);
  const tall = (7 + 13 * o.size) * k;
  ctx.fillStyle = ink(b, -0.05);
  for (let i = 0; i < blades; i++) {
    const a = ((i + 0.5) / blades - 0.5) * 1.2 + rng.range(-0.15, 0.15);
    const l = tall * rng.range(0.6, 1);
    const bx = x + (i - blades / 2) * 1.5 * k;
    const ex = bx + Math.sin(a) * l;
    const ey = y + k - Math.cos(a) * l;
    variableStroke(
      ctx,
      [bx, (bx + ex) / 2 + a * 2 * k, ex],
      [y + k, (y + ey) / 2, ey],
      (u) => 1.3 * k * (1 - 0.85 * u),
    );
  }
}

function bird(b: Brush, o: WorldObject, x: number, y: number, rng: Rng): void {
  const { ctx, k } = b;
  const by = y - (40 + 70 * o.variant) * k;
  const w = (5 + 5 * o.size) * k;
  const lift = rng.range(0.3, 0.7);
  ctx.fillStyle = css(INK, 0.8);
  variableStroke(
    ctx,
    [x - w, x - w * 0.45, x],
    [by - w * lift, by - w * (lift + 0.1), by],
    (u) => 1.3 * k * (0.3 + u),
  );
  variableStroke(
    ctx,
    [x, x + w * 0.45, x + w],
    [by, by - w * (lift + 0.1), by - w * lift],
    (u) => 1.3 * k * (1.3 - u),
  );
}
