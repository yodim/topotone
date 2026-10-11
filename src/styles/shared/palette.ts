/**
 * Small color helpers. Colors are plain [r, g, b] triples, 0..255, so they can be mixed
 * before being turned into a CSS string once.
 */
import { clamp01 } from '../../core/math';

export type Rgb = readonly [number, number, number];

/** '#a1b2c3' or '#abc' to [r, g, b]. */
export function hex(color: string): Rgb {
  let h = color.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) throw new Error(`Not a hex color: ${color}`);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear mix from a to b. t is clamped to 0..1. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const u = clamp01(t);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Mixes through a list of colors: 0 is the first, 1 the last. */
export function ramp(colors: readonly Rgb[], t: number): Rgb {
  const first = colors[0];
  if (!first) throw new Error('ramp needs at least one color');
  if (colors.length === 1) return first;
  const u = clamp01(t) * (colors.length - 1);
  const i = Math.min(Math.floor(u), colors.length - 2);
  return mix(colors[i] ?? first, colors[i + 1] ?? first, u - i);
}

/** Towards white (amount > 0) or black (amount < 0). */
export function shade(c: Rgb, amount: number): Rgb {
  return amount >= 0 ? mix(c, [255, 255, 255], amount) : mix(c, [0, 0, 0], -amount);
}

/** CSS color string, with an optional alpha. */
export function css(c: Rgb, alpha = 1): string {
  const r = Math.round(c[0]);
  const g = Math.round(c[1]);
  const b = Math.round(c[2]);
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}
