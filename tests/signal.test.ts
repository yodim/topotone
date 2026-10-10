import { describe, expect, it } from 'vitest';
import { FrameWindow } from '../src/world/signal';
import { functionSource } from './helpers';

describe('FrameWindow', () => {
  const frames = functionSource((t) => ({ rms: t >= 0 ? 1 : 0 })).frames(-10, 10);
  const win = new FrameWindow(frames, { rms: (f) => f.rms });

  it('averages over a centred window', () => {
    expect(win.mean('rms', 5, 2)).toBe(1);
    expect(win.mean('rms', -5, 2)).toBe(0);
    expect(win.mean('rms', 0, 4)).toBeCloseTo(0.5, 2);
  });

  it('falls back to the nearest frame for an empty range', () => {
    expect(win.meanRange('rms', 5, 5)).toBe(1);
    expect(new FrameWindow([], { rms: (f) => f.rms }).mean('rms', 0, 1)).toBe(0);
  });

  it('gives the same answer from windows over different ranges', () => {
    const a = new FrameWindow(frames.slice(0, 1200), { rms: (f) => f.rms });
    const b = new FrameWindow(frames.slice(300), { rms: (f) => f.rms });
    expect(a.mean('rms', -0.3, 1)).toBe(b.mean('rms', -0.3, 1));
  });
});
