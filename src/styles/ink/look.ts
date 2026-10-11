/**
 * What ink builds once in setup: rice paper fibers, a soft mist sprite and the seal. Drawing
 * works without them too (in unit tests, nothing is built and these are skipped).
 */
import { createRng, hashSeed } from '../../core/rng';
import { makeGrainTile, type GrainTile } from '../shared/grain';
import { hex, type Rgb } from '../shared/palette';

/** Warm off-white rice paper. */
export const PAPER: Rgb = hex('#f2ead8');
/** Ink is a warm black; tone comes from how much water it is mixed with. */
export const INK: Rgb = hex('#1c1a17');
/** Seal paste. */
export const VERMILION: Rgb = hex('#b63a2b');

export interface Look {
  seed: number;
  fibers: GrainTile | null;
  mist: HTMLCanvasElement | null;
  seal: HTMLCanvasElement | null;
}

let current: Look = { seed: 0, fibers: null, mist: null, seal: null };

export function look(): Look {
  return current;
}

export function buildLook(seed: number, dpr: number): void {
  current = {
    seed,
    fibers: makeGrainTile(hashSeed(seed, 'ink', 'fibers'), {
      size: 320,
      dpr,
      speckle: 0.025,
      fibers: 140,
      fiberAlpha: 0.1,
      fiberLength: 18,
      blotches: 0,
      light: [255, 252, 244],
      dark: [120, 104, 80],
    }),
    mist: makeMist(),
    seal: makeSeal(hashSeed(seed, 'ink', 'seal'), dpr),
  };
}

/** A soft white blob, stretched wide when drawn. */
function makeMist(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Drawn twice as wide as tall: the gradient lives in the stretched space.
  ctx.setTransform(2, 0, 0, 1, 0, 0);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)');
  g.addColorStop(0.5, 'rgba(255, 255, 255, 0.55)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

/** Size of the seal in CSS pixels at a 1080 px view. */
export const SEAL_SIZE = 46;

/**
 * A square seal with the project initials, TT, cut in relief: red paste around white
 * letters, pressed a little unevenly.
 */
function makeSeal(seed: number, dpr: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const res = 2 * dpr;
  const size = SEAL_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(size * res);
  canvas.height = Math.ceil(size * res);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(res, res);
  const rng = createRng(seed);
  const [r, g, b] = VERMILION;
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.beginPath();
  // A square with slightly worn corners.
  const m = 2;
  ctx.moveTo(m + rng.range(0, 1.5), m + rng.range(0, 1.5));
  ctx.lineTo(size - m - rng.range(0, 1.5), m + rng.range(0, 1.5));
  ctx.lineTo(size - m - rng.range(0, 1.5), size - m - rng.range(0, 1.5));
  ctx.lineTo(m + rng.range(0, 1.5), size - m - rng.range(0, 1.5));
  ctx.closePath();
  ctx.fill();

  // Two letters T side by side, as white bars.
  ctx.globalCompositeOperation = 'destination-out';
  const bar = 4.2;
  for (const x0 of [8, 25]) {
    const w = 13;
    ctx.fillRect(x0 + rng.range(-0.4, 0.4), 9, w, bar);
    ctx.fillRect(x0 + w / 2 - bar / 2 + rng.range(-0.4, 0.4), 9, bar, 28);
  }
  // Uneven pressure: specks where the paste did not take.
  for (let i = 0; i < 70; i++) {
    ctx.globalAlpha = rng.range(0.2, 0.9);
    ctx.beginPath();
    ctx.arc(rng.range(0, size), rng.range(0, size), rng.range(0.2, 0.9), 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}
