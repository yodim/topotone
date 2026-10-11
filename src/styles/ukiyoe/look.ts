/**
 * What ukiyo-e builds once in setup: a wood grain tile, printed faintly over large flat
 * areas the way the grain of a cherry block shows through. Drawing works without it.
 */
import { createRng, hashSeed } from '../../core/rng';
import type { GrainTile } from '../shared/grain';

export interface Look {
  seed: number;
  wood: GrainTile | null;
}

let current: Look = { seed: 0, wood: null };

export function look(): Look {
  return current;
}

export function buildLook(seed: number, dpr: number): void {
  current = { seed, wood: makeWoodGrain(hashSeed(seed, 'ukiyoe', 'wood'), dpr) };
}

/**
 * Long wavy lines across the tile. Each wave has a whole number of periods across the
 * width, so the tile repeats without a seam; lines near the top and bottom are drawn again
 * one tile away so they wrap too.
 */
function makeWoodGrain(seed: number, dpr: number): GrainTile | null {
  if (typeof document === 'undefined') return null;
  const w = 360;
  const h = 180;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  const rng = createRng(seed);
  const rows = 26;
  for (let r = 0; r < rows; r++) {
    const base = ((r + rng.range(0.2, 0.8)) / rows) * h;
    const p1 = rng.int(1, 2);
    const p2 = rng.int(3, 6);
    const a1 = rng.range(1.5, 5);
    const a2 = rng.range(0.3, 1.2);
    const f1 = rng.range(0, Math.PI * 2);
    const f2 = rng.range(0, Math.PI * 2);
    ctx.strokeStyle = `rgba(70, 50, 30, ${rng.range(0.35, 0.8)})`;
    ctx.lineWidth = rng.range(0.5, 1.3);
    for (const dy of [-h, 0, h]) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const u = (x / w) * Math.PI * 2;
        const y = base + dy + a1 * Math.sin(u * p1 + f1) + a2 * Math.sin(u * p2 + f2);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  return { canvas, size: w };
}
