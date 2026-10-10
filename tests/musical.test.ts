/**
 * The Phase 3 acceptance checks: each code-generated signal must read the way the plan says.
 * Thresholds keep a safe margin below what the mapping does today, so tuning can move values
 * without breaking these, but not undo the musical behavior.
 */
import { describe, expect, it } from 'vitest';
import { analyzeTrack } from '../src/audio/analysis';
import { World } from '../src/world/generator';
import { CHUNK_SECONDS, LAYERS, RIDGE_SAMPLES, type WorldObject } from '../src/world/scene';
import type { Signal } from './fixtures/signals';
import {
  buildAndDrop,
  clickTrack,
  droneWithGap,
  quietThenLoud,
  sineSweep,
} from './fixtures/signals';
import { trackSource } from './helpers';

const layer = (role: string) => LAYERS.findIndex((l) => l.role === role);
const FAR = layer('far-range');
const MID = layer('mid-range');
const HILLS = layer('hills');
const GROUND = layer('ground');

function worldFor(sig: Signal): World {
  const frames = analyzeTrack(sig.samples, sig.sampleRate);
  return new World(1, trackSource(frames, sig.samples.length / sig.sampleRate));
}

function chunksIn(from: number, to: number): number[] {
  const out: number[] = [];
  for (let c = Math.floor(from / CHUNK_SECONDS); c * CHUNK_SECONDS < to; c++) out.push(c);
  return out;
}

function ridgeMean(world: World, l: number, from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (const c of chunksIn(from, to)) {
    world.chunk(l, c).ridge.forEach((h, i) => {
      const t = c * CHUNK_SECONDS + (i * CHUNK_SECONDS) / RIDGE_SAMPLES;
      if (t < from || t >= to) return;
      sum += h;
      n++;
    });
  }
  return sum / n;
}

function objectsIn(world: World, l: number, from: number, to: number): WorldObject[] {
  return chunksIn(from, to).flatMap((c) =>
    world.chunk(l, c).objects.filter((o) => o.t >= from && o.t < to),
  );
}

describe('the land reads the music', () => {
  it('climbs with a rising sweep', () => {
    const world = worldFor(sineSweep(44100, 20, 100, 2000));
    expect(ridgeMean(world, FAR, 15, 19)).toBeGreaterThan(ridgeMean(world, FAR, 1, 5) + 0.08);
    expect(ridgeMean(world, MID, 15, 19)).toBeGreaterThan(ridgeMean(world, MID, 1, 5) + 0.08);
  });

  it('turns a click track into a row of trees on the beat', () => {
    const sig = clickTrack(44100, 12, 120, 0.25);
    const world = worldFor(sig);
    const clicks = sig.clicks.filter((c) => c >= 1 && c < 11);
    const objects = [...objectsIn(world, GROUND, 1, 11), ...objectsIn(world, HILLS, 1, 11)];
    for (const c of clicks) {
      expect(objects.some((o) => Math.abs(o.t - c) < 0.02)).toBe(true);
    }
    const trees = objects.filter((o) => o.kind === 'tree' || o.kind === 'rock');
    expect(trees.length).toBeGreaterThanOrEqual(clicks.length * 0.8);
  });

  it('opens a river under a drone, and a calm lake with mist in its silent gap', () => {
    const world = worldFor(droneWithGap(44100, 16, 6, 10));
    const cells = (from: number, to: number) =>
      chunksIn(from, to).flatMap((c) =>
        world.chunk(GROUND, c).water.filter((w) => w.t0 >= from && w.t0 < to),
      );
    const river = cells(1, 5);
    expect(river.length).toBe(8);
    expect(river.every((w) => w.calm < 1 && w.width > 0.8)).toBe(true);
    const lake = cells(7, 9);
    expect(lake.length).toBe(4);
    expect(lake.every((w) => w.calm === 1)).toBe(true);
    expect(world.skyAt(8.5).mist).toBeGreaterThan(0.7);
    expect(world.skyAt(3).mist).toBeLessThan(0.3);
  });

  it('keeps a quiet passage calm and makes a loud one dramatic', () => {
    const world = worldFor(quietThenLoud(44100, 40));
    expect(world.skyAt(36).mood).toBeGreaterThan(world.skyAt(12).mood + 0.5);
    expect(world.skyAt(36).cloudiness).toBeGreaterThan(world.skyAt(12).cloudiness + 0.3);
    expect(ridgeMean(world, HILLS, 25, 38)).toBeGreaterThan(ridgeMean(world, HILLS, 5, 18) + 0.15);
  });

  it('marks a drop after a build-up with a peak, birds and a lift in the hills', () => {
    const world = worldFor(buildAndDrop(44100, 30, 18));
    const peaks = objectsIn(world, FAR, 0, 30).filter((o) => o.kind === 'lone-peak');
    expect(peaks.some((p) => Math.abs(p.t - 18) < 1)).toBe(true);
    const birds = objectsIn(world, MID, 15, 22).filter((o) => o.kind === 'bird');
    expect(birds.length).toBeGreaterThanOrEqual(3);
    expect(ridgeMean(world, HILLS, 18.5, 22)).toBeGreaterThan(
      ridgeMean(world, HILLS, 14, 17) + 0.15,
    );
  });
});
