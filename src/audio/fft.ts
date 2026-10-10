/**
 * Radix-2 FFT and window functions. Small and allocation-free once constructed, because
 * a four minute track runs it about 20,000 times.
 */

export class FFT {
  readonly size: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly reversed: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.size = size;
    const half = size / 2;
    this.cos = new Float64Array(half);
    this.sin = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size);
    }
    this.reversed = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >>> b) & 1) << (bits - 1 - b);
      this.reversed[i] = r;
    }
  }

  /** In-place forward transform of (re, im). */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    const rev = this.reversed;
    const cos = this.cos;
    const sin = this.sin;
    for (let i = 0; i < n; i++) {
      const j = rev[i] as number;
      if (j > i) {
        const tr = re[i] as number;
        re[i] = re[j] as number;
        re[j] = tr;
        const ti = im[i] as number;
        im[i] = im[j] as number;
        im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >>> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0, w = 0; k < half; k++, w += step) {
          const wr = cos[w] as number;
          const wi = sin[w] as number;
          const a = start + k;
          const b = a + half;
          const br = re[b] as number;
          const bi = im[b] as number;
          const xr = br * wr - bi * wi;
          const xi = br * wi + bi * wr;
          const ar = re[a] as number;
          const ai = im[a] as number;
          re[b] = ar - xr;
          im[b] = ai - xi;
          re[a] = ar + xr;
          im[a] = ai + xi;
        }
      }
    }
  }
}

/**
 * FFT of a real signal, through a complex FFT of half the size: even samples go in the
 * real part, odd samples in the imaginary part, and the halves are separated afterwards.
 * About twice as fast as a full complex transform.
 */
export class RealFFT {
  readonly size: number;
  private readonly half: FFT;
  private readonly zr: Float64Array;
  private readonly zi: Float64Array;
  private readonly wr: Float64Array;
  private readonly wi: Float64Array;

  constructor(size: number) {
    if (size < 4 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.size = size;
    const h = size / 2;
    this.half = new FFT(h);
    this.zr = new Float64Array(h);
    this.zi = new Float64Array(h);
    this.wr = new Float64Array(h + 1);
    this.wi = new Float64Array(h + 1);
    for (let k = 0; k <= h; k++) {
      this.wr[k] = Math.cos((2 * Math.PI * k) / size);
      this.wi[k] = -Math.sin((2 * Math.PI * k) / size);
    }
  }

  /** Spectrum bins 0..size/2 of a real input of length size. */
  transform(input: ArrayLike<number>, outRe: Float64Array, outIm: Float64Array): void {
    const h = this.size / 2;
    const zr = this.zr;
    const zi = this.zi;
    for (let i = 0; i < h; i++) {
      zr[i] = input[2 * i] as number;
      zi[i] = input[2 * i + 1] as number;
    }
    this.half.transform(zr, zi);
    for (let k = 0; k <= h; k++) {
      const a = k === h ? 0 : k;
      const m = k === 0 ? 0 : h - k;
      const zrk = zr[a] as number;
      const zik = zi[a] as number;
      const zrm = zr[m] as number;
      const zim = zi[m] as number;
      const er = (zrk + zrm) / 2;
      const ei = (zik - zim) / 2;
      const or = (zik + zim) / 2;
      const oi = -(zrk - zrm) / 2;
      const wr = this.wr[k] as number;
      const wi = this.wi[k] as number;
      outRe[k] = er + or * wr - oi * wi;
      outIm[k] = ei + or * wi + oi * wr;
    }
  }
}

/** Hann window of the given length (periodic form, as used for spectral analysis). */
export function hann(length: number): Float64Array {
  const w = new Float64Array(length);
  for (let i = 0; i < length; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
  return w;
}
