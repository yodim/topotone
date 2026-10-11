/**
 * Noise-based edge roughening, for edges cut with scissors, torn paper or a dry brush.
 *
 * The offset is a pure function of a position along the edge (usually layerDistance, so
 * music time in reference pixels). Two chunks that draw the same stretch of edge get the
 * same wobble, which keeps chunk edges invisible. Do not use the chunk rng for this.
 */
import { noise1 } from '../../core/noise';
import { hashSeed } from '../../core/rng';

export interface Roughness {
  /** Seed for this edge, constant along it. hashSeed(style id, layer role) is typical. */
  seed: number;
  /** Largest offset in CSS pixels at scale 1, for the slow wobble. */
  wobble: number;
  /** Distance between wobble bumps, in reference pixels. */
  wobbleLength: number;
  /** Largest offset for the fine jitter. */
  jitter: number;
  /** Distance between jitter bumps, in reference pixels. */
  jitterLength: number;
}

/** Edge offset at a position along the edge, in CSS pixels at scale 1. Roughly -1..1 times the amplitudes. */
export function edgeOffset(r: Roughness, position: number): number {
  return (
    r.wobble * noise1(r.seed, position / r.wobbleLength) +
    r.jitter * noise1(hashSeed(r.seed, 'jitter'), position / r.jitterLength)
  );
}

/**
 * Moves each y by the edge offset at its position, scaled by `scale`. Positive offsets go
 * down. Returns a new array.
 */
export function roughen(
  ys: ArrayLike<number>,
  positions: ArrayLike<number>,
  r: Roughness,
  scale: number,
): Float64Array {
  const out = new Float64Array(ys.length);
  for (let i = 0; i < ys.length; i++) {
    out[i] = (ys[i] as number) + edgeOffset(r, positions[i] as number) * scale;
  }
  return out;
}

/**
 * A closed outline around (cx, cy): `count` points on an ellipse, each pushed in or out by
 * up to `amount` (a fraction of the radius). The noise runs around the loop and closes on
 * itself, so there is no step where the outline starts.
 */
export function roughLoop(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  count: number,
  amount: number,
  seed: number,
): { xs: Float64Array; ys: Float64Array } {
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    // Noise sampled on a circle, so the first and the last point blend into each other.
    const wobble =
      0.5 * noise1(seed, 1.3 * Math.cos(a) + 7) +
      0.5 * noise1(hashSeed(seed, 1), 1.3 * Math.sin(a) + 7);
    const k = 1 + amount * wobble;
    xs[i] = cx + Math.cos(a) * rx * k;
    ys[i] = cy + Math.sin(a) * ry * k;
  }
  return { xs, ys };
}
