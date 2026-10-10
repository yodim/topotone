/**
 * Seeded gradient noise in 1D and 2D, plus fbm. Stateless: every value is a pure function
 * of (seed, position), so any piece of the world can be computed on its own.
 * Outputs are roughly in [-1, 1].
 */
import { hashInt01 } from './rng';
import { fade } from './math';

function gradient1(seed: number, i: number): number {
  return hashInt01(seed, i) * 2 - 1;
}

export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = gradient1(seed, i) * f;
  const b = gradient1(seed, i + 1) * (f - 1);
  return (a + (b - a) * fade(f)) * 2;
}

// Eight gradient directions avoid trigonometry, which keeps results identical across browsers.
const D = Math.SQRT1_2;
const GRAD_X = [1, -1, 0, 0, D, -D, D, -D];
const GRAD_Y = [0, 0, 1, -1, D, D, -D, -D];

function dot2(seed: number, ix: number, iy: number, fx: number, fy: number): number {
  const h = Math.floor(hashInt01(seed ^ Math.imul(iy | 0, 0x165667b1), ix) * 8);
  return (GRAD_X[h] ?? 1) * fx + (GRAD_Y[h] ?? 0) * fy;
}

export function noise2(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const v00 = dot2(seed, ix, iy, fx, fy);
  const v10 = dot2(seed, ix + 1, iy, fx - 1, fy);
  const v01 = dot2(seed, ix, iy + 1, fx, fy - 1);
  const v11 = dot2(seed, ix + 1, iy + 1, fx - 1, fy - 1);
  const u = fade(fx);
  const v = fade(fy);
  const a = v00 + (v10 - v00) * u;
  const b = v01 + (v11 - v01) * u;
  return (a + (b - a) * v) * Math.SQRT2;
}

function octaveSeed(seed: number, octave: number): number {
  return (seed + Math.imul(octave, 0x9e3779b9)) | 0;
}

/** Fractal sum of 1D noise, normalized back to about [-1, 1]. */
export function fbm1(seed: number, x: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise1(octaveSeed(seed, o), x * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Fractal sum of 2D noise, normalized back to about [-1, 1]. */
export function fbm2(
  seed: number,
  x: number,
  y: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(octaveSeed(seed, o), x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
