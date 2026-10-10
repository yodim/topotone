/** Small numeric helpers. Arithmetic only, so results match in every browser. */

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Where x sits between a and b, as 0..1 (not clamped). */
export function invLerp(a: number, b: number, x: number): number {
  return a === b ? 0 : (x - a) / (b - a);
}

/** Hermite step from 0 at edge0 to 1 at edge1. Works with edge0 > edge1 too. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(invLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

/** Quintic fade used by gradient noise: zero first and second derivatives at 0 and 1. */
export function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** A smooth bump: 1 at 0, falling to 0 at -1 and 1. A cheap stand-in for a gaussian. */
export function bump(x: number): number {
  if (x <= -1 || x >= 1) return 0;
  const s = 1 - x * x;
  return s * s;
}

/** Fractional part, always in [0, 1). */
export function fract(x: number): number {
  return x - Math.floor(x);
}

/** Modulo that stays positive for negative inputs. */
export function mod(x: number, m: number): number {
  return ((x % m) + m) % m;
}

/**
 * Like clamp01, but bends smoothly into the limits instead of cutting off: values within
 * `knee` of 0 or 1 approach them without ever reaching them, so peaks stay rounded instead
 * of turning into flat tables. Identity in the middle, continuous slope at the knees.
 */
export function softClamp01(x: number, knee = 0.15): number {
  if (x > 1 - knee) {
    const d = x - (1 - knee);
    return 1 - knee + (knee * d) / (d + knee);
  }
  if (x < knee) {
    const d = knee - x;
    return knee - (knee * d) / (d + knee);
  }
  return x;
}
