/**
 * Paper clouds: a few bumps on a flat base, cut from one sheet. Built once as sprites
 * (with their shadow and grain baked in), so the sky only has to place them every frame.
 */
import { createRng } from '../../core/rng';
import { softShadow } from '../shared/canvas';
import type { GrainTile } from '../shared/grain';
import { css } from '../shared/palette';
import type { Papers } from './palette';

export interface CloudSprite {
  canvas: HTMLCanvasElement;
  /** Size in CSS pixels at scale 1. */
  width: number;
  height: number;
}

const SHAPES = 6;

export function makeClouds(
  seed: number,
  dpr: number,
  papers: Papers,
  grain: GrainTile | null,
): CloudSprite[] {
  if (typeof document === 'undefined') return [];
  const rng = createRng(seed);
  const sprites: CloudSprite[] = [];
  // Built at twice the needed resolution for a 1080 px view, so they stay crisp when scaled.
  const res = dpr * 1.5;
  for (let s = 0; s < SHAPES; s++) {
    const w = rng.range(150, 280);
    const hgt = rng.range(0.24, 0.34) * w;
    const pad = 16;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((w + 2 * pad) * res);
    canvas.height = Math.ceil((hgt + 2 * pad) * res);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.scale(res, res);

    const base = pad + hgt;
    const r0 = hgt * 0.32;
    ctx.beginPath();
    // A flat base with rounded ends, and bumps along the top.
    ctx.roundRect(pad, base - 2 * r0, w, 2 * r0, r0);
    const bumps = rng.int(3, 5);
    for (let i = 0; i < bumps; i++) {
      const u = (i + 0.5) / bumps;
      const middle = 1 - Math.abs(u - 0.5) * 1.4;
      const r = hgt * rng.range(0.35, 0.5) * (0.6 + 0.5 * middle);
      const cx = pad + w * (0.14 + 0.72 * u) + rng.range(-0.04, 0.04) * w;
      const cy = base - r0 - r * 0.55;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
    softShadow(ctx, 'rgba(40, 52, 66, 0.22)', 7, 0, 2.5);
    ctx.fillStyle = css(papers.cloud);
    ctx.fill('nonzero');
    if (grain) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0)';
      ctx.globalCompositeOperation = 'source-atop';
      const pattern = ctx.createPattern(grain.canvas, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fill('nonzero');
      }
    }
    sprites.push({ canvas, width: w + 2 * pad, height: hgt + 2 * pad });
  }
  return sprites;
}
