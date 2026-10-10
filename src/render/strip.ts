/**
 * One canvas per layer holding the visible run of chunks side by side.
 *
 * Chunks are rendered once into their slot and kept until they scroll out. The whole strip
 * is then composited with a single drawImage at a fractional offset: smooth scrolling, and
 * no hairline seams between chunks (which separate drawImage calls at fractional positions
 * would leave).
 */

export type RenderSlot = (ctx: CanvasRenderingContext2D, index: number, x: number) => void;

export class LayerStrip {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly filled: Uint8Array;
  private first = 0;
  private empty = true;

  constructor(
    readonly slots: number,
    readonly chunkPx: number,
    readonly heightPx: number,
    /** Shared scratch canvas used while shifting, at least as large as this strip. */
    private readonly scratch: CanvasRenderingContext2D,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = slots * chunkPx;
    this.canvas.height = heightPx;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.filled = new Uint8Array(slots);
  }

  /** Index of the chunk in the leftmost slot. */
  get firstIndex(): number {
    return this.first;
  }

  /** Makes sure chunks first..last are in the strip, rendering the missing ones. */
  ensure(first: number, last: number, render: RenderSlot): number {
    if (last - first + 1 > this.slots) throw new Error('strip too small for the view');
    if (this.empty || first !== this.first) this.shiftTo(first);
    let rendered = 0;
    for (let i = 0; i <= last - first; i++) {
      if (this.filled[i]) continue;
      const x = i * this.chunkPx;
      this.ctx.clearRect(x, 0, this.chunkPx, this.heightPx);
      render(this.ctx, first + i, x);
      this.filled[i] = 1;
      rendered++;
    }
    return rendered;
  }

  /** Forgets every chunk, for example after a style change. */
  invalidate(): void {
    this.empty = true;
  }

  private shiftTo(first: number): void {
    const shift = this.empty ? this.slots : first - this.first;
    this.first = first;
    this.empty = false;
    const w = this.canvas.width;
    const h = this.heightPx;
    if (Math.abs(shift) >= this.slots) {
      this.ctx.clearRect(0, 0, w, h);
      this.filled.fill(0);
      return;
    }
    const dx = -shift * this.chunkPx;
    // Copy through the scratch canvas: drawing a canvas onto itself would blend old pixels.
    this.scratch.clearRect(0, 0, w, h);
    this.scratch.drawImage(this.canvas, 0, 0, w, h, 0, 0, w, h);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.drawImage(this.scratch.canvas, 0, 0, w, h, dx, 0, w, h);
    if (shift > 0) {
      this.filled.copyWithin(0, shift);
      this.filled.fill(0, this.slots - shift);
    } else {
      this.filled.copyWithin(-shift, 0, this.slots + shift);
      this.filled.fill(0, 0, -shift);
    }
  }
}
