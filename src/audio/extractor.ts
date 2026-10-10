/**
 * Pure feature extraction over audio samples. No Web Audio here: the same code runs in the
 * analysis worker (song files), on live mic buffers, and in the unit tests.
 *
 * Frames are 2048 samples centred on their time, one every 512 samples. Values come out
 * raw (linear powers, flux sums, pitch in Hz). normalize.ts turns them into FeatureFrames.
 */
import { FFT, RealFFT, hann } from './fft';

export const FRAME_SIZE = 2048;
export const HOP_SIZE = 512;

/** Lower edge of the mid band and of the high band, in Hz. */
export const BAND_EDGES = [250, 2000] as const;

/** The log-frequency scale shared by centroid and pitch: 40 Hz is 0, 16 kHz is 1. */
const LOG_MIN_HZ = 40;
const LOG_MAX_HZ = 16000;

export function logFreq01(hz: number): number {
  if (!(hz > 0)) return 0;
  const v = Math.log2(hz / LOG_MIN_HZ) / Math.log2(LOG_MAX_HZ / LOG_MIN_HZ);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Pitch search range and the analysis rate it runs at. */
const PITCH_MIN_HZ = 80;
const PITCH_MAX_HZ = 1000;
const PITCH_RATE = 11025;
const YIN_THRESHOLD = 0.15;
/** Pitch runs on every second frame and holds in between: still about 43 estimates a second. */
const PITCH_EVERY = 2;

export interface RawFrame {
  t: number;
  /** Root mean square of the samples, linear. */
  rms: number;
  /** Spectral power per band, linear. */
  low: number;
  mid: number;
  high: number;
  /** Spectral centroid on the shared log-frequency scale, 0..1. */
  centroid: number;
  /**
   * Positive change of the log spectrum against the recent past, as a mean per bin,
   * over the whole spectrum and per band.
   */
  flux: number;
  fluxLow: number;
  fluxMid: number;
  fluxHigh: number;
  /** Fundamental frequency in Hz, or null when there is none worth trusting. */
  pitchHz: number | null;
  pitchConfidence: number;
}

/**
 * Analyzes one frame at a time and remembers the previous spectrum for the flux.
 * Feed frames in time order.
 */
export class FrameAnalyzer {
  private readonly fft = new RealFFT(FRAME_SIZE);
  private readonly window = hann(FRAME_SIZE);
  private readonly windowed = new Float64Array(FRAME_SIZE);
  private readonly re = new Float64Array(FRAME_SIZE / 2 + 1);
  private readonly im = new Float64Array(FRAME_SIZE / 2 + 1);
  private readonly bins = FRAME_SIZE / 2 + 1;
  private readonly logMag = new Float64Array(FRAME_SIZE / 2 + 1);
  // The two previous log spectra. Flux compares against the maximum of neighboring bins
  // over both (the SuperFlux idea), so phase wobble in steady low notes does not count.
  private prev1 = new Float64Array(FRAME_SIZE / 2 + 1);
  private prev2 = new Float64Array(FRAME_SIZE / 2 + 1);
  private readonly recent = new Float64Array(FRAME_SIZE / 2 + 1);
  private seen = 0;
  private readonly lowBin: number;
  private readonly midBin: number;
  private readonly binHz: number;
  private readonly magScale: number;

  // Pitch: the frame is box-filtered down to about PITCH_RATE before YIN runs.
  private readonly decimation: number;
  private readonly pitchRate: number;
  private readonly small: Float64Array;
  private readonly diff: Float64Array;
  // Buffers for the FFT-based autocorrelation used by YIN.
  private readonly corrFft: RealFFT;
  private readonly corrInverse: FFT;
  private readonly head: Float64Array;
  private readonly aRe: Float64Array;
  private readonly aIm: Float64Array;
  private readonly bRe: Float64Array;
  private readonly bIm: Float64Array;
  private readonly zRe: Float64Array;
  private readonly zIm: Float64Array;
  private readonly energy: Float64Array;
  private readonly tauMin: number;
  private readonly tauMax: number;
  private lastPitch: { hz: number | null; confidence: number } = { hz: null, confidence: 0 };

  constructor(readonly sampleRate: number) {
    this.binHz = sampleRate / FRAME_SIZE;
    this.lowBin = Math.round(BAND_EDGES[0] / this.binHz);
    this.midBin = Math.round(BAND_EDGES[1] / this.binHz);
    // A full-scale sine then has a magnitude of about 1.
    this.magScale = 2 / this.window.reduce((s, w) => s + w, 0);

    this.decimation = Math.max(1, Math.round(sampleRate / PITCH_RATE));
    this.pitchRate = sampleRate / this.decimation;
    this.small = new Float64Array(Math.floor(FRAME_SIZE / this.decimation));
    this.tauMin = Math.max(2, Math.floor(this.pitchRate / PITCH_MAX_HZ));
    this.tauMax = Math.min(Math.ceil(this.pitchRate / PITCH_MIN_HZ), (this.small.length >> 1) - 1);
    this.diff = new Float64Array(this.tauMax + 2);
    const p = this.small.length;
    this.corrFft = new RealFFT(p);
    this.corrInverse = new FFT(p);
    this.head = new Float64Array(p);
    this.aRe = new Float64Array(p / 2 + 1);
    this.aIm = new Float64Array(p / 2 + 1);
    this.bRe = new Float64Array(p / 2 + 1);
    this.bIm = new Float64Array(p / 2 + 1);
    this.zRe = new Float64Array(p);
    this.zIm = new Float64Array(p);
    this.energy = new Float64Array(p + 1);
  }

  /** frame holds FRAME_SIZE samples centred on time t. */
  analyze(frame: Float32Array, t: number): RawFrame {
    const n = FRAME_SIZE;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const x = frame[i] ?? 0;
      sq += x * x;
      this.windowed[i] = x * (this.window[i] as number);
    }
    const rms = Math.sqrt(sq / n);
    this.fft.transform(this.windowed, this.re, this.im);

    let low = 0;
    let mid = 0;
    let high = 0;
    let weighted = 0;
    let total = 0;
    let flux = 0;
    let fluxLow = 0;
    let fluxMid = 0;
    let fluxHigh = 0;
    const re = this.re;
    const im = this.im;
    const logMag = this.logMag;
    const bins = this.bins;
    for (let k = 1; k < bins; k++) {
      const r = re[k] as number;
      const i = im[k] as number;
      const power = r * r + i * i;
      const mag = Math.sqrt(power) * this.magScale;
      if (k < this.lowBin) low += power;
      else if (k < this.midBin) mid += power;
      else high += power;
      weighted += mag * k * this.binHz;
      total += mag;

      logMag[k] = Math.log(1 + 1000 * mag);
    }

    if (this.seen >= 2) {
      const a = this.prev1;
      const b = this.prev2;
      const m = this.recent;
      const last = bins - 1;
      for (let k = 1; k < bins; k++) {
        const x = a[k] as number;
        const y = b[k] as number;
        m[k] = x > y ? x : y;
      }
      for (let k = 1; k < bins; k++) {
        let ref = m[k] as number;
        if (k > 1 && (m[k - 1] as number) > ref) ref = m[k - 1] as number;
        if (k < last && (m[k + 1] as number) > ref) ref = m[k + 1] as number;
        const d = (logMag[k] as number) - ref;
        if (d > 0) {
          flux += d;
          if (k < this.lowBin) fluxLow += d;
          else if (k < this.midBin) fluxMid += d;
          else fluxHigh += d;
        }
      }
    }
    // Rotate: prev2 <- prev1 <- current.
    const spare = this.prev2;
    this.prev2 = this.prev1;
    this.prev1 = spare;
    this.prev1.set(this.logMag);
    this.seen++;

    const lowBins = this.lowBin - 1;
    const midBins = this.midBin - this.lowBin;
    const highBins = this.bins - this.midBin;
    flux /= this.bins - 1;
    fluxLow /= lowBins;
    fluxMid /= midBins;
    fluxHigh /= highBins;

    const centroid = total > 1e-6 ? logFreq01(weighted / total) : 0;
    if (rms <= 1e-4) this.lastPitch = { hz: null, confidence: 0 };
    else if (this.seen % PITCH_EVERY === 0) this.lastPitch = this.pitch(frame);
    const { hz, confidence } = this.lastPitch;
    return {
      t,
      rms,
      low,
      mid,
      high,
      centroid,
      flux,
      fluxLow,
      fluxMid,
      fluxHigh,
      pitchHz: hz,
      pitchConfidence: confidence,
    };
  }

  /** YIN (de Cheveigné and Kawahara, 2002) on the decimated frame. */
  private pitch(frame: Float32Array): { hz: number | null; confidence: number } {
    const m = this.decimation;
    const y = this.small;
    for (let j = 0; j < y.length; j++) {
      let s = 0;
      for (let q = 0; q < m; q++) s += frame[j * m + q] ?? 0;
      y[j] = s / m;
    }
    // Difference function d(tau) = sum over j < w of (y[j] - y[j + tau])^2, expanded as
    // e0 + e(tau) - 2 r(tau). The cross term r comes from an FFT correlation, the energy
    // terms from prefix sums. No wrap-around: w + tauMax stays below the FFT size.
    const p = y.length;
    const w = p - this.tauMax - 1;
    const head = this.head;
    head.fill(0);
    head.set(y.subarray(0, w));
    this.corrFft.transform(head, this.aRe, this.aIm);
    this.corrFft.transform(y, this.bRe, this.bIm);
    const zr = this.zRe;
    const zi = this.zIm;
    const half = p / 2;
    for (let k = 0; k <= half; k++) {
      // conj(A) * B, conjugated again: the inverse FFT runs as a forward one.
      const ar = this.aRe[k] as number;
      const ai = this.aIm[k] as number;
      const br = this.bRe[k] as number;
      const bi = this.bIm[k] as number;
      zr[k] = ar * br + ai * bi;
      zi[k] = -(ar * bi - ai * br);
      if (k > 0 && k < half) {
        zr[p - k] = zr[k] as number;
        zi[p - k] = -(zi[k] as number);
      }
    }
    this.corrInverse.transform(zr, zi);
    const e = this.energy;
    e[0] = 0;
    for (let j = 0; j < p; j++) e[j + 1] = (e[j] as number) + (y[j] as number) * (y[j] as number);
    const e0 = e[w] as number;

    const d = this.diff;
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= this.tauMax + 1; tau++) {
      const r = (zr[tau] as number) / p;
      const s = Math.max(0, e0 + ((e[tau + w] as number) - (e[tau] as number)) - 2 * r);
      running += s;
      // Cumulative mean normalized difference.
      d[tau] = running > 0 ? (s * tau) / running : 1;
    }

    let best = -1;
    for (let tau = this.tauMin; tau <= this.tauMax; tau++) {
      if ((d[tau] as number) < YIN_THRESHOLD) {
        while (tau + 1 <= this.tauMax && (d[tau + 1] as number) < (d[tau] as number)) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      best = this.tauMin;
      for (let tau = this.tauMin + 1; tau <= this.tauMax; tau++) {
        if ((d[tau] as number) < (d[best] as number)) best = tau;
      }
    }
    const confidence = Math.max(0, Math.min(1, 1 - (d[best] as number)));
    // Parabolic interpolation around the minimum for a finer period.
    const a = d[best - 1] as number;
    const b = d[best] as number;
    const c = d[best + 1] as number;
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const period = best + (Math.abs(shift) < 1 ? shift : 0);
    return { hz: confidence >= 0.5 ? this.pitchRate / period : null, confidence };
  }
}

/**
 * Analyzes a whole signal. Frame k is centred on sample k * HOP_SIZE, with zeros outside
 * the signal, so frame times start at 0.
 */
export function analyzeSamples(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): RawFrame[] {
  const analyzer = new FrameAnalyzer(sampleRate);
  const frame = new Float32Array(FRAME_SIZE);
  const count = Math.ceil(samples.length / HOP_SIZE);
  const out: RawFrame[] = [];
  for (let k = 0; k < count; k++) {
    const start = k * HOP_SIZE - FRAME_SIZE / 2;
    if (start >= 0 && start + FRAME_SIZE <= samples.length) {
      frame.set(samples.subarray(start, start + FRAME_SIZE));
    } else {
      frame.fill(0);
      for (let i = Math.max(0, -start); i < FRAME_SIZE && start + i < samples.length; i++) {
        frame[i] = samples[start + i] ?? 0;
      }
    }
    out.push(analyzer.analyze(frame, (k * HOP_SIZE) / sampleRate));
    if (onProgress && k % 512 === 0) onProgress(k / count);
  }
  onProgress?.(1);
  return out;
}

export interface OnsetOptions {
  /** Frames on each side used for the local median. */
  medianFrames: number;
  /** How far above the local median a peak must rise, on the normalized scale. */
  delta: number;
  /** Below this, a peak is never an onset. */
  floor: number;
  /** A peak must be the largest value within this many frames on each side. */
  peakFrames: number;
}

export const ONSET_DEFAULTS: OnsetOptions = {
  medianFrames: 22,
  delta: 0.08,
  floor: 0.12,
  peakFrames: 3,
};

/**
 * Adaptive peak picking over a normalized flux curve: a frame is an onset when it is a local
 * peak and rises clearly above the local median. Returns the onset strength per frame, 0
 * elsewhere. Uses a centred median, so it needs the frames on both sides (offline use).
 */
export function pickOnsets(
  flux: ArrayLike<number>,
  opts: OnsetOptions = ONSET_DEFAULTS,
): Float64Array {
  const n = flux.length;
  const out = new Float64Array(n);
  const scratch: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = flux[i] as number;
    if (v < opts.floor) continue;
    let isPeak = true;
    for (let j = Math.max(0, i - opts.peakFrames); j <= Math.min(n - 1, i + opts.peakFrames); j++) {
      const u = flux[j] as number;
      if (j < i ? u >= v : j > i && u > v) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak) continue;
    scratch.length = 0;
    for (
      let j = Math.max(0, i - opts.medianFrames);
      j <= Math.min(n - 1, i + opts.medianFrames);
      j++
    ) {
      scratch.push(flux[j] as number);
    }
    scratch.sort((a, b) => a - b);
    const median = scratch[scratch.length >> 1] ?? 0;
    if (v >= median + opts.delta) out[i] = Math.min(1, v);
  }
  return out;
}
