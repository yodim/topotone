/**
 * Drawing one layer chunk with its bleed into a scratch canvas. The live renderer and the
 * panorama export both go through here, so a chunk comes out the same in both.
 */
import { createRng, hashSeed } from '../core/rng';
import type { ChunkEnv, Style } from '../styles/types';
import type { World } from '../world/generator';
import { chunkStart } from '../world/scene';
import type { LayerProjection } from './camera';

/**
 * Clears the scratch canvas and draws chunk `index` of `layer` into it, bleed included:
 * the chunk itself starts at p.bleedPx. The scratch must be at least
 * p.chunkPx + 2 * p.bleedPx wide and p.heightPx tall.
 */
export function paintChunk(
  scratch: CanvasRenderingContext2D,
  style: Style,
  world: World,
  layer: number,
  index: number,
  p: LayerProjection,
  scale: number,
  dpr: number,
): void {
  const chunk = world.chunk(layer, index);
  const start = chunkStart(index);
  const widthPx = p.chunkPx + 2 * p.bleedPx;
  const env: ChunkEnv = {
    rng: createRng(hashSeed(chunk.seed, style.id)),
    sky: world.skyAt(start),
    neighbors: { prev: world.chunk(layer, index - 1), next: world.chunk(layer, index + 1) },
    width: widthPx / dpr,
    height: p.height,
    bleed: p.bleed,
    scale,
    pxPerSecond: p.pxPerSecond,
    toX: (t) => p.bleed + (t - start) * p.pxPerSecond,
    toY: p.toY,
  };
  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.clearRect(0, 0, widthPx, p.heightPx);
  scratch.save();
  scratch.setTransform(dpr, 0, 0, dpr, 0, 0);
  style.drawLayerChunk(scratch, chunk, env);
  scratch.restore();
}
