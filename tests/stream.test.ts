import { describe, expect, it } from 'vitest';
import type { FeatureFrame } from '../src/audio/features';
import { HOP_SIZE } from '../src/audio/extractor';
import { STREAM_DELAY_FRAMES, StreamAnalyzer } from '../src/audio/stream';
import { createRng } from '../src/core/rng';
import { clickTrack, droneWithGap, mixedPiece } from './fixtures/signals';

/** Feeds a signal in blocks of random sizes, like a real audio callback would. */
function stream(samples: Float32Array, sampleRate: number, seed = 1): FeatureFrame[] {
  const out: FeatureFrame[] = [];
  const s = new StreamAnalyzer(sampleRate, (f) => out.push(f));
  const rng = createRng(seed);
  for (let i = 0; i < samples.length;) {
    const n = rng.int(64, 2000);
    s.push(samples.subarray(i, i + n));
    i += n;
  }
  return out;
}

describe('StreamAnalyzer', () => {
  it('emits frames in order on the hop grid, whatever the block sizes', () => {
    const { samples, sampleRate } = mixedPiece(44100, 6);
    const a = stream(samples, sampleRate, 1);
    const b = stream(samples, sampleRate, 2);
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) {
      expect((a[i] as FeatureFrame).t - (a[i - 1] as FeatureFrame).t).toBeCloseTo(
        HOP_SIZE / sampleRate,
        9,
      );
    }
    // Everything but the last few frames comes out, and nothing comes out twice.
    const total = Math.floor((samples.length - 1024) / HOP_SIZE) + 1;
    expect((a[a.length - 1] as FeatureFrame).t).toBeCloseTo(
      ((total - 1 - STREAM_DELAY_FRAMES) * HOP_SIZE) / sampleRate,
      9,
    );
  });

  it('finds live clicks within 20 ms, with nothing extra', () => {
    const sig = clickTrack(48000, 10, 120, 0.2537);
    const onsets = stream(sig.samples, sig.sampleRate)
      .filter((f) => f.onset > 0)
      .map((f) => f.t);
    // The first click falls in the warm-up; every later one must be found.
    const expected = sig.clicks.filter((c) => c > 0.5 && c < 9.8);
    const found = onsets.filter((t) => t > 0.48);
    expect(found.length).toBe(expected.length);
    expected.forEach((c, i) => expect(Math.abs((found[i] ?? 0) - c)).toBeLessThan(0.02));
  });

  it('reads a silent gap as silence and the drone around it as loud', () => {
    const frames = stream(droneWithGap(44100, 12, 4, 8).samples, 44100);
    const at = (a: number, b: number) => frames.filter((f) => f.t >= a && f.t < b);
    expect(Math.max(...at(4.2, 7.9).map((f) => f.rms))).toBeLessThan(0.02);
    expect(Math.min(...at(9, 11.5).map((f) => f.rms))).toBeGreaterThan(0.6);
  });

  it('adapts to the level: a quiet mic and a loud mic look alike after a few seconds', () => {
    const { samples, sampleRate } = mixedPiece(44100, 12);
    const quiet = stream(
      samples.map((v) => v * 0.02),
      sampleRate,
    );
    const loud = stream(
      samples.map((v) => v * 0.9),
      sampleRate,
    );
    const late = (fs: FeatureFrame[]) => fs.filter((f) => f.t > 6).map((f) => f.rms);
    const q = late(quiet);
    const l = late(loud);
    expect(Math.max(...q.map((v, i) => Math.abs(v - (l[i] ?? 0))))).toBeLessThan(0.05);
  });
});
