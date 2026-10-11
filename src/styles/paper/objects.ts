/**
 * Small pieces cut from paper: trees, rocks, grass, birds and the snow on a lone peak.
 * Every detail comes from the object's own seed, so a piece looks the same in both chunks
 * it overhangs and does not change when the chunk is redrawn under live input.
 */
import { lerp } from '../../core/math';
import { createRng, type Rng } from '../../core/rng';
import type { WorldObject } from '../../world/scene';
import { noShadow, softShadow } from '../shared/canvas';
import { roughLoop } from '../shared/edges';
import { css, shade, type Rgb } from '../shared/palette';
import { traceSpline } from '../shared/spline';
import { shadow, type Papers } from './palette';

export interface PieceContext {
  ctx: CanvasRenderingContext2D;
  papers: Papers;
  /** The sheet this piece sits on, for tinting distant pieces towards it. */
  sheet: Rgb;
  /** 0 for the far range, 1 for the ground. */
  depth: number;
  /** Size multiplier: view scale times a depth factor. */
  k: number;
  /** Grain to lay over the pieces, or null. */
  grain: CanvasPattern | null;
}

/** Distant pieces lean towards the color of their sheet. */
function tint(p: PieceContext, color: Rgb): Rgb {
  return [
    lerp(color[0], p.sheet[0], 0.3 * (1 - p.depth)),
    lerp(color[1], p.sheet[1], 0.3 * (1 - p.depth)),
    lerp(color[2], p.sheet[2], 0.3 * (1 - p.depth)),
  ];
}

/** Fills the current path as one cut piece: with its shadow, then with grain on top. */
function cut(p: PieceContext, color: Rgb, blur = 4): void {
  const { ctx, k } = p;
  softShadow(ctx, shadow(), blur * k, 0.8 * k, 1 * k);
  ctx.fillStyle = css(color);
  ctx.fill();
  noShadow(ctx);
  if (p.grain) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = p.grain;
    ctx.fill();
    ctx.restore();
  }
}

/** A thin line cut through a piece, showing a lighter paper behind. */
function cutLine(p: PieceContext, color: Rgb, width: number): void {
  p.ctx.strokeStyle = css(shade(color, 0.35));
  p.ctx.lineWidth = width * p.k;
  p.ctx.lineCap = 'round';
  p.ctx.lineJoin = 'round';
  p.ctx.stroke();
}

export function drawPiece(p: PieceContext, o: WorldObject, x: number, y: number): void {
  const rng = createRng(o.seed);
  switch (o.kind) {
    case 'tree':
      if (o.variant < 0.42) conifer(p, o, x, y, rng);
      else if (o.variant < 0.78) roundTree(p, o, x, y, rng);
      else poplar(p, o, x, y, rng);
      break;
    case 'rock':
      rock(p, o, x, y, rng);
      break;
    case 'grass':
      grass(p, o, x, y, rng);
      break;
    case 'bird':
      bird(p, o, x, y, rng);
      break;
    case 'lone-peak':
      // Drawn with the ridge, see snowCap.
      break;
  }
}

function treeHeight(p: PieceContext, o: WorldObject, rng: Rng): number {
  return (24 + 66 * o.size) * p.k * rng.range(0.88, 1.12);
}

function trunk(p: PieceContext, x: number, y: number, w: number, h: number): void {
  const { ctx } = p;
  ctx.beginPath();
  ctx.rect(x - w / 2, y - h, w, h + 3 * p.k);
  ctx.fillStyle = css(tint(p, p.papers.trunk));
  ctx.fill();
}

function conifer(p: PieceContext, o: WorldObject, x: number, y: number, rng: Rng): void {
  const { ctx } = p;
  const h = treeHeight(p, o, rng);
  const lean = rng.range(-0.05, 0.05) * h;
  const color = tint(p, shade(p.papers.conifer, rng.range(-0.08, 0.1)));
  trunk(p, x, y, Math.max(1.5 * p.k, 0.08 * h), 0.2 * h);
  const tiers = h > 55 * p.k ? 3 : 2;
  const crown = 0.88 * h;
  const stepY = (crown * 0.62) / tiers;
  const tierH = crown - stepY * (tiers - 1);
  ctx.beginPath();
  for (let i = 0; i < tiers; i++) {
    const top = y - h + i * stepY;
    const bottom = Math.min(top + tierH * (i === 0 ? 0.7 : 0.62), y - 0.12 * h);
    const half = h * (0.15 + 0.07 * i) * rng.range(0.92, 1.08);
    const tipX = x + lean * (1 - i / tiers);
    ctx.moveTo(tipX, top);
    ctx.lineTo(x + half, bottom);
    ctx.lineTo(x - half, bottom);
    ctx.closePath();
  }
  cut(p, color);
  if (rng.chance(0.4)) {
    // A spine with a few chevrons, like a fold line.
    ctx.beginPath();
    ctx.moveTo(x + lean * 0.9, y - h + 0.12 * h);
    ctx.lineTo(x, y - 0.18 * h);
    for (let i = 1; i <= tiers + 1; i++) {
      const cy = y - h + (i / (tiers + 2)) * h * 0.85 + 0.12 * h;
      const w = 0.06 * h * (0.6 + i * 0.25);
      ctx.moveTo(x - w, cy + w * 0.7);
      ctx.lineTo(x, cy);
      ctx.lineTo(x + w, cy + w * 0.7);
    }
    cutLine(p, color, 0.9);
  }
}

function roundTree(p: PieceContext, o: WorldObject, x: number, y: number, rng: Rng): void {
  const { ctx } = p;
  const h = treeHeight(p, o, rng) * 0.92;
  const color = tint(p, shade(rng.pick(p.papers.round), rng.range(-0.06, 0.08)));
  const lean = rng.range(-0.06, 0.06) * h;
  trunk(p, x, y, Math.max(1.3 * p.k, 0.055 * h), 0.62 * h);
  const r = 0.3 * h;
  const cx = x + lean;
  const cy = y - 0.68 * h;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * rng.range(0.92, 1.08), r * rng.range(0.95, 1.1), 0, 0, Math.PI * 2);
  cut(p, color);
  if (rng.chance(0.45)) {
    // A leaf vein: a stem with pairs of side cuts.
    ctx.beginPath();
    ctx.moveTo(cx, cy + 0.75 * r);
    ctx.lineTo(cx, cy - 0.65 * r);
    const pairs = 2 + (rng.chance(0.5) ? 1 : 0);
    for (let i = 0; i < pairs; i++) {
      const sy = cy + 0.45 * r - i * 0.42 * r;
      const sw = 0.42 * r * (1 - i * 0.18);
      ctx.moveTo(cx, sy);
      ctx.lineTo(cx - sw, sy - sw * 0.75);
      ctx.moveTo(cx, sy);
      ctx.lineTo(cx + sw, sy - sw * 0.75);
    }
    cutLine(p, color, 1);
  }
}

function poplar(p: PieceContext, o: WorldObject, x: number, y: number, rng: Rng): void {
  const { ctx } = p;
  const h = treeHeight(p, o, rng) * 1.05;
  const color = tint(p, shade(p.papers.poplar, rng.range(-0.06, 0.1)));
  trunk(p, x, y, Math.max(1.3 * p.k, 0.05 * h), 0.3 * h);
  const ry = 0.4 * h;
  const rx = 0.13 * h * rng.range(0.9, 1.15);
  const cy = y - 0.58 * h;
  ctx.beginPath();
  ctx.ellipse(x, cy, rx, ry, rng.range(-0.05, 0.05), 0, Math.PI * 2);
  cut(p, color);
  if (rng.chance(0.4)) {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const vy = cy - 0.45 * ry + i * 0.42 * ry;
      ctx.moveTo(x - rx * 0.55, vy + rx * 0.45);
      ctx.lineTo(x, vy);
      ctx.lineTo(x + rx * 0.55, vy + rx * 0.45);
    }
    cutLine(p, color, 0.9);
  }
}

function rock(p: PieceContext, o: WorldObject, x: number, y: number, rng: Rng): void {
  const { ctx, k } = p;
  const rx = (6 + 13 * o.size) * k;
  const ry = rx * rng.range(0.55, 0.75);
  const color = tint(p, shade(p.papers.rock, rng.range(-0.1, 0.1)));
  const outline = roughLoop(x, y - ry * 0.55, rx, ry, 9, 0.22, o.seed);
  ctx.beginPath();
  traceSpline(ctx, outline.xs, outline.ys, { closed: true, tension: 0.8 });
  cut(p, color, 3);
  // A lighter facet on the upper left, as if a second paper was glued on.
  const facet = roughLoop(x - rx * 0.25, y - ry * 0.85, rx * 0.5, ry * 0.42, 7, 0.25, o.seed + 1);
  ctx.beginPath();
  traceSpline(ctx, facet.xs, facet.ys, { closed: true, tension: 0.8 });
  ctx.fillStyle = css(shade(color, 0.18));
  ctx.fill();
}

function grass(p: PieceContext, o: WorldObject, x: number, y: number, rng: Rng): void {
  const { ctx, k } = p;
  const blades = rng.int(3, 5);
  const tall = (6 + 12 * o.size) * k;
  ctx.beginPath();
  for (let i = 0; i < blades; i++) {
    const a = ((i + 0.5) / blades - 0.5) * 1.1 + rng.range(-0.15, 0.15);
    const len = tall * rng.range(0.6, 1);
    const bx = x + (i - blades / 2) * 1.2 * k;
    const w = 1.1 * k;
    ctx.moveTo(bx - w, y + 2 * k);
    ctx.lineTo(bx + Math.sin(a) * len, y + 2 * k - Math.cos(a) * len);
    ctx.lineTo(bx + w, y + 2 * k);
    ctx.closePath();
  }
  ctx.fillStyle = css(tint(p, shade(p.papers.grass, rng.range(-0.1, 0.1))));
  ctx.fill();
}

function bird(p: PieceContext, o: WorldObject, x: number, y: number, rng: Rng): void {
  const { ctx, k } = p;
  const by = y - (40 + 70 * o.variant) * k;
  const w = (5 + 5 * o.size) * k * 1.3;
  const lift = rng.range(0.2, 0.6);
  ctx.save();
  ctx.translate(x, by);
  ctx.rotate(rng.range(-0.15, 0.15));
  ctx.beginPath();
  ctx.moveTo(-w, -w * lift);
  ctx.quadraticCurveTo(-w * 0.45, -w * (lift + 0.25), 0, 0);
  ctx.quadraticCurveTo(w * 0.45, -w * (lift + 0.25), w, -w * lift);
  ctx.quadraticCurveTo(w * 0.45, -w * (lift - 0.05), 0, w * 0.28);
  ctx.quadraticCurveTo(-w * 0.45, -w * (lift - 0.05), -w, -w * lift);
  ctx.closePath();
  cut(p, p.papers.bird, 2);
  ctx.restore();
}

/**
 * Snow on a lone peak: the part of the ridge above a snow line, closed by a zigzag edge.
 * xs and ys are the ridge on screen, hs its heights.
 */
export function snowCap(
  p: PieceContext,
  o: WorldObject,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  hs: ArrayLike<number>,
  peakX: number,
  toY: (h: number) => number,
): void {
  const n = hs.length;
  // The highest point near the peak. It must be a real summit, not the end of a slope.
  const reach = 60 * p.k;
  let top = -1;
  for (let i = 0; i < n; i++) {
    if (Math.abs((xs[i] as number) - peakX) > reach) continue;
    if (top < 0 || (hs[i] as number) > (hs[top] as number)) top = i;
  }
  if (top <= 0 || top >= n - 1) return;
  if (Math.abs((xs[top] as number) - peakX) > reach * 0.9) return;
  const line = (hs[top] as number) - (0.06 + 0.07 * o.size);
  let a = top;
  while (a > 0 && (hs[a - 1] as number) > line) a--;
  let b = top;
  while (b < n - 1 && (hs[b + 1] as number) > line) b++;
  if (b - a < 2) return;
  const rng = createRng(o.seed);
  const { ctx, k } = p;
  const snowY = toY(line);
  ctx.beginPath();
  ctx.moveTo(xs[a] as number, snowY);
  for (let i = a; i <= b; i++) ctx.lineTo(xs[i] as number, ys[i] as number);
  // Back along a zigzag a little below the snow line.
  const x0 = xs[a] as number;
  const x1 = xs[b] as number;
  const teeth = Math.max(2, Math.round((x1 - x0) / (7 * k)));
  for (let i = teeth; i >= 0; i--) {
    const zx = x0 + ((x1 - x0) * i) / teeth;
    const dip = (i % 2 === 0 ? 0 : 1) * rng.range(3, 7) * k;
    ctx.lineTo(zx, snowY + dip);
  }
  ctx.closePath();
  cut(p, p.papers.snow, 3);
}
