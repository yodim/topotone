/**
 * URL parameters: ?seed= (any text, or a number), ?style= (a style folder name) and
 * ?speed= (how fast music time runs in the fallback, 1 is real time). ?tune opens the tuning
 * panel.
 */
import { clamp } from '../core/math';
import { hashSeed } from '../core/rng';

export interface Params {
  /** The seed exactly as written in the URL, or null when there is none. */
  seedText: string | null;
  style: string | null;
  speed: number;
  /** Show the tuning panel. */
  tune: boolean;
}

export const MIN_SPEED = 0.05;
export const MAX_SPEED = 50;

export function parseParams(search: string): Params {
  const q = new URLSearchParams(search);
  const seed = q.get('seed')?.trim() || null;
  const style = q.get('style')?.trim() || null;
  const speedRaw = Number.parseFloat(q.get('speed') ?? '');
  const speed =
    Number.isFinite(speedRaw) && speedRaw > 0 ? clamp(speedRaw, MIN_SPEED, MAX_SPEED) : 1;
  return { seedText: seed, style, speed, tune: q.has('tune') };
}

/** A whole number from 0 to 2^32 - 1 is used as is. Any other text is hashed. */
export function seedFromText(text: string): number {
  if (/^\d{1,10}$/.test(text)) {
    const n = Number(text);
    if (n <= 0xffffffff) return n;
  }
  return hashSeed(text);
}
