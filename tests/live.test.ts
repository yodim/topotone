import { describe, expect, it } from 'vitest';
import type { FeatureSource } from '../src/audio/features';
import { SourceManager, type Song } from '../src/audio/sources/manager';
import { SyntheticSource } from '../src/audio/sources/synthetic';
import { World } from '../src/world/generator';
import { CHUNK_SECONDS, LAYERS, RIDGE_SAMPLES } from '../src/world/scene';
import { HOP, functionSource } from './helpers';

const GROUND = LAYERS.findIndex((l) => l.role === 'ground');
const HILLS = LAYERS.findIndex((l) => l.role === 'hills');
const FAR = LAYERS.findIndex((l) => l.role === 'far-range');

/** A source whose frames only exist up to `known`, like a mic. */
function growing() {
  const state = { known: 10 };
  const base = functionSource((t) => ({
    rms: 0.5 + 0.4 * Math.sin(t * 1.3),
    low: t > 9 ? 0.95 : 0.2,
    onsetHigh: t % 0.5 < HOP ? 0.8 : 0,
    onsetLow: t % 1 < HOP ? 0.9 : 0,
  }));
  const source: FeatureSource = {
    ...base,
    kind: 'mic',
    frames: (from, to) => base.frames(from, Math.min(to, state.known)),
  };
  return { state, source };
}

describe('live input', () => {
  it('never changes near land once its features exist', () => {
    const { state, source } = growing();
    const world = new World(1, source, () => state.known);
    world.reset(true);
    for (const layer of [GROUND, HILLS]) {
      state.known = 10;
      const early = world.chunk(layer, 2); // covers 8 to 12, still open
      expect(world.isOpen(layer, 2)).toBe(true);
      state.known = 30;
      expect(world.isOpen(layer, 2)).toBe(false);
      const late = world.chunk(layer, 2);
      const step = CHUNK_SECONDS / RIDGE_SAMPLES;
      for (let i = 0; i <= RIDGE_SAMPLES; i++) {
        if (8 + i * step < 10) expect(late.ridge[i]).toBe(early.ridge[i]);
      }
      const before = (os: typeof early.objects) => os.filter((o) => o.t < 10);
      expect(before(late.objects)).toEqual(before(early.objects));
      const settled = (ws: typeof early.water) => ws.filter((w) => w.t0 + 0.25 < 10);
      expect(settled(late.water)).toEqual(settled(early.water));
    }
  });

  it('keeps open chunks out of the cache, and far chunks frozen at first sight', () => {
    const { state, source } = growing();
    const world = new World(1, source, () => state.known);
    world.reset(true);
    world.chunk(GROUND, 2);
    expect(world.stats().chunks).toBe(0);
    const far = world.chunk(FAR, 2);
    state.known = 30;
    expect(world.chunk(FAR, 2)).toBe(far);
    expect(world.stats().chunks).toBe(1);
  });

  it('joins far chunks frozen at different moments without a step', () => {
    const { state, source } = growing();
    const world = new World(1, source, () => state.known);
    world.reset(true);
    state.known = 9;
    const a = world.chunk(FAR, 2);
    state.known = 14;
    const b = world.chunk(FAR, 3);
    expect(b.ridge[0]).toBe(a.ridge[RIDGE_SAMPLES]);
    // The slope carries over the edge too: no kink.
    const slope = (r: Float32Array, i: number) => (r[i + 1] ?? 0) - (r[i] ?? 0);
    expect(Math.abs(slope(b.ridge, 0) - slope(a.ridge, RIDGE_SAMPLES - 1))).toBeLessThan(0.002);
    // The ease stays gentle: no jump between neighboring samples.
    for (let i = 1; i <= RIDGE_SAMPLES; i++) {
      expect(Math.abs((b.ridge[i] ?? 0) - (b.ridge[i - 1] ?? 0))).toBeLessThan(0.05);
    }
    // A chunk built next to one that is still easing carries on without a kink.
    const c = world.chunk(FAR, 4);
    expect(c.ridge[0]).toBe(b.ridge[RIDGE_SAMPLES]);
    expect(Math.abs(slope(c.ridge, 0) - slope(b.ridge, RIDGE_SAMPLES - 1))).toBeLessThan(0.002);
  });

  it('builds the same world as before when not live', () => {
    const { source } = growing();
    const a = new World(1, source);
    const b = new World(1, source, () => Infinity);
    b.reset(false);
    expect(b.chunk(GROUND, 1)).toEqual(a.chunk(GROUND, 1));
  });
});

describe('SourceManager with a live source', () => {
  function fakeMic() {
    const { state, source } = growing();
    let stopped = false;
    let clock = 0;
    const mic: Song & { tick(dt: number): void } = {
      ...source,
      kind: 'mic',
      duration: Infinity,
      name: 'mic',
      get playing() {
        return !stopped;
      },
      get ended() {
        return stopped;
      },
      now: () => clock,
      frameAt: (t) => source.frames(Math.max(0, t - 1), t + 1e-9).at(-1) ?? source.frames(0, 1)[0]!,
      knownUntil: () => state.known,
      play: () => {},
      pause: () => {},
      stop: () => {
        stopped = true;
      },
      tick(dt) {
        clock += dt;
        state.known = clock - 0.1;
      },
    };
    return mic;
  }

  it('reports how far live features reach, and cannot pause', () => {
    const manager = new SourceManager(new SyntheticSource(1, () => 0));
    expect(manager.liveUntil()).toBe(Infinity);
    manager.tick(5);
    const mic = fakeMic();
    manager.playSong(mic);
    mic.tick(2);
    manager.tick(2);
    expect(manager.kind).toBe('mic');
    expect(manager.now()).toBe(7);
    expect(manager.liveUntil()).toBeCloseTo(6.9, 9);
    expect(manager.togglePause()).toBe(false);
    manager.tick(1);
    expect(manager.kind).toBe('mic');
    // A running mic session ends at its live edge.
    const session = manager.latestSession();
    expect(session?.kind).toBe('mic');
    expect(session?.start).toBe(5);
    expect(session?.end).toBeCloseTo(6.9, 9);
  });

  it('hands back to the synthetic source when the mic stops', () => {
    const manager = new SourceManager(new SyntheticSource(1, () => 0));
    let changes = 0;
    manager.onTimelineChange = () => changes++;
    manager.tick(5);
    const mic = fakeMic();
    manager.playSong(mic);
    mic.tick(3);
    manager.stopCurrent();
    expect(changes).toBe(2);
    expect(mic.ended).toBe(true);
    expect(manager.kind).toBe('synthetic');
    expect(manager.now()).toBe(8);
    expect(manager.liveUntil()).toBe(Infinity);
    // A stopped one ends where it stopped.
    expect(manager.latestSession()).toEqual({ kind: 'mic', name: null, start: 5, end: 8 });
    manager.tick(1);
    expect(manager.now()).toBe(9);
    expect(manager.frames(11, 12)).toEqual(manager.synthetic.frames(11, 12));
  });
});
