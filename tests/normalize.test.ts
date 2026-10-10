import { describe, expect, it } from 'vitest';
import { analyzeTrack, packFrames, unpackFrames } from '../src/audio/analysis';
import { decibelRange, scale01 } from '../src/audio/normalize';
import { mixedPiece } from './fixtures/signals';

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0;

describe('normalization', () => {
  it('lets a quiet and a loud recording use the same range', () => {
    const { samples, sampleRate } = mixedPiece(44100, 10);
    const quiet = analyzeTrack(
      samples.map((v) => v * 0.03),
      sampleRate,
    );
    const loud = analyzeTrack(
      samples.map((v) => v * 0.95),
      sampleRate,
    );
    expect(p95(quiet.map((f) => f.rms))).toBeGreaterThan(0.9);
    expect(p95(loud.map((f) => f.rms))).toBeGreaterThan(0.9);
    const diff = quiet.map((f, i) => Math.abs(f.rms - (loud[i]?.rms ?? 0)));
    expect(Math.max(...diff)).toBeLessThan(0.05);
    // Brightness stays absolute: it does not depend on the level.
    expect(Math.abs((quiet[200]?.centroid ?? 0) - (loud[200]?.centroid ?? 0))).toBeLessThan(0.02);
  });

  it('does not blow a steady level up into noise', () => {
    const r = decibelRange([-20, -20, -20, -20.5]);
    expect(r.hi - r.lo).toBeGreaterThanOrEqual(18);
    expect(scale01(-20, r)).toBeGreaterThan(0.95);
  });

  it('packs and unpacks frames losslessly', () => {
    const frames = analyzeTrack(mixedPiece(44100, 2).samples, 44100);
    expect(unpackFrames(packFrames(frames))).toEqual(frames);
  });
});
