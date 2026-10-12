/**
 * The render loop and the renderer.
 *
 * Per frame the renderer draws the sky, composites one cached strip per layer with its
 * parallax offset, then the atmosphere and overlay hooks. Terrain is drawn only when a new
 * chunk scrolls into view, never every frame.
 */
import { smoothstep } from '../core/math';
import type { Style, View } from '../styles/types';
import { isProgressive, type World } from '../world/generator';
import { CHUNK_SECONDS, LAYERS, chunkIndexAt, chunkStart, type SkyState } from '../world/scene';
import { projectLayer, screenX, timeAtX, viewScale, type LayerProjection } from './camera';
import { paintChunk } from './chunk';
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
/** Live input: how far, in seconds of music, an object can reach into the chunk before it. */
const OVERHANG_SECONDS = 2;
/** Live input: the land fades out over this many CSS pixels (at scale 1) at the live edge. */
const LIVE_EDGE_FADE = 28;

/** Seconds over which old land fades out after the world is rebuilt or the style changes. */
const FADE_SECONDS = 0.5;
/**
 * While old land is fading out, new chunks are drawn for at most this many milliseconds per
 * frame (at least one chunk), so a style change never stalls a frame. The old land stays
 * fully on top until the new land is complete, then fades.
 */
const FADE_BUDGET_MS = 6;
/** Also at most this many chunks per frame: most of the drawing cost is paid later, at raster. */
const FADE_BUDGET_CHUNKS = 10;
/** Never hold the old land for longer than this, in seconds. */
const MAX_HOLD_SECONDS = 1.5;

interface Fading {
  layers: LayerState[];
  /** The style the old strips were drawn in. */
  style: Style;
  /**
   * A new world: the last frame was copied to the fade canvas and fades out as a still
   * picture. The old world's style setup is gone, so it cannot be drawn again.
   */
  still: boolean;
  /** When the fade starts. Pushed forward while the new land is still being drawn. */
  start: number;
  /** When the old land was replaced, to cap how long it is held. */
  since: number;
  surfaceKey: string;
}

export class Renderer {
  private layers: LayerState[] = [];
  private surfaceKey = '';
  private readonly chunkScratch: CanvasRenderingContext2D;
  private readonly shiftScratch: CanvasRenderingContext2D;
  /** The old style's frame during a style crossfade. Shrunk to nothing between fades. */
  private fadeScratch: CanvasRenderingContext2D | null = null;
  private chunksRendered = 0;
  /** Milliseconds spent building and drawing chunks, for the average in stats(). */
  private chunkMs = 0;
  private dpr = 1;
  private scale = 1;
  private fading: Fading | null = null;
  private clock = 0;
  private playhead = PLAYHEAD;
  private playheadTarget = PLAYHEAD;
  private liveUntil = Infinity;
  /** The canvas of the last frame drawn, for the still picture when the world changes. */
  private stage: HTMLCanvasElement | null = null;

  constructor(
    private world: World,
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
    // A still picture of the old world stays on top until it has faded out.
    if (this.layers.length > 0 && !this.fading?.still) {
      this.fading = {
        layers: this.layers,
        style: this.style,
        still: false,
        start: this.clock,
        since: this.clock,
        surfaceKey: this.surfaceKey,
      };
    }
    this.layers = [];
    this.surfaceKey = '';
  }

  /**
   * Swaps in a new world (a new seed). The last frame stays on top as a still picture until
   * the new land is drawn, then fades out. Call it right after the style was set up for the
   * new seed, before the next frame.
   */
  setWorld(world: World): void {
    if (world === this.world) return;
    const surfaceKey = this.surfaceKey;
    this.world = world;
    this.reset();
    const stage = this.stage;
    if (!stage || stage.width <= 1 || stage.height <= 1) {
      this.fading = null;
      return;
    }
    this.fadeScratch ??= scratchContext();
    const c = this.fadeScratch;
    resize(c, stage.width, stage.height);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, stage.width, stage.height);
    c.drawImage(stage, 0, 0);
    this.fading = {
      layers: [],
      style: this.style,
      still: true,
      start: this.clock,
      since: this.clock,
      surfaceKey,
    };
  }

  /** Where the playhead is now, as a fraction of the view width. */
  get playheadFraction(): number {
    return this.playhead;
  }

  /** Moves the playhead (a fraction of the view width) there, sliding over about a second. */
  setPlayhead(fraction: number): void {
    this.playheadTarget = fraction;
  }

  /**
   * Switches style. The land is redrawn in the new style on the next frame, and the old
   * style's whole frame (sky included) fades out on top of it.
   */
  setStyle(style: Style): void {
    if (style === this.style) return;
    this.reset();
    this.style = style;
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
    this.stage = ctx.canvas;
    this.fit(surface);
    let fading = this.fading;
    const fade = fading ? 1 - smoothstep(0, FADE_SECONDS, clock - fading.start) : 0;
    if (fading && (fade <= 0 || fading.surfaceKey !== this.surfaceKey)) {
      this.fading = fading = null;
      this.releaseFadeScratch();
    }
    const view: View = {
      width: surface.cssWidth,
      height: surface.cssHeight,
      dpr: surface.dpr,
      now,
      clock,
    };
    const playheadX = surface.cssWidth * this.playhead;
    const sky = this.world.skyAt(now);
    // Same style: each old layer fades out over its new one. New style: the old style's
    // whole frame is drawn aside and fades out over the new frame.
    const sameStyle = fading !== null && !fading.still && fading.style === this.style;

    // Only the time spent drawing chunks counts, so compositing never starves a layer.
    let allowed = FADE_BUDGET_CHUNKS;
    const spentBefore = this.chunkMs;
    const budget = fading
      ? () => allowed-- > 0 && this.chunkMs - spentBefore < FADE_BUDGET_MS
      : undefined;
    let complete = true;

    ctx.save();
    this.style.drawSky(ctx, sky, view);
    ctx.restore();

    this.layers.forEach((layer, i) => {
      const { projection: p, strip } = layer;
      const first = chunkIndexAt(timeAtX(0, now, playheadX, p.pxPerSecond));
      const last = chunkIndexAt(timeAtX(surface.cssWidth, now, playheadX, p.pxPerSecond));
      this.refreshOpen(layer, i);
      this.chunksRendered += strip.ensure(
        first,
        last,
        (sctx, index, x) => this.renderChunk(sctx, i, index, x, p),
        budget,
      );
      complete &&= strip.complete;
      drawStrip(ctx, layer, now, playheadX, surface.dpr);
      const old = sameStyle ? fading?.layers[i] : undefined;
      if (old) {
        ctx.globalAlpha = fade;
        drawStrip(ctx, old, now, playheadX, surface.dpr);
        ctx.globalAlpha = 1;
      }
      this.world.retain(i, first - 2, last + 2);
      drawAtmosphere(ctx, this.style, i, sky, view);
    });
    drawOverlay(ctx, this.style, view);
    // Hold the old land until the new land is whole.
    if (fading && !complete && clock - fading.since < MAX_HOLD_SECONDS) fading.start = clock;

    if (fading && !sameStyle) {
      const old = fading.still
        ? this.fadeScratch
        : this.oldFrame(fading, surface, view, playheadX, sky);
      if (!old) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = fade;
      ctx.drawImage(
        old.canvas,
        0,
        0,
        surface.width,
        surface.height,
        0,
        0,
        surface.width,
        surface.height,
      );
      ctx.restore();
    }
  }

  /** The old style's frame, with its strips as they were when the style changed. */
  private oldFrame(
    fading: Fading,
    surface: Surface,
    view: View,
    playheadX: number,
    sky: SkyState,
  ): CanvasRenderingContext2D {
    this.fadeScratch ??= scratchContext();
    const c = this.fadeScratch;
    if (c.canvas.width !== surface.width || c.canvas.height !== surface.height) {
      c.canvas.width = surface.width;
      c.canvas.height = surface.height;
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, surface.width, surface.height);
    c.setTransform(surface.dpr, 0, 0, surface.dpr, 0, 0);
    c.save();
    fading.style.drawSky(c, sky, view);
    c.restore();
    fading.layers.forEach((layer, i) => {
      drawStrip(c, layer, view.now, playheadX, surface.dpr);
      drawAtmosphere(c, fading.style, i, sky, view);
    });
    drawOverlay(c, fading.style, view);
    return c;
  }

  private releaseFadeScratch(): void {
    if (!this.fadeScratch) return;
    this.fadeScratch.canvas.width = 1;
    this.fadeScratch.canvas.height = 1;
  }

  stats() {
    return {
      strips: this.layers.length,
      stripPixels: this.layers.reduce(
        (n, l) => n + l.strip.canvas.width * l.strip.canvas.height,
        0,
      ),
      chunksRendered: this.chunksRendered,
      chunkMs: this.chunksRendered > 0 ? this.chunkMs / this.chunksRendered : 0,
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

  /**
   * Marks open chunks for redrawing once enough new live features have arrived, and the
   * chunk just before each while the live edge is close to its start.
   */
  private refreshOpen(layer: LayerState, i: number): void {
    if (layer.revealed.size === 0) return;
    for (const [index, until] of layer.revealed) {
      const complete = !this.world.isOpen(i, index);
      if (complete || this.liveUntil - until >= REVEAL_STEP) {
        layer.revealed.delete(index);
        layer.strip.invalidateSlot(index);
        // While the live edge is near this chunk's start, the chunk before it is redrawn too:
        // a tree that has just appeared there overhangs into it, and would be cut in half.
        if (until < chunkStart(index) + OVERHANG_SECONDS) layer.strip.invalidateSlot(index - 1);
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
    const started = performance.now();
    const world = this.world;
    const start = chunkStart(index);
    const dpr = this.dpr;
    const c = this.chunkScratch;
    paintChunk(c, this.style, world, layer, index, p, this.scale, dpr);
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
    // The land grows out of the mist at the live edge instead of ending in a straight cut.
    if (width > 0 && width < p.chunkPx) {
      const fade = Math.min(width, Math.round(LIVE_EDGE_FADE * this.scale * dpr));
      const g = target.createLinearGradient(x + width - fade, 0, x + width, 0);
      g.addColorStop(0, 'rgba(0, 0, 0, 0)');
      g.addColorStop(1, 'rgba(0, 0, 0, 1)');
      target.save();
      target.globalCompositeOperation = 'destination-out';
      target.fillStyle = g;
      target.fillRect(x + width - fade, 0, fade, p.heightPx);
      target.restore();
    }
    this.chunkMs += performance.now() - started;
  }
}

/** Composites a layer's strip at its parallax offset. */
function drawStrip(
  ctx: CanvasRenderingContext2D,
  layer: LayerState,
  now: number,
  playheadX: number,
  dpr: number,
): void {
  const { projection: p, strip } = layer;
  const x = screenX(chunkStart(strip.firstIndex), now, playheadX, p.pxPerSecond);
  ctx.drawImage(strip.canvas, x, p.top, strip.canvas.width / dpr, p.height);
}

function drawAtmosphere(
  ctx: CanvasRenderingContext2D,
  style: Style,
  layer: number,
  sky: SkyState,
  view: View,
): void {
  const spec = LAYERS[layer];
  if (!spec || !style.drawAtmosphere) return;
  ctx.save();
  style.drawAtmosphere(ctx, spec.depth, sky, view);
  ctx.restore();
}

function drawOverlay(ctx: CanvasRenderingContext2D, style: Style, view: View): void {
  if (!style.drawOverlay) return;
  ctx.save();
  style.drawOverlay(ctx, view);
  ctx.restore();
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
