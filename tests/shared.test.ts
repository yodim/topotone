import { describe, expect, it } from 'vitest';
import { SyntheticSource } from '../src/audio/sources/synthetic';
import { createRng } from '../src/core/rng';
import { edgeOffset, roughLoop, roughen, type Roughness } from '../src/styles/shared/edges';
import { css, hex, mix, ramp, shade } from '../src/styles/shared/palette';
import {
  bandRuns,
  ridgeAt,
  sampleRidge,
  timeAt,
  waterRuns,
  waterValueAt,
} from '../src/styles/shared/ridge';
import { catmullRom, smoothValues, traceSpline } from '../src/styles/shared/spline';
import { strokeOutline } from '../src/styles/shared/stroke';
import type { ChunkEnv } from '../src/styles/types';
import { World } from '../src/world/generator';
import { CHUNK_SECONDS, chunkStart } from '../src/world/scene';
import { recordingContext } from './canvas';

describe('palette', () => {
  it('reads hex colors', () => {
    expect(hex('#ff8000')).toEqual([255, 128, 0]);
    expect(hex('#abc')).toEqual([170, 187, 204]);
    expect(() => hex('#12')).toThrow();
  });

  it('mixes, ramps and shades', () => {
    expect(mix([0, 0, 0], [200, 100, 50], 0.5)).toEqual([100, 50, 25]);
    expect(mix([0, 0, 0], [200, 100, 50], 2)).toEqual([200, 100, 50]);
    const r = ramp([hex('#000000'), hex('#646464'), hex('#c8c8c8')], 0.75);
    expect(r).toEqual([150, 150, 150]);
    expect(shade([100, 100, 100], 1)).toEqual([255, 255, 255]);
    expect(shade([100, 100, 100], -1)).toEqual([0, 0, 0]);
  });

  it('writes CSS colors', () => {
    expect(css([10.4, 20.6, 30])).toBe('rgb(10, 21, 30)');
    expect(css([10, 20, 30], 0.5)).toBe('rgba(10, 20, 30, 0.5)');
  });
});

describe('splines', () => {
  it('passes through every point', () => {
    expect(catmullRom(0, 1, 3, 4, 0)).toBe(1);
    expect(catmullRom(0, 1, 3, 4, 1)).toBe(3);
    const s = smoothValues([0, 2, 1, 5], 4);
    expect(s.length).toBe(13);
    expect([s[0], s[4], s[8], s[12]]).toEqual([0, 2, 1, 5]);
  });

  it('traces one curve per span, ending on each point', () => {
    const { ctx, log } = recordingContext();
    traceSpline(ctx, [0, 10, 20], [0, 5, 0]);
    expect(log[0]).toBe('moveTo(0, 0)');
    expect(log.filter((l) => l.startsWith('bezierCurveTo'))).toHaveLength(2);
    expect(log[2]).toMatch(/, 20, 0\)$/);
  });
});

describe('edge roughening', () => {
  const r: Roughness = { seed: 7, wobble: 2, wobbleLength: 40, jitter: 0.5, jitterLength: 5 };

  it('is a function of position only, so two chunks agree on a shared edge', () => {
    const a = roughen([10, 10, 10], [100, 101, 102], r, 1);
    const b = roughen([10, 10], [101, 102], r, 1);
    expect(b[0]).toBe(a[1]);
    expect(b[1]).toBe(a[2]);
  });

  it('stays within its amplitudes and scales with the view', () => {
    for (let x = 0; x < 2000; x += 3.7) {
      expect(Math.abs(edgeOffset(r, x))).toBeLessThanOrEqual(2.5 * 1.01 + 1e-9);
    }
    const one = roughen([0], [123], r, 1)[0] as number;
    const two = roughen([0], [123], r, 2)[0] as number;
    expect(two).toBeCloseTo(2 * one, 9);
  });

  it('builds closed outlines around a centre', () => {
    const loop = roughLoop(50, 40, 10, 6, 12, 0.2, 3);
    expect(loop.xs.length).toBe(12);
    for (let i = 0; i < 12; i++) {
      const dx = ((loop.xs[i] as number) - 50) / 10;
      const dy = ((loop.ys[i] as number) - 40) / 6;
      expect(Math.hypot(dx, dy)).toBeGreaterThan(0.75);
      expect(Math.hypot(dx, dy)).toBeLessThan(1.25);
    }
  });
});

describe('variable strokes', () => {
  it('offsets each side by half the width along the normal', () => {
    const outline = strokeOutline([0, 10, 20], [0, 0, 0], (u) => 2 + 2 * u);
    expect(outline).not.toBeNull();
    const { left, right, widths } = outline!;
    expect(Array.from(widths)).toEqual([2, 3, 4]);
    expect(left[1]).toBe(1);
    expect(right[1]).toBe(-1);
    expect(left[5]).toBe(2);
    expect(right[5]).toBe(-2);
  });

  it('needs two points', () => {
    expect(strokeOutline([1], [1], () => 1)).toBeNull();
  });
});

describe('ridge helpers', () => {
  const world = new World(3, new SyntheticSource(3, () => 0));
  const layer = 2;
  const chunk = world.chunk(layer, 4);
  const start = chunkStart(4);
  const env: ChunkEnv = {
    rng: createRng(1),
    sky: world.skyAt(start),
    neighbors: { prev: world.chunk(layer, 3), next: world.chunk(layer, 5) },
    width: CHUNK_SECONDS * 30 + 40,
    height: 300,
    bleed: 20,
    scale: 1,
    pxPerSecond: 30,
    toX: (t) => 20 + (t - start) * 30,
    toY: (h) => 280 - 200 * h,
  };

  it('timeAt undoes toX', () => {
    for (const t of [start - 0.5, start, start + 2.3, start + CHUNK_SECONDS + 0.4]) {
      expect(timeAt(chunk, env, env.toX(t))).toBeCloseTo(t, 9);
    }
  });

  it('samples the ridge past both sides of the canvas', () => {
    const line = sampleRidge(chunk, env, 2);
    expect(line.xs[0]).toBeLessThan(0);
    expect(line.xs[line.xs.length - 1]).toBeGreaterThan(env.width);
    for (let i = 0; i < line.xs.length; i += 7) {
      const t = line.ts[i] as number;
      expect(line.hs[i]).toBe(ridgeAt(chunk, env.neighbors, t));
      expect(line.ys[i]).toBe(env.toY(line.hs[i] as number));
    }
  });

  it('finds the stretches where one line sits below another', () => {
    const upper = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
    const lower = [9, 12, 12, 12, 12, 9, 12, 12, 9, 12];
    // The run of four is kept, the run of two and the single sample are too short.
    expect(bandRuns(upper, lower)).toEqual([[1, 4]]);
    expect(bandRuns(upper, upper)).toEqual([]);
  });

  it('merges contiguous water cells into runs and blends their values', () => {
    const cell = (t0: number, width: number) => ({ t0, t1: t0 + 0.5, width, calm: 1 });
    const runs = waterRuns([cell(1, 0.2), cell(0.5, 0.4), cell(3, 1), cell(1.5, 0.6)]);
    expect(runs.map((r) => [r.t0, r.t1])).toEqual([
      [0.5, 2],
      [3, 3.5],
    ]);
    const run = runs[0]!;
    expect(waterValueAt(run, 0.5, (s) => s.width)).toBe(0.4);
    expect(waterValueAt(run, 1, (s) => s.width)).toBeCloseTo(0.3, 9);
    expect(waterValueAt(run, 2, (s) => s.width)).toBe(0.6);
  });
});
