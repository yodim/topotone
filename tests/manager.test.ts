import { describe, expect, it } from 'vitest';
import type { FeatureFrame } from '../src/audio/features';
import { BLEND_SECONDS, SourceManager, type Song } from '../src/audio/sources/manager';
import { Track } from '../src/audio/sources/file';
import { SyntheticSource } from '../src/audio/sources/synthetic';
import { HOP, functionSource } from './helpers';

/** A song with a hand-driven clock. Every frame has rms 1 and onsets on whole seconds. */
function fakeSong(duration: number) {
  const frames = functionSource((t) => ({
    rms: 1,
    low: 0.9,
    onset: t % 1 < HOP ? 1 : 0,
    onsetLow: t % 1 < HOP ? 1 : 0,
  })).frames(0, duration);
  const track = new Track(frames, duration);
  let time = 0;
  let state: 'ready' | 'playing' | 'paused' | 'ended' = 'ready';
  const song: Song & { advance(dt: number): void } = {
    kind: 'file',
    hopSeconds: HOP,
    duration,
    name: 'fake',
    get playing() {
      return state === 'playing';
    },
    get ended() {
      return state === 'ended';
    },
    now: () => time,
    lookahead: () => duration - time,
    frames: (from, to) => track.range(from, to),
    frameAt: (t) => track.at(t),
    play: () => {
      if (state !== 'ended') state = 'playing';
    },
    pause: () => {
      if (state === 'playing') state = 'paused';
    },
    stop: () => {
      state = 'ended';
    },
    advance(dt) {
      if (state !== 'playing') return;
      time = Math.min(duration, time + dt);
      if (time >= duration) state = 'ended';
    },
  };
  return song;
}

const setup = () => {
  const manager = new SourceManager(new SyntheticSource(1, () => 0));
  let changes = 0;
  manager.onTimelineChange = () => changes++;
  return { manager, changes: () => changes };
};

const rmsAt = (frames: FeatureFrame[], t: number) =>
  frames.reduce((best, f) => (Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best)).rms;

describe('SourceManager', () => {
  it('runs on synthetic time until a song starts', () => {
    const { manager } = setup();
    manager.tick(1.5);
    expect(manager.now()).toBe(1.5);
    expect(manager.kind).toBe('synthetic');
    expect(manager.frames(0, 1)).toEqual(manager.synthetic.frames(0, 1));
  });

  it('places a song at the current world time and follows its clock', () => {
    const { manager, changes } = setup();
    manager.tick(10);
    const song = fakeSong(30);
    manager.playSong(song);
    expect(changes()).toBe(1);
    expect(manager.kind).toBe('file');
    song.advance(5);
    manager.tick(5);
    expect(manager.now()).toBe(15);
    // Song frames appear at world time 10 + t, after the blend.
    const onsets = manager
      .frames(13, 20)
      .filter((f) => f.onsetLow > 0.99)
      .map((f) => f.t);
    expect(onsets.length).toBe(7);
    onsets.forEach((t, i) => expect(Math.abs(t - (13 + i))).toBeLessThan(HOP));
  });

  it('blends into the song and back to the synthetic source without jumps', () => {
    const { manager } = setup();
    manager.tick(10);
    manager.playSong(fakeSong(30));
    const frames = manager.frames(5, 50);
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1] as FeatureFrame;
      const b = frames[i] as FeatureFrame;
      expect(b.t).toBeGreaterThan(a.t);
      // The synthetic source swings fast on its own; no step may be much bigger than that.
      expect(Math.abs(b.rms - a.rms)).toBeLessThan(0.25);
    }
    expect(rmsAt(frames, 10 + BLEND_SECONDS + 1)).toBe(1);
    // After the song and its blend, the synthetic source is back, exactly.
    expect(manager.frames(43, 44)).toEqual(manager.synthetic.frames(43, 44));
  });

  it('never shares or drops a frame between adjacent ranges', () => {
    const { manager } = setup();
    manager.tick(3.3);
    manager.playSong(fakeSong(7.77));
    const whole = manager.frames(0, 20);
    const parts = [0, 2, 3.3, 4, 6.1, 11.07, 14, 20]
      .slice(1)
      .flatMap((to, i, arr) => manager.frames(i === 0 ? 0 : (arr[i - 1] as number), to));
    expect(parts.map((f) => f.t)).toEqual(whole.map((f) => f.t));
  });

  it('carries on from the end of the song', () => {
    const { manager } = setup();
    manager.tick(2);
    const song = fakeSong(4);
    manager.playSong(song);
    song.advance(4);
    manager.tick(0);
    expect(manager.kind).toBe('synthetic');
    expect(manager.now()).toBe(6);
    manager.tick(1);
    expect(manager.now()).toBe(7);
  });

  it('pauses the song, or the synthetic clock', () => {
    const { manager } = setup();
    manager.togglePause();
    manager.tick(1);
    expect(manager.now()).toBe(0);
    expect(manager.isPaused).toBe(true);
    manager.togglePause();
    const song = fakeSong(10);
    manager.playSong(song);
    manager.togglePause();
    expect(song.playing).toBe(false);
    manager.togglePause();
    expect(song.playing).toBe(true);
  });

  it('stops the old song when a new one starts', () => {
    const { manager, changes } = setup();
    const first = fakeSong(60);
    manager.playSong(first);
    first.advance(10);
    const second = fakeSong(20);
    manager.playSong(second);
    expect(first.ended).toBe(true);
    expect(changes()).toBe(2);
    expect(manager.now()).toBe(10);
    expect(manager.song).toBe(second);
  });
});
