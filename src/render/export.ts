/**
 * Panorama export: the whole song, or the session so far, as one long image.
 *
 * Every layer moves at the ground layer's speed, so each column of the image is one moment
 * of the music in every layer. The far ranges come out wider and smoother than on screen,
 * and the melody shapes them along the whole image.
 *
 * Every chunk is rebuilt from the stored features and drawn the way the live view draws it
 * (render/chunk.ts). The work runs in short steps with a pause between them, so the page
 * stays responsive while it renders.
 */
import type { SkyStrip, Style, View } from '../styles/types';
import type { World } from '../world/generator';
import { CHUNK_SECONDS, LAYERS, chunkIndexAt } from '../world/scene';
import { BASE_PX_PER_SECOND, projectPanoramaLayer, viewScale } from './camera';
import { paintChunk } from './chunk';

/** Widest canvas every browser accepts. */
export const MAX_PANORAMA_WIDTH = 16384;
/** Largest canvas area Safari on iOS accepts. */
export const MAX_PANORAMA_AREA = 16_777_216;
/** Caption strip height at a 1080 px tall image. */
const CAPTION_HEIGHT = 56;

export interface PanoramaLayout {
  /** Image height, caption strip excluded, and the caption strip's height (0 without one). */
  height: number;
  captionHeight: number;
  width: number;
  /** One chunk's width in pixels, the same in every layer. */
  chunkPx: number;
  pxPerSecond: number;
  /** Music time at x = 0. */
  t0: number;
  /** Image x of music time 0: x = t * pxPerSecond - origin. */
  origin: number;
  /** Width kept, against the width the full speed would need: 1 when not squeezed. */
  squeeze: number;
}

/**
 * How music time from..to fits in an image of this height. The ground layer's speed is used
 * for every layer; a stretch too long for the canvas limits is squeezed horizontally. A
 * chunk is always a whole number of pixels, so chunks tile without seams.
 */
export function panoramaLayout(
  from: number,
  to: number,
  height: number,
  caption: boolean,
): PanoramaLayout {
  const scale = viewScale(height);
  const captionHeight = caption ? Math.round(CAPTION_HEIGHT * scale) : 0;
  const maxWidth = Math.min(
    MAX_PANORAMA_WIDTH,
    Math.floor(MAX_PANORAMA_AREA / (height + captionHeight)),
  );
  const ideal = Math.max(1, Math.round(CHUNK_SECONDS * BASE_PX_PER_SECOND * scale));
  const span = Math.max(1e-6, to - from);
  // One pixel of margin for rounding at both ends.
  const fit = Math.floor(((maxWidth - 2) * CHUNK_SECONDS) / span);
  const chunkPx = Math.max(1, Math.min(ideal, fit));
  const pxPerSecond = chunkPx / CHUNK_SECONDS;
  const origin = Math.floor(from * pxPerSecond);
  const width = Math.min(maxWidth, Math.max(1, Math.ceil(to * pxPerSecond) - origin));
  return {
    height,
    captionHeight,
    width,
    chunkPx,
    pxPerSecond,
    t0: origin / pxPerSecond,
    origin,
    squeeze: chunkPx / ideal,
  };
}

export interface PanoramaOptions {
  world: World;
  style: Style;
  from: number;
  to: number;
  /** Image height in pixels, caption excluded. */
  height: number;
  /** A strip under the image: a title on the left, details on the right. */
  caption: { title: string; details: string } | null;
  /** Called now and then with the share of the work done, 0..1. */
  onProgress?: (done: number) => void;
}

export interface Panorama {
  canvas: HTMLCanvasElement;
  layout: PanoramaLayout;
}

/** Pause between steps once this many milliseconds of work have run. */
const STEP_MS = 24;

export async function renderPanorama(o: PanoramaOptions): Promise<Panorama> {
  const layout = panoramaLayout(o.from, o.to, o.height, o.caption !== null);
  const { width, height, chunkPx, pxPerSecond, t0, origin } = layout;
  const scale = viewScale(height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height + layout.captionHeight;
  const ctx = context(canvas);
  const { world, style } = o;
  const timeAt = (x: number) => t0 + x / pxPerSecond;

  let resumed = performance.now();
  const step = async () => {
    if (performance.now() - resumed < STEP_MS) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
    resumed = performance.now();
  };

  // The sky, once for the whole image when the style can, else in blended tiles.
  ctx.save();
  if (style.drawSkyStrip) {
    const strip: SkyStrip = {
      width,
      height,
      dpr: 1,
      scale,
      t0,
      pxPerSecond,
      skyAt: (t) => world.skyAt(t),
    };
    style.drawSkyStrip(ctx, strip);
  } else {
    await blendTiles(ctx, width, height, scale, step, (tile, x, w) => {
      const t = timeAt(x + w / 2);
      style.drawSky(tile, world.skyAt(t), view(w, height, t));
    });
  }
  ctx.restore();

  const first = chunkIndexAt(t0);
  const last = chunkIndexAt(timeAt(width));
  const total = LAYERS.length * (last - first + 1);
  let done = 0;
  const projections = LAYERS.map((spec) => projectPanoramaLayer(spec, height, chunkPx));
  const scratch = context(document.createElement('canvas'));
  scratch.canvas.width = Math.max(...projections.map((p) => p.chunkPx + 2 * p.bleedPx));
  scratch.canvas.height = Math.max(...projections.map((p) => p.heightPx));

  for (let layer = 0; layer < LAYERS.length; layer++) {
    const p = projections[layer];
    const spec = LAYERS[layer];
    if (!p || !spec) continue;
    for (let index = first; index <= last; index++) {
      paintChunk(scratch, style, world, layer, index, p, scale, 1);
      const x = index * chunkPx - origin;
      ctx.drawImage(
        scratch.canvas,
        p.bleedPx,
        0,
        chunkPx,
        p.heightPx,
        x,
        p.topPx,
        chunkPx,
        p.heightPx,
      );
      // Keep only the chunks this one and its neighbors need.
      world.retain(layer, index - 1, index + 2);
      o.onProgress?.(++done / total);
      await step();
    }
    if (style.drawAtmosphere) {
      const depth = spec.depth;
      await blendTiles(ctx, width, height, scale, step, (tile, x, w) => {
        const t = timeAt(x + w / 2);
        style.drawAtmosphere?.(tile, depth, world.skyAt(t), view(w, height, t));
      });
    }
  }

  if (style.drawOverlay) {
    ctx.save();
    style.drawOverlay(ctx, view(width, height, timeAt(width / 2)));
    ctx.restore();
  }
  if (o.caption) drawCaption(ctx, layout, o.caption);
  return { canvas, layout };
}

/** A view for the per-frame hooks. The clock is the music time, so drifting things vary. */
function view(width: number, height: number, t: number): View {
  return { width, height, dpr: 1, now: t, clock: t };
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

/**
 * Paints a view-sized hook (drawSky, drawAtmosphere) along the whole image: in tiles the
 * width of a live view, overlapping by a quarter and crossfaded, so each tile can use the
 * sky of its own stretch without a visible step between tiles. Overlapping tiles are summed
 * before they are laid on the image, which keeps a semi-transparent mist even.
 */
async function blendTiles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  step: () => Promise<void>,
  paint: (tile: CanvasRenderingContext2D, x: number, w: number) => void,
): Promise<void> {
  const tw = Math.min(width, Math.round(1920 * scale));
  const ov = Math.min(Math.round(480 * scale), Math.floor(tw / 2));
  const stride = tw - ov;
  const count = width <= tw ? 1 : Math.ceil((width - ov) / stride);
  const make = () => {
    const c = context(document.createElement('canvas'));
    c.canvas.width = tw;
    c.canvas.height = height;
    return c;
  };
  let prev: CanvasRenderingContext2D | null = null;
  let current = make();
  let spare = make();
  for (let k = 0; k < count; k++) {
    const x = k * stride;
    current.globalCompositeOperation = 'source-over';
    current.clearRect(0, 0, tw, height);
    current.save();
    paint(current, x, tw);
    current.restore();
    // Fade in over the overlap with the tile before, and out over the one with the next.
    if (count > 1) {
      const g = current.createLinearGradient(0, 0, tw, 0);
      g.addColorStop(0, `rgba(0, 0, 0, ${k > 0 ? 0 : 1})`);
      g.addColorStop(ov / tw, 'rgba(0, 0, 0, 1)');
      g.addColorStop(1 - ov / tw, 'rgba(0, 0, 0, 1)');
      g.addColorStop(1, `rgba(0, 0, 0, ${k < count - 1 ? 0 : 1})`);
      current.globalCompositeOperation = 'destination-in';
      current.fillStyle = g;
      current.fillRect(0, 0, tw, height);
      current.globalCompositeOperation = 'source-over';
    }
    if (prev) {
      // Add this tile's fade-in to the previous tile's fade-out, then lay the previous down.
      prev.globalCompositeOperation = 'lighter';
      prev.drawImage(current.canvas, 0, 0, ov, height, stride, 0, ov, height);
      prev.globalCompositeOperation = 'source-over';
      ctx.drawImage(prev.canvas, x - stride, 0);
      current.clearRect(0, 0, ov, height);
      spare = prev;
    }
    prev = current;
    current = spare;
    await step();
  }
  if (prev) ctx.drawImage(prev.canvas, (count - 1) * stride, 0);
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  layout: PanoramaLayout,
  caption: { title: string; details: string },
): void {
  const { width, height, captionHeight } = layout;
  const k = height / 1080;
  ctx.save();
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(0, height, width, captionHeight);
  ctx.fillStyle = 'rgba(42, 47, 54, 0.18)';
  ctx.fillRect(0, height, width, Math.max(1, Math.round(k)));
  ctx.fillStyle = '#2a2f36';
  ctx.textBaseline = 'middle';
  const y = height + captionHeight / 2;
  const pad = 24 * k;
  ctx.font = `600 ${Math.round(22 * k)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(caption.title, pad, y);
  ctx.font = `${Math.round(17 * k)}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#5b636e';
  ctx.fillText(caption.details, width - pad, y);
  ctx.restore();
}
