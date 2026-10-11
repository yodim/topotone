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

/**
 * A view-sized canvas that is repainted only when its key changes. Handy for a sky that
 * changes slowly: per frame it costs one copy instead of gradients and patterns.
 */
export class ViewCache {
  private ctx: CanvasRenderingContext2D | null = null;
  private key = '';

  /**
   * The cached canvas, repainted with paint() (in CSS pixels) when the key or the view size
   * changed. Null where there is no DOM.
   */
  get(
    view: { width: number; height: number; dpr: number },
    key: string,
    paint: (ctx: CanvasRenderingContext2D) => void,
  ): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    this.ctx ??= document.createElement('canvas').getContext('2d');
    const ctx = this.ctx;
    if (!ctx) return null;
    const w = Math.max(1, Math.round(view.width * view.dpr));
    const h = Math.max(1, Math.round(view.height * view.dpr));
    const full = `${w}x${h}|${key}`;
    if (full === this.key) return ctx.canvas;
    if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
      ctx.canvas.width = w;
      ctx.canvas.height = h;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    paint(ctx);
    this.key = full;
    return ctx.canvas;
  }
}
