import { describe, expect, it } from 'vitest';
import { analyzeTrack } from '../src/audio/analysis';
import { HOP_SIZE, logFreq01, pickOnsets } from '../src/audio/extractor';
import { clickTrack, droneWithGap, mixedPiece, sineSweep } from './fixtures/signals';

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

describe('feature extraction', () => {
  it('gives a rising centroid for a rising sweep', () => {
    const frames = analyzeTrack(sineSweep(44100, 8, 100, 2000).samples, 44100);
    const perSecond = Array.from({ length: 8 }, (_, s) =>
      mean(frames.filter((f) => f.t >= s && f.t < s + 1).map((f) => f.centroid)),
    );
    for (let s = 1; s < 8; s++)
      expect(perSecond[s]).toBeGreaterThan((perSecond[s - 1] ?? 0) + 0.03);
    expect(perSecond[0]).toBeCloseTo(logFreq01(100 * Math.pow(20, 1 / 16)), 1);
  });

  it('tracks the pitch of the sweep inside the pitch range', () => {
    const frames = analyzeTrack(sineSweep(44100, 8, 100, 2000).samples, 44100);
    // The sweep is at 100 * 20^(t/8) Hz; it passes 1 kHz just after t = 6.1.
    for (const t of [0.5, 2, 3.5, 5]) {
      const f = frames.find((x) => x.t >= t);
      expect(f?.pitch).not.toBeNull();
      expect(f?.pitch ?? 0).toBeCloseTo(logFreq01(100 * Math.pow(20, t / 8)), 2);
    }
  });

  it('finds every click within 20 ms and nothing else', () => {
    for (const sr of [44100, 48000]) {
      const sig = clickTrack(sr, 8, 120, 0.2537);
      const onsets = analyzeTrack(sig.samples, sr)
        .filter((f) => f.onset > 0)
        .map((f) => f.t);
      expect(onsets.length).toBe(sig.clicks.length);
      sig.clicks.forEach((c, i) => expect(Math.abs((onsets[i] ?? 0) - c)).toBeLessThan(0.02));
      // Every 0.5 s, as at 120 bpm.
      for (let i = 1; i < onsets.length; i++) {
        expect(Math.abs((onsets[i] ?? 0) - (onsets[i - 1] ?? 0) - 0.5)).toBeLessThan(0.02);
      }
    }
  });

  it('reads silence as silence and a bass drone as low energy', () => {
    const frames = analyzeTrack(droneWithGap(44100, 12, 4, 8).samples, 44100);
    const at = (a: number, b: number) => frames.filter((f) => f.t >= a && f.t < b);
    const gap = at(4.1, 7.9);
    expect(Math.max(...gap.map((f) => f.rms))).toBeLessThan(0.02);
    expect(gap.every((f) => f.pitch === null && f.onset === 0)).toBe(true);
    for (const [a, b] of [
      [0.5, 3.5],
      [8.5, 11.5],
    ] as const) {
      const sound = at(a, b);
      expect(mean(sound.map((f) => f.rms))).toBeGreaterThan(0.8);
      expect(mean(sound.map((f) => f.low))).toBeGreaterThan(0.8);
      expect(mean(sound.map((f) => f.high))).toBeLessThan(0.4);
    }
  });

  it('does not invent onsets in steady sounds', () => {
    const frames = analyzeTrack(droneWithGap(44100, 8, 9, 10).samples, 44100);
    // The hard cut at the very end is a real transient, so only the steady middle counts.
    expect(frames.filter((f) => f.t > 0.5 && f.t < 7.5 && f.onset > 0).length).toBe(0);
  });

  it('keeps every value in range and frames on the hop grid', () => {
    const frames = analyzeTrack(mixedPiece(48000, 6).samples, 48000);
    frames.forEach((f, k) => {
      expect(f.t).toBeCloseTo((k * HOP_SIZE) / 48000, 9);
      for (const v of [
        f.rms,
        f.low,
        f.mid,
        f.high,
        f.centroid,
        f.flux,
        f.onset,
        f.pitchConfidence,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe('pickOnsets', () => {
  it('picks clear peaks above the local median', () => {
    const flux = new Float64Array(200).fill(0.05);
    flux[50] = 0.9;
    flux[51] = 0.4;
    flux[120] = 0.5;
    flux[121] = 0.5;
    const onsets = pickOnsets(flux);
    expect([...onsets.keys()].filter((i) => (onsets[i] ?? 0) > 0)).toEqual([50, 120]);
    expect(onsets[50]).toBeCloseTo(0.9);
  });
});
