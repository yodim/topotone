/**
 * Turns raw analysis values into FeatureFrames in 0..1.
 *
 * Recordings differ a lot in level, so energies are compared in decibels and mapped from
 * a low to a high percentile of the track itself: a quiet acoustic take and a loud electronic
 * track both use the full range. Brightness and pitch stay absolute (log-frequency scale),
 * so a dark track still reads as dark and the overall brightness can tint the palette.
 */
import type { FeatureFrame } from './features';
import { logFreq01, pickOnsets, type RawFrame } from './extractor';

/** Frames quieter than this (about -80 dBFS) count as silence and stay out of the statistics. */
const SILENCE_RMS = 1e-4;
/** Smallest decibel span a range may have, so a steady signal is not blown up into noise. */
const MIN_SPAN_DB = 18;
/** A band can never reach 1 when it stays this far below the loudest band. */
const BAND_HEADROOM_DB = 15;

/**
 * Onsets are reported one frame after the flux peak. A click entering a centred window
 * raises the log spectrum most while it is still before the frame centre; this lag puts
 * the reported time back on the click (the tests hold it within 20 ms).
 */
export const ONSET_LAG_FRAMES = 1;

export interface Range {
  lo: number;
  hi: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i] as number;
}

export function decibelRange(values: readonly number[], minSpan = MIN_SPAN_DB): Range {
  const sorted = [...values].sort((a, b) => a - b);
  const hi = percentile(sorted, 0.95);
  const lo = Math.min(percentile(sorted, 0.1), hi - minSpan);
  return { lo, hi };
}

export function scale01(x: number, r: Range): number {
  const v = (x - r.lo) / (r.hi - r.lo || 1);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const powerDb = (p: number) => 10 * Math.log10(p + 1e-20);
const amplitudeDb = (a: number) => 20 * Math.log10(a + 1e-12);

/**
 * Mean log rise per bin that counts as a full-strength change. It keeps steady sounds from
 * being blown up into onsets: a held drone wobbles a little, but never by this much.
 */
const MIN_FLUX_SCALE = 0.75;

/** Flux is scaled so that the busiest few percent of frames reach 1. */
function fluxScale(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1] ?? 0;
  return Math.max(percentile(sorted, 0.97), 0.25 * max, MIN_FLUX_SCALE);
}

export interface TrackStats {
  rms: Range;
  low: Range;
  mid: Range;
  high: Range;
  flux: number;
  fluxLow: number;
  fluxMid: number;
  fluxHigh: number;
}

/** Statistics over the non-silent frames of a whole track. */
export function trackStats(raw: readonly RawFrame[]): TrackStats {
  const sound = raw.filter((f) => f.rms >= SILENCE_RMS);
  const frames = sound.length > 0 ? sound : raw;
  const bands = (['low', 'mid', 'high'] as const).map((b) =>
    decibelRange(frames.map((f) => powerDb(f[b]))),
  );
  // Keep the bands comparable: a band far below the loudest one cannot reach the top.
  const loudest = Math.max(...bands.map((r) => r.hi));
  const [low, mid, high] = bands.map((r) => {
    const hi = Math.max(r.hi, loudest - BAND_HEADROOM_DB);
    return { lo: Math.min(r.lo, hi - MIN_SPAN_DB), hi };
  }) as [Range, Range, Range];
  return {
    rms: decibelRange(frames.map((f) => amplitudeDb(f.rms))),
    low,
    mid,
    high,
    flux: fluxScale(frames.map((f) => f.flux)),
    fluxLow: fluxScale(frames.map((f) => f.fluxLow)),
    fluxMid: fluxScale(frames.map((f) => f.fluxMid)),
    fluxHigh: fluxScale(frames.map((f) => f.fluxHigh)),
  };
}

/** One frame through the given statistics, without onsets. */
export function normalizeFrame(f: RawFrame, s: TrackStats): FeatureFrame {
  const silent = f.rms < SILENCE_RMS;
  return {
    t: f.t,
    rms: silent ? 0 : scale01(amplitudeDb(f.rms), s.rms),
    low: silent ? 0 : scale01(powerDb(f.low), s.low),
    mid: silent ? 0 : scale01(powerDb(f.mid), s.mid),
    high: silent ? 0 : scale01(powerDb(f.high), s.high),
    centroid: f.centroid,
    flux: Math.min(1, f.flux / s.flux),
    onset: 0,
    onsetLow: 0,
    onsetMid: 0,
    onsetHigh: 0,
    pitch: f.pitchHz === null ? null : logFreq01(f.pitchHz),
    pitchConfidence: f.pitchConfidence,
  };
}

/** A whole track at once: statistics, normalization and onset picking. */
export function normalizeTrack(raw: readonly RawFrame[]): FeatureFrame[] {
  const stats = trackStats(raw);
  const frames = raw.map((f) => normalizeFrame(f, stats));
  const curve = (key: 'flux' | 'fluxLow' | 'fluxMid' | 'fluxHigh', scale: number) =>
    raw.map((f) => Math.min(1, f[key] / scale));
  const all = pickOnsets(curve('flux', stats.flux));
  const low = pickOnsets(curve('fluxLow', stats.fluxLow));
  const mid = pickOnsets(curve('fluxMid', stats.fluxMid));
  const high = pickOnsets(curve('fluxHigh', stats.fluxHigh));
  // The overall onset comes from the whole spectrum. A band onset within SNAP frames of it
  // moves onto the same frame, so one hit never marks two neighboring frames.
  const SNAP = 3;
  const n = frames.length;
  const place = (i: number) => {
    let best = -1;
    for (let j = Math.max(0, i - SNAP); j <= Math.min(n - 1, i + SNAP); j++) {
      if ((all[j] ?? 0) > 0 && (best < 0 || Math.abs(j - i) < Math.abs(best - i))) best = j;
    }
    return (best < 0 ? i : best) + ONSET_LAG_FRAMES;
  };
  for (let i = 0; i < n; i++) {
    const at = (j: number) => frames[j];
    if ((all[i] ?? 0) > 0) {
      const f = at(i + ONSET_LAG_FRAMES);
      if (f) f.onset = Math.max(f.onset, all[i] ?? 0);
    }
    for (const [key, values] of [
      ['onsetLow', low],
      ['onsetMid', mid],
      ['onsetHigh', high],
    ] as const) {
      const v = values[i] ?? 0;
      if (v <= 0) continue;
      const f = at(place(i));
      if (!f) continue;
      f[key] = Math.max(f[key], v);
      f.onset = Math.max(f.onset, v);
    }
  }
  return frames;
}
