import type { FeatureFrame, FeatureSource } from '../src/audio/features';

export const HOP = 512 / 44100;

/** A source whose frames come from a function of time. Handy for testing the mapping. */
export function functionSource(fn: (t: number) => Partial<FeatureFrame>): FeatureSource {
  return {
    kind: 'synthetic',
    hopSeconds: HOP,
    now: () => 0,
    lookahead: () => Infinity,
    frames(from, to) {
      const out: FeatureFrame[] = [];
      for (let k = Math.ceil(from / HOP) - 1; ; k++) {
        const t = k * HOP;
        if (t < from) continue;
        if (t >= to) break;
        out.push({
          t,
          rms: 0.5,
          low: 0.3,
          mid: 0.4,
          high: 0.3,
          centroid: 0.5,
          flux: 0.1,
          onset: 0,
          onsetLow: 0,
          onsetMid: 0,
          onsetHigh: 0,
          pitch: null,
          pitchConfidence: 0,
          ...fn(t),
        });
      }
      return out;
    },
  };
}
