/**
 * The render loop. Phase 0 only sizes the canvas and drives a draw callback.
 * Chunk caching, compositing and parallax arrive in Phase 1.
 */

/** Device pixel ratio cap. Higher ratios cost a lot of fill rate for little visible gain. */
export const MAX_DPR = 2;

/** Longest step the loop reports, so a stalled tab does not cause a jump. */
const MAX_FRAME_SECONDS = 0.1;

export interface Surface {
  /** Size in CSS pixels. */
  cssWidth: number;
  cssHeight: number;
  /** Device pixel ratio after the cap. */
  dpr: number;
  /** Backing store size in device pixels. */
  width: number;
  height: number;
}

export function measureSurface(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): Surface {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const dpr = Math.min(ratio, MAX_DPR);
  return {
    cssWidth,
    cssHeight,
    dpr,
    width: Math.max(1, Math.round(cssWidth * dpr)),
    height: Math.max(1, Math.round(cssHeight * dpr)),
  };
}

export interface Frame {
  surface: Surface;
  /** Seconds of rendering so far. Stops while the tab is hidden. */
  time: number;
  /** Seconds since the previous frame, capped. */
  dt: number;
}

export type DrawFn = (ctx: CanvasRenderingContext2D, frame: Frame) => void;

export interface Loop {
  stop(): void;
}

/**
 * Runs draw on every animation frame. The context arrives scaled by the device pixel ratio,
 * so draw works in CSS pixels. Rendering pauses while the tab is hidden.
 */
export function startLoop(canvas: HTMLCanvasElement, draw: DrawFn): Loop {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');

  let surface = measureSurface(0, 0, 1);
  let time = 0;
  let last: number | null = null;
  let handle = 0;
  let running = true;

  // Checked every frame: this catches window resizes, rotation and zoom (which changes dpr).
  const fit = () => {
    const next = measureSurface(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
    if (
      next.width !== surface.width ||
      next.height !== surface.height ||
      next.dpr !== surface.dpr
    ) {
      canvas.width = next.width;
      canvas.height = next.height;
      surface = next;
    }
  };

  const tick = (stamp: number) => {
    if (!running) return;
    const dt = last === null ? 0 : Math.min((stamp - last) / 1000, MAX_FRAME_SECONDS);
    last = stamp;
    time += dt;
    fit();
    ctx.setTransform(surface.dpr, 0, 0, surface.dpr, 0, 0);
    draw(ctx, { surface, time, dt });
    handle = requestAnimationFrame(tick);
  };

  const onVisibility = () => {
    cancelAnimationFrame(handle);
    if (!running || document.hidden) return;
    last = null;
    handle = requestAnimationFrame(tick);
  };

  document.addEventListener('visibilitychange', onVisibility);
  handle = requestAnimationFrame(tick);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(handle);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
