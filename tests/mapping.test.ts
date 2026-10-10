import { describe, expect, it } from 'vitest';
import { World } from '../src/world/generator';
import { LAYERS } from '../src/world/scene';
import { HOP, functionSource } from './helpers';

const GROUND = LAYERS.findIndex((l) => l.role === 'ground');
const HILLS = LAYERS.findIndex((l) => l.role === 'hills');
const FAR = LAYERS.findIndex((l) => l.role === 'far-range');
const MID = LAYERS.findIndex((l) => l.role === 'mid-range');

describe('mapping', () => {
  it('turns a long silence into a calm lake and rising mist', () => {
    const world = new World(
      1,
      functionSource(() => ({ rms: 0, low: 0, mid: 0, high: 0 })),
    );
    const chunk = world.chunk(GROUND, 2);
    expect(chunk.water.length).toBe(8);
    expect(chunk.water.every((w) => w.calm === 1)).toBe(true);
    expect(world.skyAt(10).mist).toBeGreaterThan(0.8);
  });

  it('opens a river under sustained bass, and none without it', () => {
    const bass = new World(
      1,
      functionSource(() => ({ low: 0.95 })),
    );
    const river = bass.chunk(GROUND, 2).water;
    expect(river.length).toBe(8);
    expect(river.every((w) => w.width > 0.9 && w.calm < 1)).toBe(true);

    const dry = new World(
      1,
      functionSource(() => ({ low: 0.3 })),
    );
    expect(dry.chunk(GROUND, 2).water).toEqual([]);
  });

  it('plants grass on high onsets and trees or rocks on low ones', () => {
    const period = 0.25;
    const onsets = (band: 'onsetHigh' | 'onsetLow') =>
      functionSource((t) => ({ [band]: t % period < HOP ? 0.8 : 0 }));

    const grass = new World(1, onsets('onsetHigh'));
    const kinds = grass.chunk(GROUND, 3).objects.map((o) => o.kind);
    expect(kinds.filter((k) => k === 'grass').length).toBeGreaterThan(8);

    const kicks = new World(1, onsets('onsetLow'));
    const ground = kicks.chunk(GROUND, 3).objects;
    const hills = kicks.chunk(HILLS, 3).objects;
    expect([...ground, ...hills].every((o) => o.kind === 'tree' || o.kind === 'rock')).toBe(true);
    expect(ground.length + hills.length).toBe(16);
    expect(hills.length).toBeGreaterThan(0);
  });

  it('raises the far range with brightness', () => {
    const avg = (r: Float32Array) => r.reduce((s, v) => s + v, 0) / r.length;
    let dark = 0;
    let bright = 0;
    for (let i = 0; i < 20; i++) {
      dark += avg(
        new World(
          1,
          functionSource(() => ({ centroid: 0.1 })),
        ).chunk(FAR, i).ridge,
      );
      bright += avg(
        new World(
          1,
          functionSource(() => ({ centroid: 0.9 })),
        ).chunk(FAR, i).ridge,
      );
    }
    expect(bright).toBeGreaterThan(dark + 20 * 0.2);
  });

  it('marks a sudden jump in loudness with a lone peak or birds', () => {
    // Quiet, then loud from t = 30.
    const world = new World(
      5,
      functionSource((t) => ({ rms: t < 30 ? 0.1 : 0.9 })),
    );
    const events = [...Array(4).keys()].flatMap((i) => [
      ...world.chunk(FAR, 6 + i).objects,
      ...world.chunk(MID, 6 + i).objects,
    ]);
    expect(events.some((o) => o.kind === 'lone-peak' || o.kind === 'bird')).toBe(true);
    expect(events.every((o) => Math.abs(o.t - 30) < 3)).toBe(true);
  });

  it('moves the sky from calm to dramatic with long-term energy', () => {
    const calm = new World(
      1,
      functionSource(() => ({ rms: 0.15, flux: 0.05 })),
    ).skyAt(20);
    const loud = new World(
      1,
      functionSource(() => ({ rms: 0.9, flux: 0.5 })),
    ).skyAt(20);
    expect(loud.mood).toBeGreaterThan(calm.mood + 0.5);
    expect(loud.cloudiness).toBeGreaterThan(calm.cloudiness);
  });
});
