/**
 * The style contract. Styles only draw: they receive scene data and a seeded rng,
 * and paint to a canvas. They never touch generation.
 *
 * Every ctx handed to a style is already scaled by the device pixel ratio,
 * so styles draw in CSS pixels.
 *
 * Change this file only deliberately. Record any change in PLAN.md.
 */
import type { Rng } from '../core/rng';
import type { LayerChunk, SkyState } from '../world/scene';

/** Given once, when the style is selected. */
export interface StyleEnv {
  /** World seed, for textures and palettes that should vary per world. */
  seed: number;
  /** Device pixel ratio, capped at 2. */
  dpr: number;
}

/** The current frame, for the per-frame hooks. */
export interface View {
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
  /** Device pixel ratio, capped at 2. */
  dpr: number;
  /** Music time at the playhead, in seconds. */
  now: number;
  /**
   * Animation time in seconds, provided by the engine. Use it for drifting mist or shimmer.
   * Styles never read the clock themselves.
   */
  clock: number;
}

export interface ChunkEnv {
  /**
   * Seeded for this chunk, for the ridge, water and texture. The only randomness allowed
   * besides object seeds.
   *
   * Per-object detail (a tree's branches, a rock's outline) must come from
   * createRng(object.seed), never from this rng. Under live input a chunk is redrawn as new
   * objects arrive; drawing from a shared sequence would change the objects already on screen.
   */
  rng: Rng;
  /** Sky at the chunk start, for palette decisions. */
  sky: SkyState;
  /**
   * Neighboring chunks of the same layer, for ridge values inside the bleed and for
   * objects that overhang the edges. The engine always provides both: chunks are
   * deterministic, so a missing neighbor is regenerated on demand.
   */
  neighbors: { prev: LayerChunk; next: LayerChunk };
  /** Chunk canvas size in CSS pixels, including bleed. */
  width: number;
  height: number;
  /** Extra pixels on each side, clipped away by the engine. */
  bleed: number;
  /**
   * Size multiplier: 1 for a 1080 px tall view. Multiply stroke widths and object sizes
   * by it, so the panorama export at another height matches the live view.
   */
  scale: number;
  /** Music time to chunk-local x. */
  toX(t: number): number;
  /** Ridge height 0..1 to y for this layer. */
  toY(h: number): number;
}

export interface Style {
  /** Folder name, used in ?style=. */
  id: string;
  name: string;
  description: string;
  author: string;
  /** Once, when the style is selected: build textures and palettes. */
  setup?(env: StyleEnv): void | Promise<void>;
  /** Every frame. Keep it cheap. */
  drawSky(ctx: CanvasRenderingContext2D, sky: SkyState, view: View): void;
  /** Once per layer chunk. The engine caches the result and clips it to the chunk bounds. */
  drawLayerChunk(ctx: CanvasRenderingContext2D, chunk: LayerChunk, env: ChunkEnv): void;
  /** Optional, every frame, after each layer: haze or mist between depths. */
  drawAtmosphere?(ctx: CanvasRenderingContext2D, depth: number, sky: SkyState, view: View): void;
  /** Optional, every frame, on top of everything: grain, drifting mist, shimmer. */
  drawOverlay?(ctx: CanvasRenderingContext2D, view: View): void;
}
