/**
 * The render loop and the renderer.
 *
 * Per frame the renderer draws the sky, composites one cached strip per layer with its
 * parallax offset, then the atmosphere and overlay hooks. Terrain is drawn only when a new
 * chunk scrolls into view, never every frame.
 */
import { createRng, hashSeed } from '../core/rng';
import type { ChunkEnv, Style, View } from '../styles/types';
import type { World } from '../world/generator';
import { LAYERS, chunkIndexAt, chunkStart } from '../world/scene';
import { projectLayer, screenX, timeAtX, viewScale, type LayerProjection } from './camera';
import { LayerStrip } from './strip';

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

interface LayerState {
  projection: LayerProjection;
  strip: LayerStrip;
}

/** Fraction of the view width where the playhead sits. */
const PLAYHEAD = 0.5;

export class Renderer {
  private layers: LayerState[] = [];
  private surfaceKey = '';
  private readonly chunkScratch: CanvasRenderingContext2D;
  private readonly shiftScratch: CanvasRenderingContext2D;
  private chunksRendered = 0;
  private dpr = 1;
  private scale = 1;

  constructor(
    private readonly world: World,
    private style: Style,
  ) {
    this.chunkScratch = scratchContext();
    this.shiftScratch = scratchContext();
  }

  /** Switches style. Every cached chunk is redrawn on the next frame. */
  setStyle(style: Style): void {
    this.style = style;
    for (const layer of this.layers) layer.strip.invalidate();
  }

  render(ctx: CanvasRenderingContext2D, surface: Surface, now: number, clock: number): void {
    this.fit(surface);
    const view: View = {
      width: surface.cssWidth,
      height: surface.cssHeight,
      dpr: surface.dpr,
      now,
      clock,
    };
    const playheadX = surface.cssWidth * PLAYHEAD;
    const sky = this.world.skyAt(now);

    ctx.save();
    this.style.drawSky(ctx, sky, view);
    ctx.restore();

    this.layers.forEach((layer, i) => {
      const { projection: p, strip } = layer;
      const first = chunkIndexAt(timeAtX(0, now, playheadX, p.pxPerSecond));
      const last = chunkIndexAt(timeAtX(surface.cssWidth, now, playheadX, p.pxPerSecond));
      this.chunksRendered += strip.ensure(first, last, (sctx, index, x) =>
        this.renderChunk(sctx, i, index, x, p),
      );
      const x = screenX(chunkStart(strip.firstIndex), now, playheadX, p.pxPerSecond);
      ctx.drawImage(strip.canvas, x, p.top, strip.canvas.width / surface.dpr, p.height);
      this.world.retain(i, first - 2, last + 2);

      const spec = LAYERS[i];
      if (spec && this.style.drawAtmosphere) {
        ctx.save();
        this.style.drawAtmosphere(ctx, spec.depth, sky, view);
        ctx.restore();
      }
    });

    if (this.style.drawOverlay) {
      ctx.save();
      this.style.drawOverlay(ctx, view);
      ctx.restore();
    }
  }

  stats() {
    return {
      strips: this.layers.length,
      stripPixels: this.layers.reduce(
        (n, l) => n + l.strip.canvas.width * l.strip.canvas.height,
        0,
      ),
      chunksRendered: this.chunksRendered,
    };
  }

  /** Rebuilds projections and strips when the view size or pixel ratio changes. */
  private fit(surface: Surface): void {
    const key = `${surface.width}x${surface.height}@${surface.dpr}`;
    if (key === this.surfaceKey) return;
    this.surfaceKey = key;
    this.dpr = surface.dpr;
    this.scale = viewScale(surface.cssHeight);

    const projections = LAYERS.map((spec) => projectLayer(spec, surface));
    const slotsFor = (p: LayerProjection) => Math.ceil(surface.width / p.chunkPx) + 2;
    const maxStripW = Math.max(...projections.map((p) => slotsFor(p) * p.chunkPx));
    const maxChunkW = Math.max(...projections.map((p) => p.chunkPx + 2 * p.bleedPx));
    const maxH = Math.max(...projections.map((p) => p.heightPx));
    resize(this.shiftScratch, maxStripW, maxH);
    resize(this.chunkScratch, maxChunkW, maxH);

    this.layers = projections.map((projection) => ({
      projection,
      strip: new LayerStrip(
        slotsFor(projection),
        projection.chunkPx,
        projection.heightPx,
        this.shiftScratch,
      ),
    }));
  }

  private renderChunk(
    target: CanvasRenderingContext2D,
    layer: number,
    index: number,
    x: number,
    p: LayerProjection,
  ): void {
    const world = this.world;
    const chunk = world.chunk(layer, index);
    const start = chunkStart(index);
    const dpr = this.dpr;
    const widthPx = p.chunkPx + 2 * p.bleedPx;
    const env: ChunkEnv = {
      rng: createRng(hashSeed(chunk.seed, this.style.id)),
      sky: world.skyAt(start),
      neighbors: { prev: world.chunk(layer, index - 1), next: world.chunk(layer, index + 1) },
      width: widthPx / dpr,
      height: p.height,
      bleed: p.bleed,
      scale: this.scale,
      toX: (t) => p.bleed + (t - start) * p.pxPerSecond,
      toY: p.toY,
    };

    const c = this.chunkScratch;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, widthPx, p.heightPx);
    c.save();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.style.drawLayerChunk(c, chunk, env);
    c.restore();
    // Only the chunk itself is copied: this is where the bleed gets clipped away.
    target.drawImage(c.canvas, p.bleedPx, 0, p.chunkPx, p.heightPx, x, 0, p.chunkPx, p.heightPx);
  }
}

function scratchContext(): CanvasRenderingContext2D {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

function resize(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  if (ctx.canvas.width < width) ctx.canvas.width = width;
  if (ctx.canvas.height < height) ctx.canvas.height = height;
}
