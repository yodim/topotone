/**
 * Procedural paper grain: a small tile of speckle, soft blotches and fibers, built once in
 * setup and repeated as a pattern. Nothing is loaded from a file.
 *
 * The tile wraps around seamlessly, and alignedPattern() anchors it to music time, so the
 * grain runs on across chunk edges.
 */
import { mod } from '../../core/math';
import { createRng, type Rng } from '../../core/rng';
import type { Rgb } from './palette';

export interface GrainOptions {
  /** Tile size in CSS pixels. */
  size: number;
  /** Device pixel ratio the tile is built for. */
  dpr: number;
  /** Strength of the per-pixel speckle, as an alpha 0..1. */
  speckle: number;
  /** Number of fibers in the tile. */
  fibers: number;
  /** Alpha of each fiber. */
  fiberAlpha: number;
  /** Fiber length in CSS pixels. */
  fiberLength: number;
  /** Number of soft blotches (uneven pulp). */
  blotches: number;
  /** Alpha of the blotches. */
  blotchAlpha: number;
  /** Colors for the light and the dark marks. */
  light: Rgb;
  dark: Rgb;
}

export const DEFAULT_GRAIN: GrainOptions = {
  size: 192,
  dpr: 1,
  speckle: 0.06,
  fibers: 70,
  fiberAlpha: 0.12,
  fiberLength: 14,
  blotches: 10,
  blotchAlpha: 0.035,
  light: [255, 255, 255],
  dark: [60, 50, 40],
};

export interface GrainTile {
  canvas: HTMLCanvasElement;
  /** Size in CSS pixels. */
  size: number;
}

/** Builds a grain tile, or returns null where there is no DOM (unit tests). */
export function makeGrainTile(seed: number, options: Partial<GrainOptions> = {}): GrainTile | null {
  if (typeof document === 'undefined') return null;
  const o = { ...DEFAULT_GRAIN, ...options };
  const px = Math.max(8, Math.round(o.size * o.dpr));
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rng = createRng(seed);

  // Speckle: every pixel a little lighter or darker. White noise tiles by itself.
  const image = ctx.createImageData(px, px);
  const data = image.data;
  for (let i = 0; i < px * px; i++) {
    const v = rng.next() * 2 - 1;
    const c = v > 0 ? o.light : o.dark;
    data[4 * i] = c[0];
    data[4 * i + 1] = c[1];
    data[4 * i + 2] = c[2];
    data[4 * i + 3] = Math.round(Math.abs(v) * o.speckle * 255);
  }
  ctx.putImageData(image, 0, 0);

  ctx.scale(o.dpr, o.dpr);
  const size = px / o.dpr;
  // Everything else is drawn nine times, shifted by a tile in each direction, so marks that
  // cross the border come back in on the other side.
  const wrapped = (draw: (dx: number, dy: number) => void) => {
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) draw(dx, dy);
  };

  for (let i = 0; i < o.blotches; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(0.08, 0.25) * size;
    const c = rng.chance(0.5) ? o.light : o.dark;
    wrapped((dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${o.blotchAlpha})`);
      g.addColorStop(1, `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    });
  }

  ctx.lineCap = 'round';
  for (let i = 0; i < o.fibers; i++) {
    const fiber = makeFiber(rng, size, o.fiberLength);
    const c = rng.chance(0.6) ? o.light : o.dark;
    ctx.strokeStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${o.fiberAlpha * rng.range(0.5, 1)})`;
    ctx.lineWidth = rng.range(0.4, 0.9);
    wrapped((dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(fiber[0] + dx, fiber[1] + dy);
      ctx.quadraticCurveTo(fiber[2] + dx, fiber[3] + dy, fiber[4] + dx, fiber[5] + dy);
      ctx.stroke();
    });
  }
  return { canvas, size };
}

type Fiber = [number, number, number, number, number, number];

function makeFiber(rng: Rng, size: number, length: number): Fiber {
  const x = rng.range(0, size);
  const y = rng.range(0, size);
  const a = rng.range(0, Math.PI * 2);
  const l = length * rng.range(0.4, 1.2);
  const bend = rng.range(-0.4, 0.4) * l;
  const ex = x + Math.cos(a) * l;
  const ey = y + Math.sin(a) * l;
  const mx = (x + ex) / 2 - Math.sin(a) * bend;
  const my = (y + ey) / 2 + Math.cos(a) * bend;
  return [x, y, mx, my, ex, ey];
}

/**
 * A repeating pattern of the tile, drawn at device resolution, with its origin at (x, y)
 * in the current CSS pixel space. Pass the chunk-local x of music time 0 (env.toX(0)) to
 * anchor the grain to the world: chunks then line up seamlessly.
 */
export function alignedPattern(
  ctx: CanvasRenderingContext2D,
  tile: GrainTile,
  x: number,
  y = 0,
): CanvasPattern | null {
  const pattern = ctx.createPattern(tile.canvas, 'repeat');
  if (!pattern) return null;
  if (typeof DOMMatrix !== 'undefined') {
    const k = tile.size / tile.canvas.width;
    pattern.setTransform(
      new DOMMatrix([k, 0, 0, k, mod(x, tile.size) - tile.size, mod(y, tile.size) - tile.size]),
    );
  }
  return pattern;
}
