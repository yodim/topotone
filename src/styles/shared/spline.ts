/**
 * Catmull-Rom splines: smooth curves through a list of points. Handy for rounding a ridge
 * that was sampled coarsely, or for organic outlines (clouds, rocks, leaves).
 */

/**
 * Adds a smooth curve through the points to the current path. Each span becomes one cubic
 * Bezier. `tension` 0 is a straight polyline, 1 the classic Catmull-Rom curve.
 * Starts with moveTo unless `connect` is set, in which case it continues the path.
 */
export function traceSpline(
  ctx: CanvasRenderingContext2D,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  opts: { closed?: boolean; tension?: number; connect?: boolean } = {},
): void {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return;
  const closed = opts.closed ?? false;
  const k = (opts.tension ?? 1) / 6;
  const at = (i: number): [number, number] => {
    const j = closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    return [xs[j] as number, ys[j] as number];
  };
  const [x0, y0] = at(0);
  if (opts.connect) ctx.lineTo(x0, y0);
  else ctx.moveTo(x0, y0);
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const [ax, ay] = at(i - 1);
    const [bx, by] = at(i);
    const [cx, cy] = at(i + 1);
    const [dx, dy] = at(i + 2);
    ctx.bezierCurveTo(
      bx + (cx - ax) * k,
      by + (cy - ay) * k,
      cx - (dx - bx) * k,
      cy - (dy - by) * k,
      cx,
      cy,
    );
  }
  if (closed) ctx.closePath();
}

/** The Catmull-Rom curve through p1 and p2 at u in 0..1, with p0 and p3 as neighbors. */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (3 * p1 - p0 - 3 * p2 + p3) * u3)
  );
}

/** Resamples values with `perSpan` points between each pair, along a Catmull-Rom curve. */
export function smoothValues(values: ArrayLike<number>, perSpan: number): Float64Array {
  const n = values.length;
  if (n < 2 || perSpan <= 1) return Float64Array.from(values as ArrayLike<number>);
  const out = new Float64Array((n - 1) * perSpan + 1);
  const v = (i: number) => values[Math.max(0, Math.min(n - 1, i))] as number;
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < perSpan; s++) {
      out[i * perSpan + s] = catmullRom(v(i - 1), v(i), v(i + 1), v(i + 2), s / perSpan);
    }
  }
  out[out.length - 1] = v(n - 1);
  return out;
}
