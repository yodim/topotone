import { describe, expect, it } from 'vitest';
import { encodeGif, lzwEncode } from '../scripts/gif.ts';

/** GIF's LZW, decoded the plain way, to check the encoder against. */
function lzwDecode(data: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let dict: number[][] = [];
  const resetDict = () => {
    dict = Array.from({ length: clear }, (_, i) => [i]);
    dict.push([], []);
  };
  resetDict();
  let codeSize = minCodeSize + 1;
  let pos = 0;
  const read = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++, pos++) {
      code |= (((data[pos >> 3] as number) >> (pos & 7)) & 1) << i;
    }
    return code;
  };
  const out: number[] = [];
  let prev: number[] | null = null;
  for (;;) {
    const code = read();
    if (code === clear) {
      resetDict();
      codeSize = minCodeSize + 1;
      prev = null;
      continue;
    }
    if (code === end) break;
    let entry = dict[code];
    if (!entry) {
      if (!prev || code !== dict.length) throw new Error(`bad code ${code}`);
      entry = [...prev, prev[0] as number];
    }
    out.push(...entry);
    if (prev) {
      dict.push([...prev, entry[0] as number]);
      if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return out;
}

describe('lzwEncode', () => {
  it('round-trips short and long runs, through dictionary resets', () => {
    let state = 7;
    const noise = Uint8Array.from({ length: 60_000 }, () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state % 200;
    });
    const runs = Uint8Array.from({ length: 30_000 }, (_, i) => Math.floor(i / 97) % 7);
    for (const input of [new Uint8Array([3]), new Uint8Array([1, 1, 1, 1]), runs, noise]) {
      expect(lzwDecode(lzwEncode(input, 8), 8)).toEqual([...input]);
    }
  });
});

describe('encodeGif', () => {
  const frame = (color: [number, number, number], w: number, h: number) => {
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([...color, 255], i * 4);
    return rgba;
  };

  it('writes a looping GIF89a with one palette and every frame', () => {
    const a = frame([200, 40, 40], 8, 4);
    const b = frame([200, 40, 40], 8, 4);
    b.set([20, 60, 220, 255], (2 * 8 + 5) * 4); // one pixel changes
    const gif = encodeGif(8, 4, [
      { rgba: a, delayCs: 8 },
      { rgba: b, delayCs: 8 },
      { rgba: b, delayCs: 8 },
    ]);
    expect(new TextDecoder().decode(gif.subarray(0, 6))).toBe('GIF89a');
    expect(gif[6]).toBe(8);
    expect(gif[8]).toBe(4);
    expect(new TextDecoder().decode(gif)).toContain('NETSCAPE2.0');
    expect(gif[gif.length - 1]).toBe(0x3b);
    // Walk the blocks: three frames, the later ones covering just what changed.
    const frames: { x: number; y: number; w: number; h: number; pixels: number[] }[] = [];
    let i = 13 + 768;
    const subBlocks = () => {
      const bytes: number[] = [];
      while (gif[i] !== 0) {
        const n = gif[i] as number;
        bytes.push(...gif.subarray(i + 1, i + 1 + n));
        i += n + 1;
      }
      i++;
      return new Uint8Array(bytes);
    };
    const u16 = (at: number) => (gif[at] as number) | ((gif[at + 1] as number) << 8);
    while (gif[i] !== 0x3b) {
      if (gif[i] === 0x21) {
        i += 2;
        subBlocks();
      } else if (gif[i] === 0x2c) {
        const [x, y, w, h] = [u16(i + 1), u16(i + 3), u16(i + 5), u16(i + 7)];
        const minCodeSize = gif[i + 10] as number;
        i += 11;
        frames.push({ x, y, w, h, pixels: lzwDecode(subBlocks(), minCodeSize) });
      } else {
        throw new Error(`unexpected block ${gif[i]} at ${i}`);
      }
    }
    expect(frames.map(({ x, y, w, h }) => [x, y, w, h])).toEqual([
      [0, 0, 8, 4],
      [5, 2, 1, 1],
      [0, 0, 1, 1],
    ]);
    // The first frame is one color; the second changes one pixel; the third is transparent.
    const first = frames[0]?.pixels ?? [];
    expect(new Set(first).size).toBe(1);
    const changed = frames[1]?.pixels[0];
    expect(changed).not.toBe(first[0]);
    expect(changed).not.toBe(255);
    expect(frames[2]?.pixels).toEqual([255]);
    // And the palette holds both colors near enough.
    const color = (index: number) => [...gif.subarray(13 + index * 3, 16 + index * 3)];
    const close = (a: number[], b: number[]) => a.every((v, k) => Math.abs(v - (b[k] ?? 0)) <= 4);
    expect(close(color(first[0] as number), [200, 40, 40])).toBe(true);
    expect(close(color(changed as number), [20, 60, 220])).toBe(true);
  });
});
