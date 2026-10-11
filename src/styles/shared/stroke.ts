/**
 * Strokes whose width changes along the path, like a brush that swells and tapers. The
 * outline is built from the path's normals and filled in one go.
 */

/**
 * Fills a variable-width stroke along the points. width(u, i) gives the full width at point
 * i, where u runs from 0 at the first point to 1 at the last. Ends are round when
 * `roundCaps` is set.
 */
export function variableStroke(
  ctx: CanvasRenderingContext2D,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  width: (u: number, i: number) => number,
  opts: { roundCaps?: boolean } = {},
): void {
  const outline = strokeOutline(xs, ys, width);
  if (!outline) return;
  const { left, right, widths } = outline;
  const n = widths.length;
  ctx.beginPath();
  ctx.moveTo(left[0] as number, left[1] as number);
  for (let i = 1; i < n; i++) ctx.lineTo(left[2 * i] as number, left[2 * i + 1] as number);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[2 * i] as number, right[2 * i + 1] as number);
  ctx.closePath();
  ctx.fill();
  if (opts.roundCaps) {
    for (const i of [0, n - 1]) {
      const r = (widths[i] as number) / 2;
      if (r <= 0.05) continue;
      ctx.beginPath();
      ctx.arc(xs[i] as number, ys[i] as number, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * The two sides of a variable-width stroke as flat [x, y, x, y, ...] arrays, plus the width
 * at each point. Null when there are fewer than two points.
 */
export function strokeOutline(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  width: (u: number, i: number) => number,
): { left: Float64Array; right: Float64Array; widths: Float64Array } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const left = new Float64Array(2 * n);
  const right = new Float64Array(2 * n);
  const widths = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let dx = (xs[b] as number) - (xs[a] as number);
    let dy = (ys[b] as number) - (ys[a] as number);
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const w = Math.max(0, width(i / (n - 1), i));
    widths[i] = w;
    const x = xs[i] as number;
    const y = ys[i] as number;
    // The normal is the direction turned a quarter: (-dy, dx).
    left[2 * i] = x - (dy * w) / 2;
    left[2 * i + 1] = y + (dx * w) / 2;
    right[2 * i] = x + (dy * w) / 2;
    right[2 * i + 1] = y - (dx * w) / 2;
  }
  return { left, right, widths };
}
