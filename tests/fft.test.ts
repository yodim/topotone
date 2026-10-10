import { describe, expect, it } from 'vitest';
import { FFT, RealFFT, hann } from '../src/audio/fft';

function dft(x: number[]) {
  const n = x.length;
  return Array.from({ length: n }, (_, k) => {
    let re = 0;
    let im = 0;
    x.forEach((v, j) => {
      re += v * Math.cos((2 * Math.PI * k * j) / n);
      im -= v * Math.sin((2 * Math.PI * k * j) / n);
    });
    return [re, im] as const;
  });
}

describe('FFT', () => {
  it('matches a direct DFT', () => {
    const x = Array.from(
      { length: 64 },
      (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1) + (i % 5) / 10,
    );
    const re = Float64Array.from(x);
    const im = new Float64Array(64);
    new FFT(64).transform(re, im);
    dft(x).forEach(([r, i], k) => {
      expect(re[k]).toBeCloseTo(r, 9);
      expect(im[k]).toBeCloseTo(i, 9);
    });
  });

  it('puts a pure tone in its bin', () => {
    const n = 1024;
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 37 * i) / n));
    const im = new Float64Array(n);
    new FFT(n).transform(re, im);
    const mags = Array.from(re, (r, k) => Math.hypot(r, im[k] ?? 0));
    expect(mags.indexOf(Math.max(...mags.slice(0, n / 2)))).toBe(37);
    expect(mags[37]).toBeCloseTo(n / 2, 6);
  });

  it('keeps the energy (Parseval)', () => {
    const n = 256;
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) * Math.cos(i * 0.011));
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    new FFT(n).transform(re, im);
    const time = x.reduce((s, v) => s + v * v, 0);
    const freq = re.reduce((s, r, k) => s + r * r + (im[k] ?? 0) ** 2, 0) / n;
    expect(freq).toBeCloseTo(time, 9);
  });

  it('rejects sizes that are not powers of two', () => {
    expect(() => new FFT(100)).toThrow();
    expect(() => new RealFFT(2)).toThrow();
  });
});

describe('RealFFT', () => {
  it('matches the complex FFT on real input', () => {
    const n = 512;
    const x = Float64Array.from(
      { length: n },
      (_, i) => Math.sin(i * 0.3) + 0.5 * Math.sin(i * 1.9) + 0.1,
    );
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    new FFT(n).transform(re, im);
    const outRe = new Float64Array(n / 2 + 1);
    const outIm = new Float64Array(n / 2 + 1);
    new RealFFT(n).transform(x, outRe, outIm);
    for (let k = 0; k <= n / 2; k++) {
      expect(outRe[k]).toBeCloseTo(re[k] ?? 0, 8);
      expect(outIm[k]).toBeCloseTo(im[k] ?? 0, 8);
    }
  });
});

describe('hann', () => {
  it('starts at zero and peaks at one in the middle', () => {
    const w = hann(8);
    expect(w[0]).toBe(0);
    expect(w[4]).toBeCloseTo(1, 12);
    expect(w[2]).toBeCloseTo(w[6] ?? 0, 12);
  });
});
