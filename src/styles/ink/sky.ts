/**
 * The ink sky is the paper itself: warm rice paper with faint fibers, a grey wash at the top
 * when the music turns dramatic, and a pale vermilion sun at dusk. Mist drifts between the
 * ranges, and a small red seal sits in the corner.
 */
import { clamp01, lerp, mod, smoothstep } from '../../core/math';
import { hash01 } from '../../core/rng';
import type { SkyState } from '../../world/scene';
import { ViewCache } from '../shared/canvas';
import { alignedPattern } from '../shared/grain';
import { css, mix } from '../shared/palette';
import type { View } from '../types';
import { INK, PAPER, SEAL_SIZE, VERMILION, look } from './look';

const cache = new ViewCache();

export function drawSky(ctx: CanvasRenderingContext2D, sky: SkyState, view: View): void {
  const wash = Math.round(40 * clamp01(0.15 * sky.cloudiness + 0.35 * sky.mood));
  const dusk = Math.round(40 * (1 - smoothstep(0.25, 0.6, sky.brightness)));
  const sunY = Math.round(view.height * lerp(0.42, 0.2, sky.brightness));
  const sheet = cache.get(view, `${wash}|${dusk}|${sunY}`, (c) =>
    paintPaper(c, view, wash / 40, dusk / 40, sunY),
  );
  if (sheet) ctx.drawImage(sheet, 0, 0, view.width, view.height);
  else paintPaper(ctx, view, wash / 40, dusk / 40, sunY);
}

function paintPaper(
  ctx: CanvasRenderingContext2D,
  view: View,
  wash: number,
  dusk: number,
  sunY: number,
): void {
  const { width: w, height: h } = view;
  ctx.fillStyle = css(PAPER);
  ctx.fillRect(0, 0, w, h);

  // A grey wash brushed across the top, deeper in dramatic passages.
  if (wash > 0.01) {
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.5);
    g.addColorStop(0, css(INK, 0.32 * wash));
    g.addColorStop(1, css(INK, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h * 0.5);
  }

  // At dusk, a pale vermilion sun, soft at the edge like ink on damp paper.
  if (dusk > 0.01) {
    const r = 40 * (h / 1080);
    const x = w * 0.72;
    const g = ctx.createRadialGradient(x, sunY, r * 0.7, x, sunY, r * 1.08);
    g.addColorStop(0, css(mix(VERMILION, PAPER, 0.35), 0.75 * dusk));
    g.addColorStop(1, css(mix(VERMILION, PAPER, 0.35), 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - 2 * r, sunY - 2 * r, 4 * r, 4 * r);
  }

  const { fibers } = look();
  if (fibers) {
    const pattern = alignedPattern(ctx, fibers, 0, 0);
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

/** Mist drifts at this many CSS pixels per second of animation, at a 1080 px view. */
const MIST_DRIFT = 9;

/**
 * Bands of mist at the foot of each range: a soft veil of paper color and a few drifting
 * wisps. Still, quiet passages thicken it.
 */
export function drawAtmosphere(
  ctx: CanvasRenderingContext2D,
  depth: number,
  sky: SkyState,
  view: View,
): void {
  if (depth >= 1) return;
  const { width: w, height: h } = view;
  const scale = h / 1080;
  const strength = 0.35 + 0.65 * sky.mist;
  // Roughly where each range meets the next one down.
  const foot = h * (0.56 + 0.36 * depth);
  const band = h * (0.1 + 0.05 * depth);

  const g = ctx.createLinearGradient(0, foot - band, 0, foot + band * 0.6);
  g.addColorStop(0, css(PAPER, 0));
  g.addColorStop(0.65, css(PAPER, 0.55 * strength));
  g.addColorStop(1, css(PAPER, 0.25 * strength));
  ctx.fillStyle = g;
  ctx.fillRect(0, foot - band, w, band * 1.6);

  const { mist, seed } = look();
  if (!mist) return;
  const wisps = 4;
  const span = w + 900 * scale;
  ctx.globalAlpha = 0.5 * strength;
  for (let i = 0; i < wisps; i++) {
    const r = hash01(seed, 'wisp', depth, i);
    const ww = (380 + 420 * r) * scale;
    const hh = band * (0.5 + 0.4 * hash01(seed, 'wisp-h', depth, i));
    const speed = MIST_DRIFT * scale * (0.6 + 0.8 * r) * (1 - 0.5 * depth);
    const x = mod(r * span + view.clock * speed, span) - 450 * scale;
    const y = foot - hh * 0.6 + band * 0.3 * (hash01(seed, 'wisp-y', depth, i) - 0.5);
    ctx.drawImage(mist, x - ww / 2, y, ww, hh);
  }
  ctx.globalAlpha = 1;
}

/** The seal, in the top right corner. */
export function drawOverlay(ctx: CanvasRenderingContext2D, view: View): void {
  const { seal } = look();
  if (!seal) return;
  const s = SEAL_SIZE * Math.max(0.6, view.height / 1080);
  ctx.globalAlpha = 0.88;
  ctx.drawImage(seal, view.width - s - 28, 28, s, s);
  ctx.globalAlpha = 1;
}
