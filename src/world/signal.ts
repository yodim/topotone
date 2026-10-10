/**
 * Windowed statistics over a run of feature frames.
 *
 * Smoothing is always a plain mean over a window centred on the time asked for, never a
 * running average. That keeps every value a function of time alone: two chunks asking about
 * the same moment see the same frames, summed in the same order, and get the same answer.
 */
import type { FeatureFrame } from '../audio/features';

export type ColumnFn = (frame: FeatureFrame) => number;

export class FrameWindow<C extends string> {
  readonly times: Float64Array;
  private readonly columns: Record<C, Float64Array>;

  /**
   * With `causal`, mean() looks back only: the window ends at the time asked for. Live input
   * needs that, so a value never changes once the frames up to its time exist.
   */
  constructor(
    readonly frames: readonly FeatureFrame[],
    columns: Record<C, ColumnFn>,
    readonly causal = false,
  ) {
    // Plain loops: Float64Array.from with a map function is several times slower.
    const n = frames.length;
    this.times = new Float64Array(n);
    for (let i = 0; i < n; i++) this.times[i] = (frames[i] as FeatureFrame).t;
    const out = {} as Record<C, Float64Array>;
    for (const name of Object.keys(columns) as C[]) {
      const fn = columns[name];
      const values = new Float64Array(n);
      for (let i = 0; i < n; i++) values[i] = fn(frames[i] as FeatureFrame);
      out[name] = values;
    }
    this.columns = out;
  }

  /** Index of the first frame with time >= t. */
  indexAt(t: number): number {
    let lo = 0;
    let hi = this.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.times[mid] ?? 0) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Mean of a column over [from, to). Falls back to the nearest frame when the range is empty. */
  meanRange(column: C, from: number, to: number): number {
    const values = this.columns[column];
    if (values.length === 0) return 0;
    const i = this.indexAt(from);
    const j = this.indexAt(to);
    if (j <= i) return values[Math.min(i, values.length - 1)] ?? 0;
    let sum = 0;
    for (let k = i; k < j; k++) sum += values[k] ?? 0;
    return sum / (j - i);
  }

  /** Mean of a column over a window of the given width, centred on t (or ending at t). */
  mean(column: C, t: number, width: number): number {
    if (this.causal) return this.meanRange(column, t - width, t + 1e-9);
    return this.meanRange(column, t - width / 2, t + width / 2);
  }
}
