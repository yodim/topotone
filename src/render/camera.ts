/**
 * Projection from music time to the screen.
 *
 * x = playheadX + (t - now) * pxPerSecond * parallax(depth)
 *
 * Each layer also gets a vertical band: ridge height 0 sits at `base`, height 1 at
 * `base - range`, and `headroom` leaves space above for trees and birds. All three are
 * fractions of the view height.
 */
import type { Surface } from './engine';
import { CHUNK_SECONDS, type LayerRole, type LayerSpec } from '../world/scene';

/** Ground layer speed in CSS pixels per second of music, for a 1080 px tall view. */
export const BASE_PX_PER_SECOND = 64;
/** Speed of the horizon relative to the foreground. */
export const PARALLAX_HORIZON = 0.15;
/** Reference view height for ChunkEnv.scale. */
export const REFERENCE_HEIGHT = 1080;
/** Extra pixels drawn on each side of a chunk, before clipping, at scale 1. */
export const BLEED_PX = 32;

export function parallax(depth: number): number {
  return PARALLAX_HORIZON + (1 - PARALLAX_HORIZON) * depth;
}

export function viewScale(heightCss: number): number {
  return heightCss / REFERENCE_HEIGHT;
}

interface LayerFrame {
  base: number;
  range: number;
  headroom: number;
}

export const LAYER_FRAMES: Record<LayerRole, LayerFrame> = {
  'far-range': { base: 0.6, range: 0.4, headroom: 0.04 },
  'mid-range': { base: 0.7, range: 0.32, headroom: 0.12 },
  hills: { base: 0.83, range: 0.26, headroom: 0.08 },
  ground: { base: 0.95, range: 0.16, headroom: 0.12 },
};

export interface LayerProjection {
  /** Width of one chunk in device pixels. Always a whole number, so chunks tile exactly. */
  chunkPx: number;
  /** Effective speed of this layer in CSS pixels per second, consistent with chunkPx. */
  pxPerSecond: number;
  /** Bleed on each side, in device pixels and in CSS pixels. */
  bleedPx: number;
  bleed: number;
  /** Top of this layer's canvas, in device pixels and in CSS pixels. */
  topPx: number;
  top: number;
  /** Height of this layer's canvas, in device pixels and in CSS pixels. */
  heightPx: number;
  height: number;
  /** Ridge height 0..1 to y in the layer canvas, in CSS pixels. */
  toY(h: number): number;
}

export function projectLayer(spec: LayerSpec, surface: Surface): LayerProjection {
  const { dpr, cssHeight } = surface;
  const scale = viewScale(cssHeight);
  const ideal = BASE_PX_PER_SECOND * scale * parallax(spec.depth);
  const chunkPx = Math.max(1, Math.round(CHUNK_SECONDS * ideal * dpr));
  return frameLayer(spec, cssHeight, dpr, chunkPx);
}

/**
 * The panorama export: every layer moves at the same speed, so each column of the image is
 * one moment of the music in every layer. chunkPx is the same for all layers.
 */
export function projectPanoramaLayer(
  spec: LayerSpec,
  height: number,
  chunkPx: number,
): LayerProjection {
  return frameLayer(spec, height, 1, chunkPx);
}

/** A layer's projection for a view of this height, given how wide a chunk is. */
function frameLayer(
  spec: LayerSpec,
  cssHeight: number,
  dpr: number,
  chunkPx: number,
): LayerProjection {
  const scale = viewScale(cssHeight);
  const pxPerSecond = chunkPx / dpr / CHUNK_SECONDS;
  const bleedPx = Math.min(Math.round(BLEED_PX * scale * dpr), chunkPx);
  const frame = LAYER_FRAMES[spec.role];
  const fullPx = Math.max(1, Math.round(cssHeight * dpr));
  const topPx = Math.max(
    0,
    Math.floor((frame.base - frame.range - frame.headroom) * cssHeight * dpr),
  );
  const heightPx = Math.max(1, fullPx - topPx);
  const top = topPx / dpr;
  return {
    chunkPx,
    pxPerSecond,
    bleedPx,
    bleed: bleedPx / dpr,
    topPx,
    top,
    heightPx,
    height: heightPx / dpr,
    toY: (h) => (frame.base - h * frame.range) * cssHeight - top,
  };
}

/** Screen x of music time t on a layer. */
export function screenX(t: number, now: number, playheadX: number, pxPerSecond: number): number {
  return playheadX + (t - now) * pxPerSecond;
}

/** Music time shown at screen x on a layer. */
export function timeAtX(x: number, now: number, playheadX: number, pxPerSecond: number): number {
  return now + (x - playheadX) / pxPerSecond;
}
