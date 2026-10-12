/**
 * A small GIF encoder for the README animation. Written here rather than added as a
 * dependency, like the FFT and the noise.
 *
 * One palette serves the whole animation (median cut over samples of every frame). Each frame
 * after the first stores only the pixels that changed since the one before, inside their
 * bounding box; the rest is transparent, so a still sky costs almost nothing. Pixel data is
 * compressed with the variable-length LZW that GIF uses.
 */

export interface GifFrame {
  /** RGBA pixels, width * height * 4 bytes. Alpha is ignored. */
  rgba: Uint8Array | Uint8ClampedArray;
  /** How long the frame shows, in hundredths of a second. */
  delayCs: number;
}

/** Palette index kept free for "unchanged since the last frame". */
const TRANSPARENT = 255;
const COLORS = 255;

export function encodeGif(width: number, height: number, frames: GifFrame[]): Uint8Array {
  if (frames.length === 0) throw new Error('No frames to encode');
  const palette = medianCut(frames, COLORS);
  const lookup = new PaletteLookup(palette);
  const out = new Bytes();

  out.text('GIF89a');
  out.u16(width);
  out.u16(height);
  // Global color table of 256 entries, 8 bits per channel.
  out.byte(0xf7);
  out.byte(0); // background color
  out.byte(0); // pixel aspect ratio
  for (let i = 0; i < 256; i++) {
    const c = palette[i] ?? [0, 0, 0];
    out.byte(c[0]);
    out.byte(c[1]);
    out.byte(c[2]);
  }
  // Loop forever.
  out.bytes([0x21, 0xff, 0x0b]);
  out.text('NETSCAPE2.0');
  out.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);

  let previous: Uint8Array | null = null;
  for (const frame of frames) {
    const indexed = lookup.indexFrame(frame.rgba, width * height);
    const box = previous ? changedBox(previous, indexed, width, height) : full(width, height);
    // Nothing changed: a one pixel transparent frame keeps the timing.
    const area = box ?? { x: 0, y: 0, w: 1, h: 1 };
    const pixels = new Uint8Array(area.w * area.h);
    for (let y = 0; y < area.h; y++) {
      for (let x = 0; x < area.w; x++) {
        const i = (area.y + y) * width + area.x + x;
        const v = indexed[i] as number;
        pixels[y * area.w + x] = previous && (!box || previous[i] === v) ? TRANSPARENT : v;
      }
    }
    // Graphic control: leave the frame in place, transparent index, delay.
    out.bytes([0x21, 0xf9, 0x04, 0x05]);
    out.u16(Math.max(1, Math.round(frame.delayCs)));
    out.bytes([TRANSPARENT, 0x00]);
    // Image descriptor, no local color table.
    out.byte(0x2c);
    out.u16(area.x);
    out.u16(area.y);
    out.u16(area.w);
    out.u16(area.h);
    out.byte(0);
    out.byte(8); // LZW minimum code size
    const data = lzwEncode(pixels, 8);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.subarray(i, i + 255);
      out.byte(block.length);
      out.bytes(block);
    }
    out.byte(0);
    previous = indexed;
  }
  out.byte(0x3b);
  return out.done();
}

type Rgb = [number, number, number];

/** Median cut: split the most spread out box of sampled colors until there are `count`. */
export function medianCut(frames: GifFrame[], count: number): Rgb[] {
  const total = frames.reduce((n, f) => n + f.rgba.length / 4, 0);
  const step = Math.max(1, Math.floor(total / 300_000));
  const samples: number[] = [];
  let k = 0;
  for (const f of frames) {
    for (let i = 0; i < f.rgba.length; i += 4) {
      if (k++ % step !== 0) continue;
      samples.push(
        ((f.rgba[i] as number) << 16) |
          ((f.rgba[i + 1] as number) << 8) |
          (f.rgba[i + 2] as number),
      );
    }
  }
  const channel = (c: number, ch: number) => (c >> (16 - 8 * ch)) & 255;
  interface Box {
    colors: number[];
    channel: number;
    spread: number;
  }
  const measure = (colors: number[]): Box => {
    let best = 0;
    let spread = -1;
    for (let ch = 0; ch < 3; ch++) {
      let lo = 255;
      let hi = 0;
      for (const c of colors) {
        const v = channel(c, ch);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > spread) {
        spread = hi - lo;
        best = ch;
      }
    }
    return { colors, channel: best, spread };
  };
  const boxes: Box[] = [measure(samples)];
  while (boxes.length < count) {
    // Weigh spread by population, so busy regions of color space get more entries.
    let pick = -1;
    let score = 0;
    boxes.forEach((b, i) => {
      const s = b.spread * Math.sqrt(b.colors.length);
      if (b.colors.length > 1 && b.spread > 0 && s > score) {
        score = s;
        pick = i;
      }
    });
    if (pick < 0) break;
    const box = boxes[pick] as Box;
    const sorted = box.colors.sort((a, b) => channel(a, box.channel) - channel(b, box.channel));
    const mid = sorted.length >> 1;
    boxes.splice(pick, 1, measure(sorted.slice(0, mid)), measure(sorted.slice(mid)));
  }
  return boxes.map((b) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (const c of b.colors) {
      r += channel(c, 0);
      g += channel(c, 1);
      bl += channel(c, 2);
    }
    const n = Math.max(1, b.colors.length);
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)] as Rgb;
  });
}

/** Nearest palette entry for a color, cached on 6 bits per channel. */
class PaletteLookup {
  private readonly cache = new Int16Array(1 << 18).fill(-1);
  // A plain field: Node runs this file with type stripping, which has no parameter properties.
  private readonly palette: Rgb[];

  constructor(palette: Rgb[]) {
    this.palette = palette;
  }

  nearest(r: number, g: number, b: number): number {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const hit = this.cache[key] as number;
    if (hit >= 0) return hit;
    // Search with the bucket's centre, so every color in it maps the same way.
    const cr = (r & ~3) + 2;
    const cg = (g & ~3) + 2;
    const cb = (b & ~3) + 2;
    let best = 0;
    let dist = Infinity;
    this.palette.forEach(([pr, pg, pb], i) => {
      // Weighted for the eye: green matters most, blue least.
      const d = 2 * (pr - cr) ** 2 + 4 * (pg - cg) ** 2 + 3 * (pb - cb) ** 2;
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    this.cache[key] = best;
    return best;
  }

  indexFrame(rgba: Uint8Array | Uint8ClampedArray, pixels: number): Uint8Array {
    const out = new Uint8Array(pixels);
    for (let i = 0; i < pixels; i++) {
      out[i] = this.nearest(
        rgba[i * 4] as number,
        rgba[i * 4 + 1] as number,
        rgba[i * 4 + 2] as number,
      );
    }
    return out;
  }
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function full(width: number, height: number): Box {
  return { x: 0, y: 0, w: width, h: height };
}

/** The smallest box holding every pixel that changed, or null when none did. */
function changedBox(a: Uint8Array, b: Uint8Array, width: number, height: number): Box | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (a[i] === b[i]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** GIF's LZW: variable code size from minCodeSize + 1 up to 12 bits, packed LSB first. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const table = new Int16Array(4096 << 8);
  const out = new Bytes();
  let bits = 0;
  let pending = 0;
  let codeSize = minCodeSize + 1;
  let next = end + 1;
  const emit = (code: number) => {
    pending |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.byte(pending & 255);
      pending >>>= 8;
      bits -= 8;
    }
  };
  const reset = () => {
    table.fill(0);
    codeSize = minCodeSize + 1;
    next = end + 1;
  };

  emit(clear);
  if (indices.length === 0) {
    emit(end);
    if (bits > 0) out.byte(pending & 255);
    return out.done();
  }
  let prefix = indices[0] as number;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i] as number;
    const key = (prefix << 8) | k;
    const code = table[key] as number;
    if (code > 0) {
      prefix = code;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      reset();
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table[key] = next++;
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (bits > 0) out.byte(pending & 255);
  return out.done();
}

/** A growing byte buffer. */
class Bytes {
  private buf = new Uint8Array(1 << 16);
  private length = 0;

  byte(v: number): void {
    if (this.length === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = v;
  }

  bytes(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.byte(values[i] as number);
  }

  u16(v: number): void {
    this.byte(v & 255);
    this.byte((v >> 8) & 255);
  }

  text(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}
