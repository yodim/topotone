/**
 * The paper sky: a flat gradient sheet, a sun cut in rings, and clouds hung in front of it.
 * Runs every frame, so it only fills one gradient and places a few ready-made sprites.
 */
import { clamp01, lerp, smoothstep } from '../../core/math';
import { hash01 } from '../../core/rng';
import type { SkyState } from '../../world/scene';
import { ViewCache } from '../shared/canvas';
import { alignedPattern } from '../shared/grain';
import { css, mix, type Rgb } from '../shared/palette';
import type { View } from '../types';
import { look } from './look';
import { STORM, type Papers } from './palette';

export interface SkyColors {
  top: Rgb;
  horizon: Rgb;
  sun: Rgb;
}

/** Brightness moves the sky from dusk to day, mood pulls it towards storm grey. */
export function skyColors(papers: Papers, sky: SkyState): SkyColors {
  const p = papers.sky;
  const day = clamp01(sky.brightness);
  let top = mix(p.duskTop, p.dayTop, day);
  let horizon = mix(p.duskHorizon, p.dayHorizon, day);
  top = mix(top, STORM, 0.55 * sky.mood);
  horizon = mix(horizon, mix(STORM, horizon, 0.6), 0.45 * sky.mood);
  // A warm song warms the horizon a little.
  horizon = mix(horizon, p.duskHorizon, 0.35 * clamp01(sky.warmth - 0.45));
  return { top, horizon, sun: mix(papers.sun.dusk, papers.sun.day, day) };
}

/** Clouds sit far away: they move at this fraction of the ground layer's speed. */
const CLOUD_PARALLAX = 0.1;
/** Music seconds between cloud slots. */
const CLOUD_SPACING = 12;
/** Clouds also drift slowly on their own, in music seconds per second of animation. */
const CLOUD_DRIFT = 0.6;
/** Ground layer speed at a 1080 px view, as in the camera. */
const GROUND_PX_PER_SECOND = 64;

/**
 * The sky sheet (gradient, sun and grain) is drawn into its own canvas and reused until its
 * colors or the sun move by a visible step. Per frame that leaves one copy and the clouds.
 */
const cache = new ViewCache();

function skySheet(sky: SkyState, view: View): CanvasImageSource | null {
  const { papers } = look();
  const c = skyColors(papers, sky);
  const sunAlpha = 1 - 0.75 * smoothstep(0.45, 0.95, sky.mood);
  const sunY = Math.round(view.height * lerp(0.44, 0.16, sky.brightness));
  const q = (rgb: Rgb) => rgb.map((v) => Math.round(v / 2)).join(',');
  const key = [q(c.top), q(c.horizon), q(c.sun), sunY, Math.round(sunAlpha * 40), papers.name];
  return cache.get(view, key.join('|'), (ctx) => paintSkySheet(ctx, c, sunAlpha, sunY, view));
}

function paintSkySheet(
  ctx: CanvasRenderingContext2D,
  c: SkyColors,
  sunAlpha: number,
  sunY: number,
  view: View,
): void {
  const { width: w, height: h } = view;
  const scale = h / 1080;
  const g = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  g.addColorStop(0, css(c.top));
  g.addColorStop(1, css(c.horizon));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // The sun: three rings of paper, lower and redder at dusk, hidden by a stormy sky.
  if (sunAlpha > 0.02) {
    const r = 46 * scale;
    const x = w * 0.7;
    ctx.globalAlpha = sunAlpha;
    const rings: [number, number][] = [
      [1.6, 0.7],
      [1.28, 0.38],
      [1, 0],
    ];
    for (const [k, fade] of rings) {
      ctx.fillStyle = 'rgba(40, 30, 20, 0.08)';
      ctx.beginPath();
      ctx.arc(x + 1.5 * scale, sunY + 2.5 * scale, r * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css(mix(c.sun, c.horizon, fade));
      ctx.beginPath();
      ctx.arc(x, sunY, r * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const { skyGrain } = look();
  if (skyGrain) {
    const pattern = alignedPattern(ctx, skyGrain, 0, 0);
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

export function drawSky(ctx: CanvasRenderingContext2D, sky: SkyState, view: View): void {
  const { width: w, height: h } = view;
  const { clouds, seed } = look();
  const scale = h / 1080;
  const sheet = skySheet(sky, view);
  if (sheet) {
    ctx.drawImage(sheet, 0, 0, w, h);
  } else {
    const c = skyColors(look().papers, sky);
    paintSkySheet(ctx, c, 1, h * 0.3, view);
  }

  // Clouds: one slot every few seconds of a slow cloud time. Whether a slot holds a cloud
  // depends on cloudiness, so a dramatic stretch fills the sky.
  if (clouds.length === 0) return;
  const pps = GROUND_PX_PER_SECOND * scale * CLOUD_PARALLAX;
  const t = view.now + CLOUD_DRIFT * view.clock;
  const first = Math.floor((t - w / pps) / CLOUD_SPACING) - 1;
  const last = Math.ceil((t + w / pps) / CLOUD_SPACING) + 1;
  const keep = 0.08 + 0.62 * sky.cloudiness;
  for (let i = first; i <= last; i++) {
    // A cloud that is not wanted sinks behind the far mountains, like a prop on a stage,
    // instead of fading: paper does not turn transparent.
    const chance = hash01(seed, 'cloud', i);
    const up = smoothstep(chance - 0.03, chance + 0.05, keep);
    if (up <= 0) continue;
    const sprite = clouds[Math.floor(hash01(seed, 'cloud-shape', i) * clouds.length)];
    if (!sprite) continue;
    const size = scale * lerp(0.6, 1.15, hash01(seed, 'cloud-size', i));
    const ct = (i + hash01(seed, 'cloud-at', i) * 0.8) * CLOUD_SPACING;
    const x = w * 0.5 + (ct - t) * pps;
    const y = lerp(h * 0.5, h * lerp(0.04, 0.34, hash01(seed, 'cloud-y', i)), up);
    const cw = sprite.width * size;
    if (x + cw < 0 || x - cw > w) continue;
    ctx.drawImage(sprite.canvas, x - cw / 2, y, cw, sprite.height * size);
  }
}

/**
 * Mist as sheets of tracing paper between layers: a pale veil that thickens towards the
 * foot of the layer just drawn. Thicker in still, quiet passages.
 */
export function drawAtmosphere(
  ctx: CanvasRenderingContext2D,
  depth: number,
  sky: SkyState,
  view: View,
): void {
  if (depth >= 1) return;
  const { papers } = look();
  const c = skyColors(papers, sky);
  const alpha = (0.02 + 0.3 * sky.mist * sky.mist) * (1 - 0.5 * depth);
  if (alpha < 0.01) return;
  // Roughly where each layer's land meets its lowest point on screen. The veil is a band
  // around it, so only part of the screen is filled each frame.
  const foot = view.height * (0.57 + 0.38 * depth);
  const from = foot - view.height * 0.26;
  const to = foot + view.height * 0.12;
  const g = ctx.createLinearGradient(0, from, 0, to);
  g.addColorStop(0, css(c.horizon, 0));
  g.addColorStop(0.68, css(c.horizon, alpha));
  g.addColorStop(1, css(c.horizon, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, from, view.width, to - from);
}
