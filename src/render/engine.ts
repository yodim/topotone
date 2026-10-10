/**
 * The render loop and the renderer.
 *
 * Per frame the renderer draws the sky, composites one cached strip per layer with its
 * parallax offset, then the atmosphere and overlay hooks. Terrain is drawn only when a new
 * chunk scrolls into view, never every frame.
 */
import { createRng, hashSeed } from '../core/rng';
import type { ChunkEnv, Style, View } from '../styles/types';
import { isProgressive, type World } from '../world/generator';
import { CHUNK_SECONDS, LAYERS, chunkIndexAt, chunkStart } from '../world/scene';
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
  /** Live input: open chunks and the live time they were last drawn up to. */
  revealed: Map<number, number>;
}

/** Fraction of the view width where the playhead sits. */
const PLAYHEAD = 0.5;
/** How fast the playhead slides to a new position, in view widths per second. */
const PLAYHEAD_SPEED = 0.5;
/** Live input: open near-layer chunks are redrawn this often (seconds of new features). */
const REVEAL_STEP = 0.25;

/** Seconds over which old land fades out after the world is rebuilt. */
const FADE_SECONDS = 0.5;

interface Fading {
  layers: LayerState[];
  start: number;
  surfaceKey: string;
}

export class Renderer {
  private layers: LayerState[] = [];
  private surfaceKey = '';
  private readonly chunkScratch: CanvasRenderingContext2D;
  private readonly shiftScratch: CanvasRenderingContext2D;
  private chunksRendered = 0;
  private dpr = 1;
  private scale = 1;
  private fading: Fading | null = null;
  private clock = 0;
  private playhead = PLAYHEAD;
  private playheadTarget = PLAYHEAD;
  private liveUntil = Infinity;

  constructor(
    private readonly world: World,
    private style: Style,
  ) {
    this.chunkScratch = scratchContext();
    this.shiftScratch = scratchContext();
  }

  /**
   * Starts over with fresh strips after the world was rebuilt. The old strips keep scrolling
   * and fade out on top of the new ones, so the change reads as a soft crossfade.
   */
  reset(): void {
    if (this.layers.length > 0) {
      this.fading = { layers: this.layers, start: this.clock, surfaceKey: this.surfaceKey };
    }
    this.layers = [];
    this.surfaceKey = '';
  }

  /** Where the playhead is now, as a fraction of the view width. */
  get playheadFraction(): number {
    return this.playhead;
  }

  /** Moves the playhead (a fraction of the view width) there, sliding over about a second. */
  setPlayhead(fraction: number): void {
    this.playheadTarget = fraction;
  }

  /** Switches style. Every cached chunk is redrawn on the next frame. */
  setStyle(style: Style): void {
    this.style = style;
    for (const layer of this.layers) layer.strip.invalidate();
  }

  /**
   * Draws one frame. liveUntil is the world time up to which live features are final:
   * near-layer land is only drawn up to there, and grows in steps as features arrive.
   */
  render(
    ctx: CanvasRenderingContext2D,
    surface: Surface,
    now: number,
    clock: number,
    liveUntil = Infinity,
  ): void {
    const step = Math.max(0, clock - this.clock) * PLAYHEAD_SPEED;
    const gap = this.playheadTarget - this.playhead;
    this.playhead += Math.max(-step, Math.min(step, gap));
    this.clock = clock;
    this.liveUntil = liveUntil;
    this.fit(surface);
    const fading = this.fading;
    const fade = fading ? 1 - (clock - fading.start) / FADE_SECONDS : 0;
    if (fading && (fade <= 0 || fading.surfaceKey !== this.surfaceKey)) this.fading = null;
    const view: View = {
      width: surface.cssWidth,
      height: surface.cssHeight,
      dpr: surface.dpr,
      now,
      clock,
    };
    const playheadX = surface.cssWidth * this.playhead;
    const sky = this.world.skyAt(now);

    ctx.save();
    this.style.drawSky(ctx, sky, view);
    ctx.restore();

    this.layers.forEach((layer, i) => {
      const { projection: p, strip } = layer;
      const first = chunkIndexAt(timeAtX(0, now, playheadX, p.pxPerSecond));
      const last = chunkIndexAt(timeAtX(surface.cssWidth, now, playheadX, p.pxPerSecond));
      this.refreshOpen(layer, i);
      this.chunksRendered += strip.ensure(first, last, (sctx, index, x) =>
        this.renderChunk(sctx, i, index, x, p),
      );
      const x = screenX(chunkStart(strip.firstIndex), now, playheadX, p.pxPerSecond);
      ctx.drawImage(strip.canvas, x, p.top, strip.canvas.width / surface.dpr, p.height);
      const old = this.fading?.layers[i];
      if (old) {
        const ox = screenX(
          chunkStart(old.strip.firstIndex),
          now,
          playheadX,
          old.projection.pxPerSecond,
        );
        ctx.globalAlpha = fade;
        ctx.drawImage(
          old.strip.canvas,
          ox,
          old.projection.top,
          old.strip.canvas.width / surface.dpr,
          old.projection.height,
        );
        ctx.globalAlpha = 1;
      }
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
      revealed: new Map<number, number>(),
    }));
  }

  /** Marks open chunks for redrawing once enough new live features have arrived. */
  private refreshOpen(layer: LayerState, i: number): void {
    if (layer.revealed.size === 0) return;
    for (const [index, until] of layer.revealed) {
      const complete = !this.world.isOpen(i, index);
      if (complete || this.liveUntil - until >= REVEAL_STEP) {
        layer.revealed.delete(index);
        layer.strip.invalidateSlot(index);
      }
    }
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
    // Only the chunk itself is copied: this is where the bleed gets clipped away. A chunk
    // still waiting for live features is copied only up to the live time.
    let width = p.chunkPx;
    if (isProgressive(layer) && world.isOpen(layer, index)) {
      const known = Math.min(this.liveUntil, start + CHUNK_SECONDS) - start;
      width = Math.max(0, Math.min(p.chunkPx, Math.floor(known * p.pxPerSecond * dpr)));
      this.layers[layer]?.revealed.set(index, this.liveUntil);
    }
    if (width > 0)
      target.drawImage(c.canvas, p.bleedPx, 0, width, p.heightPx, x, 0, width, p.heightPx);
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
