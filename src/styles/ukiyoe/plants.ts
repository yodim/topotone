/**
 * Trees, rocks, grass and birds, cut as woodblock shapes: a flat color printed slightly off
 * a steady keyline. Pines carry stacked flat canopies; in bright moods some trees blossom
 * as clusters of pink dots. Every detail comes from the object's own seed.
 */
import { createRng, hash01, type Rng } from '../../core/rng';
import type { WorldObject } from '../../world/scene';
import { roughLoop } from '../shared/edges';
import { css, shade, type Rgb } from '../shared/palette';
import { traceSpline } from '../shared/spline';
import { MISREGISTER } from './land';
import { BLOSSOM, KEYLINE, OCHRE, PALE_GREEN, PINE, ROCK, TRUNK } from './palette';

export interface Cut {
  ctx: CanvasRenderingContext2D;
  /** Size multiplier: view scale times a depth factor. */
  k: number;
  /** Keyline width. */
  line: number;
  /** Whether this tree may blossom: the mood is bright and it sits clear of chunk edges. */
  blossom: (o: WorldObject) => boolean;
}

/** Fills a shape off register, then strokes its keyline in place. */
function print(c: Cut, color: Rgb, trace: () => void): void {
  const { ctx, k } = c;
  ctx.save();
  ctx.translate(MISREGISTER.x * k * 0.8, MISREGISTER.y * k * 0.8);
  trace();
  ctx.fillStyle = css(color);
  ctx.fill();
  ctx.restore();
  trace();
  ctx.strokeStyle = css(KEYLINE);
  ctx.lineWidth = c.line;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function drawCut(c: Cut, o: WorldObject, x: number, y: number): void {
  const rng = createRng(o.seed);
  switch (o.kind) {
    case 'tree':
      if (o.variant < 0.5) pine(c, o, x, y, rng);
      else if (o.variant < 0.85) round(c, o, x, y, rng);
      else cedar(c, o, x, y, rng);
      break;
    case 'rock':
      rock(c, o, x, y);
      break;
    case 'grass':
      grass(c, o, x, y, rng);
      break;
    case 'bird':
      bird(c, o, x, y, rng);
      break;
    case 'lone-peak':
      break;
  }
}

function trunk(c: Cut, x: number, y: number, h: number, w: number, lean: number): void {
  print(c, TRUNK, () => {
    c.ctx.beginPath();
    c.ctx.moveTo(x - w / 2, y + 2 * c.k);
    c.ctx.quadraticCurveTo(x - w / 2 + lean * 0.3, y - h * 0.5, x + lean - w * 0.3, y - h);
    c.ctx.lineTo(x + lean + w * 0.3, y - h);
    c.ctx.quadraticCurveTo(x + w / 2 + lean * 0.3, y - h * 0.5, x + w / 2, y + 2 * c.k);
    c.ctx.closePath();
  });
}

/** Pine: a leaning trunk carrying flat canopies, stacked and staggered, lighter on top. */
function pine(c: Cut, o: WorldObject, x: number, y: number, rng: Rng): void {
  const k = c.k;
  const h = (32 + 66 * o.size) * k * rng.range(0.9, 1.1);
  const lean = rng.range(-0.25, 0.25) * h;
  trunk(c, x, y, h * 0.9, Math.max(2 * k, 0.07 * h), lean);
  const tiers = h > 60 * k ? 3 : 2;
  for (let i = 0; i < tiers; i++) {
    const u = 0.55 + (0.45 * i) / tiers;
    const cx = x + lean * u * u + rng.range(-0.12, 0.12) * h;
    const cy = y - h * u - 0.04 * h;
    const rx = h * (0.3 - 0.06 * i) * rng.range(0.9, 1.1);
    const ry = rx * 0.32;
    print(c, shade(PINE, rng.range(-0.06, 0.06)), () => {
      c.ctx.beginPath();
      // A flat bottom and a low dome, like a pine's plate of needles seen from the side.
      c.ctx.moveTo(cx - rx, cy);
      c.ctx.bezierCurveTo(cx - rx * 0.8, cy - ry * 1.6, cx + rx * 0.8, cy - ry * 1.6, cx + rx, cy);
      c.ctx.quadraticCurveTo(cx, cy + ry * 0.5, cx - rx, cy);
      c.ctx.closePath();
    });
    // A lighter band on top, as a second block printed over the first.
    c.ctx.fillStyle = css(shade(PINE, 0.28), 0.8);
    c.ctx.beginPath();
    c.ctx.ellipse(cx, cy - ry * 0.75, rx * 0.55, ry * 0.3, 0, 0, Math.PI * 2);
    c.ctx.fill();
  }
}

/** Round tree: a few overlapping circles, green, or pink dot clusters when it blossoms. */
function round(c: Cut, o: WorldObject, x: number, y: number, rng: Rng): void {
  const k = c.k;
  const h = (28 + 56 * o.size) * k * rng.range(0.9, 1.1);
  const lean = rng.range(-0.1, 0.1) * h;
  trunk(c, x, y, h * 0.7, Math.max(1.8 * k, 0.06 * h), lean);
  const cx = x + lean * 0.7;
  const cy = y - h * 0.72;
  const r = h * 0.27;
  const blooms = c.blossom(o);
  if (blooms) {
    // Branches, then clusters of pink dots with a darker heart.
    c.ctx.strokeStyle = css(TRUNK);
    c.ctx.lineWidth = 1.2 * k;
    const tips: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * (1.1 + 0.8 * (i / 3)) + rng.range(-0.15, 0.15);
      const tx = cx + Math.cos(a) * r * 1.1;
      const ty = cy + Math.sin(a) * r * 0.8;
      c.ctx.beginPath();
      c.ctx.moveTo(x + lean * 0.7, y - h * 0.62);
      c.ctx.lineTo(tx, ty);
      c.ctx.stroke();
      tips.push([tx, ty]);
    }
    for (const [tx, ty] of [...tips, [cx, cy - r * 0.2] as [number, number]]) {
      for (let i = 0; i < 11; i++) {
        const dx = tx + rng.range(-0.45, 0.45) * r;
        const dy = ty + rng.range(-0.35, 0.35) * r;
        const s = rng.range(2.3, 3.5) * k;
        c.ctx.fillStyle = css(shade(BLOSSOM, rng.range(-0.08, 0.1)));
        c.ctx.beginPath();
        c.ctx.arc(dx, dy, s, 0, Math.PI * 2);
        c.ctx.fill();
        c.ctx.fillStyle = css(shade(BLOSSOM, -0.35));
        c.ctx.beginPath();
        c.ctx.arc(dx, dy, s * 0.3, 0, Math.PI * 2);
        c.ctx.fill();
      }
    }
    return;
  }
  const color = shade(rng.chance(0.3) ? OCHRE : PALE_GREEN, -0.12);
  const blobs = rng.int(3, 4);
  const centers = Array.from({ length: blobs }, (_, i) => {
    const a = (i / blobs) * Math.PI * 2 + rng.range(-0.3, 0.3);
    return [
      cx + Math.cos(a) * r * 0.45,
      cy + Math.sin(a) * r * 0.3,
      r * rng.range(0.55, 0.7),
    ] as const;
  });
  const trace = () => {
    c.ctx.beginPath();
    for (const [bx, by, br] of centers) {
      c.ctx.moveTo(bx + br, by);
      c.ctx.arc(bx, by, br, 0, Math.PI * 2);
    }
  };
  // Only the outline of the whole crown is cut: every circle is stroked twice as wide, then
  // the color covers the inner half of each stroke, and with it the overlaps.
  trace();
  c.ctx.strokeStyle = css(KEYLINE);
  c.ctx.lineWidth = c.line * 2;
  c.ctx.stroke();
  c.ctx.save();
  c.ctx.translate(MISREGISTER.x * c.k * 0.5, MISREGISTER.y * c.k * 0.5);
  trace();
  c.ctx.fillStyle = css(color);
  c.ctx.fill();
  c.ctx.restore();
}

/** Cedar: a tall flame of dark green. */
function cedar(c: Cut, o: WorldObject, x: number, y: number, rng: Rng): void {
  const k = c.k;
  const h = (36 + 64 * o.size) * k * rng.range(0.9, 1.1);
  trunk(c, x, y, h * 0.25, Math.max(1.8 * k, 0.05 * h), 0);
  const w = h * 0.17;
  print(c, shade(PINE, -0.18), () => {
    c.ctx.beginPath();
    c.ctx.moveTo(x, y - h);
    c.ctx.bezierCurveTo(x + w * 1.3, y - h * 0.65, x + w * 1.2, y - h * 0.2, x, y - h * 0.16);
    c.ctx.bezierCurveTo(x - w * 1.2, y - h * 0.2, x - w * 1.3, y - h * 0.65, x, y - h);
    c.ctx.closePath();
  });
}

function rock(c: Cut, o: WorldObject, x: number, y: number): void {
  const k = c.k;
  const rx = (7 + 13 * o.size) * k;
  const ry = rx * (0.55 + 0.2 * hash01(o.seed, 'ry'));
  const loop = roughLoop(x, y - ry * 0.5, rx, ry, 7, 0.22, o.seed);
  print(c, ROCK, () => {
    c.ctx.beginPath();
    traceSpline(c.ctx, loop.xs, loop.ys, { closed: true, tension: 0.35 });
  });
  // One cut line across the face.
  c.ctx.beginPath();
  c.ctx.moveTo(x - rx * 0.4, y - ry * 0.9);
  c.ctx.lineTo(x - rx * 0.05, y - ry * 0.45);
  c.ctx.lineTo(x + rx * 0.35, y - ry * 0.55);
  c.ctx.strokeStyle = css(KEYLINE, 0.7);
  c.ctx.lineWidth = c.line * 0.7;
  c.ctx.stroke();
}

function grass(c: Cut, o: WorldObject, x: number, y: number, rng: Rng): void {
  const k = c.k;
  const tall = (6 + 11 * o.size) * k;
  c.ctx.strokeStyle = css(shade(PINE, -0.1));
  c.ctx.lineWidth = 1.2 * k;
  c.ctx.lineCap = 'round';
  c.ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = (i - 1) * 0.45 + rng.range(-0.1, 0.1);
    c.ctx.moveTo(x + (i - 1) * 1.5 * k, y + k);
    c.ctx.quadraticCurveTo(
      x + (i - 1) * 2 * k,
      y - tall * 0.5,
      x + Math.sin(a) * tall,
      y - Math.cos(a) * tall,
    );
  }
  c.ctx.stroke();
}

function bird(c: Cut, o: WorldObject, x: number, y: number, rng: Rng): void {
  const k = c.k;
  const by = y - (40 + 70 * o.variant) * k;
  const w = (5 + 5 * o.size) * k;
  const lift = rng.range(0.3, 0.7);
  c.ctx.strokeStyle = css(KEYLINE);
  c.ctx.lineWidth = 1.5 * k;
  c.ctx.lineCap = 'round';
  c.ctx.beginPath();
  c.ctx.moveTo(x - w, by - w * lift);
  c.ctx.quadraticCurveTo(x - w * 0.4, by - w * (lift + 0.15), x, by);
  c.ctx.quadraticCurveTo(x + w * 0.4, by - w * (lift + 0.15), x + w, by - w * lift);
  c.ctx.stroke();
}
