/**
 * The woodblock sky: ivory paper with a bokashi of Prussian blue at the top and a band of
 * color along the horizon, a vermilion sun at dusk, and clouds as long flat bands with
 * rounded ends. Mist is a soft ivory bokashi at the foot of the distant ranges.
 */
import { clamp01, lerp, mod, smoothstep } from '../../core/math';
import { hash01 } from '../../core/rng';
import type { SkyState } from '../../world/scene';
import { ViewCache } from '../shared/canvas';
import { alignedPattern } from '../shared/grain';
import { css, mix, type Rgb } from '../shared/palette';
import type { View } from '../types';
import { look } from './look';
import { INDIGO, KEYLINE, OCHRE, PAPER, PRUSSIAN, VERMILION } from './palette';

const cache = new ViewCache();

interface SkyInks {
  top: Rgb;
  /** How far down the top bokashi reaches, as a fraction of the view height. */
  reach: number;
  horizon: Rgb;
  dusk: number;
}

function inks(sky: SkyState): SkyInks {
  const dusk = 1 - smoothstep(0.3, 0.6, sky.brightness);
  return {
    top: mix(PRUSSIAN, INDIGO, 0.3 + 0.7 * sky.mood),
    reach: 0.22 + 0.16 * sky.mood,
    // Day: a pale blue horizon. Warm songs and dusk: ochre to vermilion.
    horizon: mix(
      mix(PRUSSIAN, PAPER, 0.6),
      mix(OCHRE, VERMILION, dusk),
      clamp01(0.3 * sky.warmth + dusk),
    ),
    dusk,
  };
}

export function drawSky(ctx: CanvasRenderingContext2D, sky: SkyState, view: View): void {
  const s = inks(sky);
  const q = (c: Rgb) => c.map((v) => Math.round(v / 3)).join(',');
  const key = [q(s.top), q(s.horizon), Math.round(s.reach * 100), Math.round(s.dusk * 30)];
  const sheet = cache.get(view, key.join('|'), (c) => paintSky(c, s, view));
  if (sheet) ctx.drawImage(sheet, 0, 0, view.width, view.height);
  else paintSky(ctx, s, view);
  drawClouds(ctx, sky, view);
}

function paintSky(ctx: CanvasRenderingContext2D, s: SkyInks, view: View): void {
  const { width: w, height: h } = view;
  ctx.fillStyle = css(PAPER);
  ctx.fillRect(0, 0, w, h);

  // Bokashi at the top: the block was inked, then wiped towards the bottom.
  const top = ctx.createLinearGradient(0, 0, 0, h * s.reach);
  top.addColorStop(0, css(s.top, 0.95));
  top.addColorStop(0.45, css(s.top, 0.55));
  top.addColorStop(1, css(s.top, 0));
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h * s.reach);

  // A band of color along the horizon, behind the distant range.
  const y0 = h * 0.36;
  const y1 = h * 0.62;
  const band = ctx.createLinearGradient(0, y0, 0, y1);
  band.addColorStop(0, css(s.horizon, 0));
  band.addColorStop(0.6, css(s.horizon, 0.6));
  band.addColorStop(1, css(s.horizon, 0.3));
  ctx.fillStyle = band;
  ctx.fillRect(0, y0, w, y1 - y0);

  // At dusk, a flat vermilion sun.
  if (s.dusk > 0.05) {
    const r = 44 * (h / 1080);
    ctx.globalAlpha = smoothstep(0.05, 0.5, s.dusk);
    ctx.fillStyle = css(VERMILION);
    ctx.beginPath();
    ctx.arc(w * 0.7, h * lerp(0.3, 0.4, s.dusk), r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const { wood } = look();
  if (wood) {
    const pattern = alignedPattern(ctx, wood, 0, 0);
    if (pattern) {
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }
}

/** Clouds move at this fraction of the ground layer's speed. */
const CLOUD_PARALLAX = 0.1;
const CLOUD_SPACING = 24;
const CLOUD_DRIFT = 0.6;
const GROUND_PX_PER_SECOND = 64;

/**
 * Long bands with rounded ends, in slots along a slow cloud time. A cloud that is not wanted
 * slides down behind the distant range rather than fading.
 */
function drawClouds(ctx: CanvasRenderingContext2D, sky: SkyState, view: View): void {
  const { width: w, height: h } = view;
  const { seed } = look();
  const scale = h / 1080;
  const pps = GROUND_PX_PER_SECOND * scale * CLOUD_PARALLAX;
  const t = view.now + CLOUD_DRIFT * view.clock;
  const first = Math.floor((t - w / pps) / CLOUD_SPACING) - 1;
  const last = Math.ceil((t + w / pps) / CLOUD_SPACING) + 1;
  const keep = 0.06 + 0.5 * sky.cloudiness;
  const fill = mix(PAPER, VERMILION, 0.12 * (1 - sky.brightness));
  ctx.lineWidth = 1.4 * scale;
  ctx.strokeStyle = css(KEYLINE, 0.85);
  for (let i = first; i <= last; i++) {
    const chance = hash01(seed, 'band', i);
    const up = smoothstep(chance - 0.03, chance + 0.05, keep);
    if (up <= 0) continue;
    const len = (260 + 420 * hash01(seed, 'band-len', i)) * scale;
    const thick = (18 + 12 * hash01(seed, 'band-h', i)) * scale;
    const ct = (i + 0.8 * hash01(seed, 'band-at', i)) * CLOUD_SPACING;
    const x = w * 0.5 + (ct - t) * pps - len / 2;
    if (x > w || x + len < 0) continue;
    // Three lanes, taken in turn: bands in the same lane are three slots apart and never
    // touch, and the lanes are far enough apart for a band and the one tucked under it.
    const lane = mod(i, 3);
    const y = lerp(h * 0.5, h * (0.06 + 0.1 * lane + 0.025 * hash01(seed, 'band-y', i)), up);
    // The color block is printed a little off the keyline.
    ctx.fillStyle = css(fill);
    ctx.beginPath();
    ctx.roundRect(x + 1.5 * scale, y + 1 * scale, len, thick, thick / 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x, y, len, thick, thick / 2);
    ctx.stroke();
    // A second, shorter band tucked under some clouds.
    if (hash01(seed, 'band-2', i) < 0.5) {
      const l2 = len * 0.55;
      const x2 = x + len * (0.15 + 0.3 * hash01(seed, 'band-2x', i));
      ctx.beginPath();
      ctx.roundRect(x2 + 1.5 * scale, y + thick * 0.9 + 1 * scale, l2, thick * 0.8, thick * 0.4);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(x2, y + thick * 0.9, l2, thick * 0.8, thick * 0.4);
      ctx.stroke();
    }
  }
}

/** A soft ivory bokashi at the foot of the distant ranges, as if they rose out of mist. */
export function drawAtmosphere(
  ctx: CanvasRenderingContext2D,
  depth: number,
  sky: SkyState,
  view: View,
): void {
  if (depth > 0.5) return;
  const h = view.height;
  const foot = h * (0.58 + 0.36 * depth);
  const from = foot - h * 0.12;
  const to = foot + h * 0.04;
  const alpha = 0.35 + 0.5 * sky.mist;
  const g = ctx.createLinearGradient(0, from, 0, to);
  g.addColorStop(0, css(PAPER, 0));
  g.addColorStop(0.75, css(PAPER, alpha));
  g.addColorStop(1, css(PAPER, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, from, view.width, to - from);
}
