import { describe, expect, it } from 'vitest';
import type { FeatureFrame } from '../src/audio/features';
import { SYNTH_HOP, SyntheticSource, synthTempo } from '../src/audio/sources/synthetic';

const source = (seed: number) => new SyntheticSource(seed, () => 0);

function windows(frames: FeatureFrame[], seconds: number, key: 'rms' | 'low') {
  const per = Math.round(seconds / SYNTH_HOP);
  const out: number[] = [];
  for (let i = 0; i + per <= frames.length; i += per) {
    out.push(frames.slice(i, i + per).reduce((s, f) => s + f[key], 0) / per);
  }
  return out;
}

describe('SyntheticSource', () => {
  it('is a pure function of seed and time', () => {
    expect(source(1).frames(10, 12)).toEqual(source(1).frames(10, 12));
    expect(source(1).frames(10, 12)).not.toEqual(source(2).frames(10, 12));
  });

  it('partitions time: adjacent ranges never share or skip a frame', () => {
    const s = source(4);
    const joined = [...s.frames(-3, 1.234), ...s.frames(1.234, 5)];
    expect(joined).toEqual(s.frames(-3, 5));
    for (const f of s.frames(-3, 1.234)) expect(f.t).toBeLessThan(1.234);
  });

  it('keeps every value in range', () => {
    for (const f of source(7).frames(-30, 120)) {
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
      if (f.pitch !== null) {
        expect(f.pitch).toBeGreaterThanOrEqual(0);
        expect(f.pitch).toBeLessThanOrEqual(1);
      }
      expect(f.onset).toBe(Math.max(f.onsetLow, f.onsetMid, f.onsetHigh));
    }
  });

  it('plays at a tempo between 70 and 130 bpm, with onsets on the swung eighth grid', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { bpm, beat, swing } = synthTempo(seed);
      expect(bpm).toBeGreaterThanOrEqual(70);
      expect(bpm).toBeLessThanOrEqual(130);
      const eighth = beat / 2;
      const onsets = source(seed)
        .frames(0, 60)
        .filter((f) => f.onset > 0);
      expect(onsets.length).toBeGreaterThan(20);
      for (const f of onsets) {
        const e = Math.round(f.t / eighth);
        // The onset frame is the last frame at or before the hit.
        const hits = [e - 1, e, e + 1].map((n) => n * eighth + (n % 2 ? swing * eighth : 0));
        expect(hits.some((at) => at - f.t >= 0 && at - f.t < SYNTH_HOP)).toBe(true);
      }
    }
  });

  it('has quiet passages, silences and bass-heavy sections over ten minutes', () => {
    let silences = 0;
    let bass = 0;
    let loud = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const frames = source(seed).frames(0, 600);
      silences += windows(frames, 2, 'rms').filter((v) => v < 0.05).length;
      bass += windows(frames, 4, 'low').filter((v) => v > 0.7).length;
      loud += windows(frames, 4, 'rms').filter((v) => v > 0.7).length;
    }
    expect(silences).toBeGreaterThan(0);
    expect(bass).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(0);
  });

  it('reports its clock and infinite lookahead', () => {
    let t = 3;
    const s = new SyntheticSource(1, () => t);
    expect(s.now()).toBe(3);
    t = 4;
    expect(s.now()).toBe(4);
    expect(s.lookahead()).toBe(Infinity);
    expect(s.hopSeconds).toBe(SYNTH_HOP);
  });
});
