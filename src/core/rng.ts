/**
 * Seeded randomness. The only place in the project allowed to produce random numbers.
 *
 * Phase 0 defines the shape. The generator (sfc32 or mulberry32) and hashSeed
 * arrive in Phase 1.
 */

export interface Rng {
  /** Next value in [0, 1). */
  next(): number;
  /** Uniform value in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max], both included. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Normally distributed value. */
  gaussian(mean?: number, sd?: number): number;
}
