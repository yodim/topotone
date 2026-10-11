/** Small canvas helpers for styles. */

/**
 * The device pixel ratio the context is drawn at. Shadow blur and shadow offsets ignore the
 * canvas transform, so styles multiply them by this to keep shadows the same on every screen.
 */
export function deviceScale(ctx: CanvasRenderingContext2D): number {
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : undefined;
  const a = m ? Math.hypot(m.a, m.b) : 1;
  return Number.isFinite(a) && a > 0 ? a : 1;
}

/** Sets a soft shadow in CSS pixels (blur and offsets), whatever the device pixel ratio. */
export function softShadow(
  ctx: CanvasRenderingContext2D,
  color: string,
  blur: number,
  dx = 0,
  dy = 0,
): void {
  const k = deviceScale(ctx);
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * k;
  ctx.shadowOffsetX = dx * k;
  ctx.shadowOffsetY = dy * k;
}

export function noShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}
