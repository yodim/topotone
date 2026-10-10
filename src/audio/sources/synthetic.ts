/**
 * The no-audio fallback: music-like feature frames made from seeded noise.
 *
 * Every frame is a pure function of (seed, time), so any stretch can be computed in any
 * order, and the synthetic source has infinite lookahead. It imitates the shape of a song:
 * sections (quiet, verse, chorus, bass, build), four-bar phrase swells, wandering brightness,
 * a tempo between 70 and 130 bpm with a little swing, and the odd silent gap.
 */
import { clamp01, lerp, mod, smoothstep } from '../../core/math';
import { fbm1 } from '../../core/noise';
import { hash01, hashInt01, hashSeed } from '../../core/rng';
import type { FeatureFrame, FeatureSource } from '../features';

/** Same spacing file mode will use (hop 512 at 44.1 kHz), so the mapping sees the same density. */
export const SYNTH_HOP = 512 / 44100;

const BEATS_PER_BAR = 4;
const BARS_PER_PHRASE = 4;
const BARS_PER_SECTION = 8;

type SectionKind = 'quiet' | 'verse' | 'chorus' | 'bass' | 'build';

interface SectionShape {
  /** Loudness at the start and the end of the section. */
  loud: [number, number];
  bass: number;
  bright: number;
  /** Chance of a hi-hat on each eighth note. */
  hats: number;
  /** Chance of a melody note on each beat. */
  melody: number;
  kick: number;
  snare: number;
}

const SHAPES: Record<SectionKind, SectionShape> = {
  quiet: {
    loud: [0.14, 0.14],
    bass: 0.1,
    bright: 0.35,
    hats: 0.15,
    melody: 0.5,
    kick: 0,
    snare: 0,
  },
  verse: {
    loud: [0.45, 0.45],
    bass: 0.35,
    bright: 0.5,
    hats: 0.55,
    melody: 0.8,
    kick: 0.8,
    snare: 0.7,
  },
  chorus: { loud: [0.85, 0.85], bass: 0.6, bright: 0.72, hats: 1, melody: 0.9, kick: 1, snare: 1 },
  bass: {
    loud: [0.55, 0.55],
    bass: 0.92,
    bright: 0.3,
    hats: 0.35,
    melody: 0.3,
    kick: 1,
    snare: 0.5,
  },
  build: {
    loud: [0.25, 0.5],
    bass: 0.3,
    bright: 0.45,
    hats: 0.7,
    melody: 0.4,
    kick: 0.6,
    snare: 0.8,
  },
};

export interface SynthTempo {
  bpm: number;
  /** Seconds per beat. */
  beat: number;
  /** How late the off-beat eighths land, as a fraction of an eighth. */
  swing: number;
}

export function synthTempo(seed: number): SynthTempo {
  const bpm = 70 + 60 * hash01(seed, 'tempo');
  return { bpm, beat: 60 / bpm, swing: 0.08 + 0.14 * hash01(seed, 'swing') };
}

type Drum = 'kick' | 'snare' | 'hat';
const DRUM_INDEX: Record<Drum, number> = { kick: 0, snare: 1, hat: 2 };

/** Memo tables are cleared when they grow past this, which keeps memory flat. */
const MEMO_LIMIT = 8192;

export class SyntheticSource implements FeatureSource {
  readonly kind = 'synthetic' as const;
  readonly hopSeconds = SYNTH_HOP;
  readonly tempo: SynthTempo;
  private readonly sectionSeconds: number;
  private readonly phraseSeconds: number;
  private readonly eighth: number;
  private readonly noiseSeeds: number[];
  /** One salt per purpose, so hot paths can use the fast integer hash. */
  private readonly salt: Record<string, number>;
  // Pure memo tables: every frame looks at the same few sections and eighth notes.
  private readonly kinds = new Map<number, SectionKind>();
  private readonly hits = new Map<number, number>();

  constructor(
    readonly seed: number,
    private readonly clock: () => number,
  ) {
    this.tempo = synthTempo(seed);
    const bar = this.tempo.beat * BEATS_PER_BAR;
    this.sectionSeconds = bar * BARS_PER_SECTION;
    this.phraseSeconds = bar * BARS_PER_PHRASE;
    this.eighth = this.tempo.beat / 2;
    this.noiseSeeds = [0, 1, 2, 3, 4, 5, 6].map((i) => hashSeed(seed, 'synth-noise', i));
    this.salt = Object.fromEntries(
      [
        'section',
        'gap',
        'gap-at',
        'gap-len',
        'kick',
        'snare',
        'hat',
        'hat-vel',
        'note',
        'note-conf',
      ].map((name) => [name, hashSeed(seed, name)]),
    );
  }

  now(): number {
    return this.clock();
  }

  lookahead(): number {
    return Infinity;
  }

  frames(from: number, to: number): FeatureFrame[] {
    const hop = this.hopSeconds;
    const out: FeatureFrame[] = [];
    for (let k = Math.ceil(from / hop) - 1; ; k++) {
      const t = k * hop;
      if (t < from) continue;
      if (t >= to) break;
      out.push(this.frameAt(t));
    }
    return out;
  }

  private kindOf(section: number): SectionKind {
    let kind = this.kinds.get(section);
    if (kind === undefined) {
      // A build-up is always followed by a chorus that drops in hard.
      kind = this.rawKind(section - 1) === 'build' ? 'chorus' : this.rawKind(section);
      if (this.kinds.size > MEMO_LIMIT) this.kinds.clear();
      this.kinds.set(section, kind);
    }
    return kind;
  }

  private h(name: string, i: number): number {
    return hashInt01(this.salt[name] ?? 0, i);
  }

  private rawKind(section: number): SectionKind {
    const r = this.h('section', section);
    if (r < 0.15) return 'quiet';
    if (r < 0.5) return 'verse';
    if (r < 0.7) return 'chorus';
    if (r < 0.85) return 'bass';
    return 'build';
  }

  /** 1 normally, close to 0 inside a silent gap. Only quiet sections have gaps. */
  private presence(t: number): number {
    const section = Math.floor(t / this.sectionSeconds);
    if (this.kindOf(section) !== 'quiet' || this.h('gap', section) >= 0.6) return 1;
    const start = section * this.sectionSeconds;
    const gapStart = start + this.sectionSeconds * (0.25 + 0.2 * this.h('gap-at', section));
    const gapEnd = gapStart + 2.5 + 2.5 * this.h('gap-len', section);
    return 1 - smoothstep(gapStart - 0.15, gapStart, t) * smoothstep(gapEnd + 0.15, gapEnd, t);
  }

  /** Section parameters at time t, crossfaded from the previous section. */
  private shapeAt(t: number) {
    const section = Math.floor(t / this.sectionSeconds);
    const local = t - section * this.sectionSeconds;
    const kind = this.kindOf(section);
    const prevKind = this.kindOf(section - 1);
    const cur = SHAPES[kind];
    const prev = SHAPES[prevKind];
    const p = local / this.sectionSeconds;
    const fadeSeconds = prevKind === 'build' && kind === 'chorus' ? 0.04 : 0.8;
    const w = smoothstep(0, fadeSeconds, local);
    const mix = (a: number, b: number) => lerp(a, b, w);
    return {
      loud: mix(prev.loud[1], lerp(cur.loud[0], cur.loud[1], p)),
      bass: mix(prev.bass, cur.bass),
      bright: mix(prev.bright, cur.bright),
      hats: mix(prev.hats, cur.hats),
      melody: mix(prev.melody, cur.melody),
      kick: mix(prev.kick, cur.kick),
      snare: mix(prev.snare, cur.snare),
    };
  }

  /** Swung time of eighth note e. */
  private eighthTime(e: number): number {
    return e * this.eighth + (mod(e, 2) === 1 ? this.tempo.swing * this.eighth : 0);
  }

  /** Strength of the given drum on eighth e, or 0 when it does not play. */
  private hit(drum: Drum, e: number): number {
    const key = e * 3 + DRUM_INDEX[drum];
    let strength = this.hits.get(key);
    if (strength === undefined) {
      strength = this.computeHit(drum, e);
      if (this.hits.size > MEMO_LIMIT) this.hits.clear();
      this.hits.set(key, strength);
    }
    return strength;
  }

  private computeHit(drum: Drum, e: number): number {
    const at = this.eighthTime(e);
    if (this.presence(at) < 0.5) return 0;
    const shape = this.shapeAt(at);
    const pos = mod(e, 8);
    const r = this.h(drum, e);
    switch (drum) {
      case 'kick': {
        const main = pos === 0 || pos === 4;
        const extra = (pos === 3 || pos === 7) && r < 0.3 * shape.kick;
        if (!(main || extra) || shape.kick <= 0) return 0;
        return clamp01(shape.kick * (0.45 + 0.55 * shape.loud) * (0.75 + 0.25 * r));
      }
      case 'snare':
        if ((pos !== 2 && pos !== 6) || shape.snare <= 0) return 0;
        return clamp01(shape.snare * (0.4 + 0.6 * shape.loud) * (0.7 + 0.3 * r));
      case 'hat':
        if (r >= shape.hats) return 0;
        return clamp01((0.35 + 0.5 * this.h('hat-vel', e)) * (0.5 + 0.5 * shape.loud));
    }
  }

  /** Onset strength if a hit of this drum lands inside [t, t + hop). */
  private onsetIn(drum: Drum, t: number): number {
    const e0 = Math.floor(t / this.eighth);
    for (let e = e0 - 1; e <= e0 + 1; e++) {
      const at = this.eighthTime(e);
      if (at >= t && at < t + this.hopSeconds) return this.hit(drum, e);
    }
    return 0;
  }

  /** Decaying envelope of the latest hit of this drum at or before t. */
  private decay(drum: Drum, t: number, seconds: number): number {
    const e0 = Math.floor(t / this.eighth);
    for (let e = e0 + 1; e >= e0 - 8; e--) {
      const at = this.eighthTime(e);
      if (at > t) continue;
      const strength = this.hit(drum, e);
      if (strength <= 0) continue;
      const d = 1 - (t - at) / seconds;
      return d > 0 ? strength * d * d : 0;
    }
    return 0;
  }

  frameAt(t: number): FeatureFrame {
    const n = this.noiseSeeds;
    const shape = this.shapeAt(t);
    const present = this.presence(t);

    const phrase = (t / this.phraseSeconds) % 1;
    const p = phrase < 0 ? phrase + 1 : phrase;
    const swell = 0.82 + 0.18 * (1 - (2 * p - 1) * (2 * p - 1));

    const kick = this.decay('kick', t, 0.3);
    const snare = this.decay('snare', t, 0.2);
    const hat = this.decay('hat', t, 0.08);

    const rms = clamp01(
      (shape.loud * swell + 0.12 * kick + 0.05 * fbm1(n[0] ?? 0, t * 0.6, 3)) * present,
    );
    const low = clamp01(
      (shape.bass * (0.6 + 0.4 * swell) + 0.25 * kick + 0.05 * fbm1(n[1] ?? 0, t * 0.9, 2)) *
        present,
    );
    const mid = clamp01(
      (shape.loud * 0.65 + 0.3 * snare + 0.06 * fbm1(n[2] ?? 0, t * 1.3, 2)) * present,
    );
    const high = clamp01(
      (0.2 * shape.bright + 0.5 * hat + 0.04 * fbm1(n[3] ?? 0, t * 2.1, 2)) * present,
    );
    const centroid = clamp01(
      shape.bright + 0.15 * fbm1(n[4] ?? 0, t * 0.08, 3) + 0.08 * hat - 0.08 * shape.bass,
    );

    const onsetLow = this.onsetIn('kick', t);
    const onsetMid = this.onsetIn('snare', t);
    const onsetHigh = this.onsetIn('hat', t);
    const onset = Math.max(onsetLow, onsetMid, onsetHigh);
    const flux = clamp01(onset * 0.9 + 0.05 * Math.abs(fbm1(n[5] ?? 0, t * 3, 2)));

    // One melody note per beat, on a twelve-step scale that wanders slowly.
    const note = Math.floor(t / this.tempo.beat);
    const noteOn = present > 0.5 && this.h('note', note) < shape.melody;
    const contour = 0.5 + 0.5 * fbm1(n[6] ?? 0, note * 0.21, 2);
    const pitch = noteOn ? 0.25 + 0.5 * (Math.round(contour * 12) / 12) : null;
    const pitchConfidence = noteOn ? 0.6 + 0.35 * this.h('note-conf', note) : 0.1;

    return {
      t,
      rms,
      low,
      mid,
      high,
      centroid,
      flux,
      onset,
      onsetLow,
      onsetMid,
      onsetHigh,
      pitch,
      pitchConfidence,
    };
  }
}
