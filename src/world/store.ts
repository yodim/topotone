/**
 * Holds generated chunks per layer. Chunks are frozen once made, so the store only ever
 * adds and evicts. Evicting is always safe: a chunk can be regenerated identically.
 */
import type { LayerChunk } from './scene';

export class ChunkStore {
  private readonly layers: Map<number, LayerChunk>[];

  constructor(layerCount: number) {
    this.layers = Array.from({ length: layerCount }, () => new Map<number, LayerChunk>());
  }

  get(layer: number, index: number, make: () => LayerChunk): LayerChunk {
    const chunks = this.layers[layer];
    if (!chunks) throw new Error(`No layer ${layer}`);
    let chunk = chunks.get(index);
    if (!chunk) {
      chunk = make();
      chunks.set(index, chunk);
    }
    return chunk;
  }

  /** The chunk if it was already built, without building it. */
  peek(layer: number, index: number): LayerChunk | undefined {
    return this.layers[layer]?.get(index);
  }

  /** Drops chunks of this layer outside [from, to]. */
  retain(layer: number, from: number, to: number): void {
    const chunks = this.layers[layer];
    if (!chunks) return;
    for (const index of chunks.keys()) {
      if (index < from || index > to) chunks.delete(index);
    }
  }

  clear(): void {
    for (const chunks of this.layers) chunks.clear();
  }

  get size(): number {
    return this.layers.reduce((n, m) => n + m.size, 0);
  }
}
