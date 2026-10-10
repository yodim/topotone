/**
 * The musical design: how features turn into terrain. Version 0, following the table in
 * PLAN.md. Every constant lives in MAPPING below and gets tuned by ear in Phase 3.
 *
 * Rules of thumb:
 * - Features set the large shapes. Seeded noise adds the detail on top.
 * - Far layers follow slow, heavily smoothed features. Near layers follow fast ones.
 * - Every value is a function of (seed, time, nearby frames). Nothing carries state from
 *   one chunk to the next, which is what keeps chunk edges invisible.
 * - Windows are full widths in seconds, centred on the time asked for.
 */
import type { FeatureFrame } from '../audio/features';
import { bump, clamp01, lerp, smoothstep } from '../core/math';
import { fbm1 } from '../core/noise';
import { hash01, hashSeed } from '../core/rng';
import type { LayerRole, SkyState, WaterSpan, WorldObject } from './scene';
import { FrameWindow } from './signal';

export const MAPPING = {
  /** How much a confident pitch pulls the "tone" away from the spectral centroid. */
  pitchWeight: 0.6,

  /** Distant range: slow melody or brightness sets the height. */
  far: {
    window: 3,
    base: 0.3,
    tone: 0.45,
    noiseFreq: 0.045,
    noiseAmp: 0.3,
    detailFreq: 0.35,
    detailAmp: 0.05,
  },
  /** Middle range: melody or brightness, about 0.5 s. */
  mid: {
    window: 0.5,
    base: 0.22,
    tone: 0.38,
    noiseFreq: 0.12,
    noiseAmp: 0.28,
    detailFreq: 0.9,
    detailAmp: 0.06,
  },
  /** Hills: loudness, about 0.2 s, sets height and ruggedness. */
  hills: {
    window: 0.2,
    base: 0.16,
    loud: 0.42,
    noiseFreq: 0.3,
    noiseAmp: 0.16,
    rugged: 0.18,
    detailFreq: 2.2,
  },
  /** Ground: mostly noise, flattened by water and silence. */
  ground: { base: 0.4, noiseFreq: 0.45, noiseAmp: 0.18, detailFreq: 3, detailAmp: 0.04 },

  /** Sustained bass opens a river. Water is laid out in fixed cells of absolute time. */
  water: { cell: 0.5, riverWindow: 1, riverOn: 0.55, riverFull: 0.85, level: 0.08 },
  /** Long silence (rms below `quiet` across the window) gives a plain or a still lake. */
  silence: { window: 2.5, quiet: 0.05, loud: 0.1, plain: 0.25 },

  /** High-band onsets: grass tufts, sometimes a small tree. */
  grass: { threshold: 0.2, smallTreeAbove: 0.7, smallTreeChance: 0.25 },
  /** Low and mid onsets: large trees and rocks, size from strength. */
  trees: { threshold: 0.3, hillsShare: 0.35, rockChance: 0.4, minSize: 0.35 },

  /** A sudden jump in loudness: a lone peak on the far range, or a flock of birds. */
  crescendo: {
    grid: 0.1,
    short: 0.5,
    longFrom: 4,
    longTo: 0.5,
    threshold: 0.22,
    range: 0.4,
    isolation: 2,
    peakChance: 0.55,
    peakRadius: 4,
    peakHeight: 0.4,
    birdSpread: 1.5,
  },

  /** Sky: long-term energy sets the mood, track brightness sets warmth. */
  sky: { energyWindow: 10, toneWindow: 30, mistWindow: 5, grid: 0.25 },

  /** Seconds of frames fetched on each side of a chunk. Must cover the widest window used. */
  margin: 12,
} as const;

/** Brightness blended with pitch when the pitch is confident. */
export function frameTone(f: FeatureFrame): number {
  if (f.pitch === null || f.pitchConfidence < 0.5) return f.centroid;
  return lerp(f.centroid, f.pitch, MAPPING.pitchWeight * f.pitchConfidence);
}

export type Column = 'rms' | 'low' | 'tone' | 'flux';

export function featureWindow(frames: readonly FeatureFrame[]): FrameWindow<Column> {
  return new FrameWindow(frames, {
    rms: (f) => f.rms,
    low: (f) => f.low,
    tone: frameTone,
    flux: (f) => f.flux,
  });
}

export interface MapContext {
  seed: number;
  win: FrameWindow<Column>;
  crescendos: readonly Crescendo[];
}

/** 0 with sound, 1 after a long silence. */
export function silenceAt(win: FrameWindow<Column>, t: number): number {
  const s = MAPPING.silence;
  return 1 - smoothstep(s.quiet, s.loud, win.mean('rms', t, s.window));
}

/** 0 without bass, 1 for a strong sustained bass. */
export function riverAt(win: FrameWindow<Column>, t: number): number {
  const w = MAPPING.water;
  return smoothstep(w.riverOn, w.riverFull, win.mean('low', t, w.riverWindow));
}

export function waterAt(win: FrameWindow<Column>, t: number): number {
  return Math.max(riverAt(win, t), silenceAt(win, t));
}

function layerNoise(seed: number, role: LayerRole, name: string): number {
  return hashSeed(seed, role, name);
}

/** Ridge height 0..1 for a layer at music time t. */
export function ridgeHeight(role: LayerRole, t: number, ctx: MapContext): number {
  const { seed, win } = ctx;
  const shape = fbm1(layerNoise(seed, role, 'shape'), t * noiseFreq(role), 4);
  switch (role) {
    case 'far-range': {
      const m = MAPPING.far;
      const tone = win.mean('tone', t, m.window);
      const detail = fbm1(layerNoise(seed, role, 'detail'), t * m.detailFreq, 2);
      return clamp01(
        m.base + m.tone * tone + m.noiseAmp * shape + m.detailAmp * detail + peaksAt(ctx, t),
      );
    }
    case 'mid-range': {
      const m = MAPPING.mid;
      const tone = win.mean('tone', t, m.window);
      const detail = fbm1(layerNoise(seed, role, 'detail'), t * m.detailFreq, 2);
      return clamp01(m.base + m.tone * tone + m.noiseAmp * shape + m.detailAmp * detail);
    }
    case 'hills': {
      const m = MAPPING.hills;
      const loud = win.mean('rms', t, m.window);
      const rugged = fbm1(layerNoise(seed, role, 'detail'), t * m.detailFreq, 3);
      const h = m.base + m.loud * loud + m.noiseAmp * shape + m.rugged * loud * rugged;
      return clamp01(lerp(h, MAPPING.silence.plain, 0.6 * silenceAt(win, t)));
    }
    case 'ground': {
      const m = MAPPING.ground;
      const detail = fbm1(layerNoise(seed, role, 'detail'), t * m.detailFreq, 2);
      let h = m.base + m.noiseAmp * shape + m.detailAmp * detail;
      h = lerp(h, MAPPING.silence.plain, 0.7 * silenceAt(win, t));
      h = lerp(h, MAPPING.water.level, riverAt(win, t));
      return clamp01(h);
    }
  }
}

function noiseFreq(role: LayerRole): number {
  switch (role) {
    case 'far-range':
      return MAPPING.far.noiseFreq;
    case 'mid-range':
      return MAPPING.mid.noiseFreq;
    case 'hills':
      return MAPPING.hills.noiseFreq;
    case 'ground':
      return MAPPING.ground.noiseFreq;
  }
}

export interface Crescendo {
  t: number;
  /** 0..1 */
  strength: number;
  kind: 'peak' | 'birds';
}

/**
 * Sudden peaks in loudness between from and to. Scores are taken on a fixed grid of
 * absolute time, and an event must beat every other score within `isolation` seconds,
 * so every chunk finds the same events.
 */
export function findCrescendos(
  win: FrameWindow<Column>,
  seed: number,
  from: number,
  to: number,
): Crescendo[] {
  const c = MAPPING.crescendo;
  const reach = Math.round(c.isolation / c.grid);
  const g0 = Math.ceil(from / c.grid);
  const g1 = Math.floor(to / c.grid);
  const scores = new Float64Array(g1 - g0 + 1 + 2 * reach);
  for (let i = 0; i < scores.length; i++) {
    const t = (g0 - reach + i) * c.grid;
    const now = win.mean('rms', t, c.short);
    const before = win.meanRange('rms', t - c.longFrom, t - c.longTo);
    scores[i] = now - before;
  }
  const out: Crescendo[] = [];
  for (let g = g0; g <= g1; g++) {
    const i = g - g0 + reach;
    const score = scores[i] ?? 0;
    if (score < c.threshold) continue;
    let isPeak = true;
    for (let j = i - reach; j <= i + reach && isPeak; j++) {
      const other = scores[j] ?? 0;
      if (j < i ? other >= score : j > i && other > score) isPeak = false;
    }
    if (!isPeak) continue;
    const t = g * c.grid;
    out.push({
      t,
      strength: clamp01((score - c.threshold) / c.range + 0.3),
      kind: hash01(seed, 'crescendo', t) < c.peakChance ? 'peak' : 'birds',
    });
  }
  return out;
}

function peaksAt(ctx: MapContext, t: number): number {
  const c = MAPPING.crescendo;
  let h = 0;
  for (const e of ctx.crescendos) {
    if (e.kind !== 'peak') continue;
    h = Math.max(h, c.peakHeight * e.strength * bump((t - e.t) / c.peakRadius));
  }
  return h;
}

/** Objects that belong to [t0, t1) on this layer. Each object is owned by exactly one chunk. */
export function objectsFor(
  role: LayerRole,
  t0: number,
  t1: number,
  frames: readonly FeatureFrame[],
  ctx: MapContext,
): WorldObject[] {
  const { seed, win } = ctx;
  const out: WorldObject[] = [];
  const add = (kind: WorldObject['kind'], t: number, size: number) =>
    out.push({
      kind,
      t,
      size: clamp01(size),
      variant: hash01(seed, kind, 'variant', t),
      seed: hashSeed(seed, kind, t),
    });

  if (role === 'hills' || role === 'ground') {
    const g = MAPPING.grass;
    const tr = MAPPING.trees;
    // At most one object per frame and layer. Low and mid onsets win over high ones.
    for (const f of frames) {
      if (f.t < t0 || f.t >= t1) continue;
      const wet = role === 'ground' && waterAt(win, f.t) > 0.3;
      if (wet) continue;

      const strength = Math.max(f.onsetLow, f.onsetMid);
      if (strength > tr.threshold) {
        const onHills = hash01(seed, 'tree-layer', f.t) < tr.hillsShare;
        if (onHills === (role === 'hills')) {
          const rock = f.onsetLow >= f.onsetMid && hash01(seed, 'rock', f.t) < tr.rockChance;
          add(rock ? 'rock' : 'tree', f.t, tr.minSize + (1 - tr.minSize) * strength);
          continue;
        }
      }

      if (role === 'ground' && f.onsetHigh > g.threshold) {
        const small =
          f.onsetHigh > g.smallTreeAbove && hash01(seed, 'small-tree', f.t) < g.smallTreeChance;
        if (small) add('tree', f.t, 0.15 + 0.2 * f.onsetHigh);
        else add('grass', f.t, f.onsetHigh);
      }
    }
  }

  const c = MAPPING.crescendo;
  for (const e of ctx.crescendos) {
    if (role === 'far-range' && e.kind === 'peak' && e.t >= t0 && e.t < t1) {
      add('lone-peak', e.t, e.strength);
    }
    if (role === 'mid-range' && e.kind === 'birds') {
      const count = 3 + Math.floor(hash01(seed, 'flock', e.t) * 5);
      for (let i = 0; i < count; i++) {
        const t = e.t + (hash01(seed, 'bird', e.t, i) * 2 - 0.6) * c.birdSpread;
        if (t >= t0 && t < t1) add('bird', t, 0.3 + 0.5 * e.strength);
      }
    }
  }

  return out.sort((a, b) => a.t - b.t);
}

/**
 * Water on the ground layer, in fixed cells of absolute time. Contiguous cells form one
 * river or lake. Styles may blend widths across neighboring cells.
 */
export function waterFor(t0: number, t1: number, ctx: MapContext): WaterSpan[] {
  const w = MAPPING.water;
  const out: WaterSpan[] = [];
  for (let c = Math.ceil(t0 / w.cell); c * w.cell < t1; c++) {
    const start = c * w.cell;
    const centre = start + w.cell / 2;
    const silence = silenceAt(ctx.win, centre);
    const river = riverAt(ctx.win, centre);
    if (silence > 0.5) {
      out.push({ t0: start, t1: start + w.cell, width: 0.5 + 0.5 * silence, calm: 1 });
    } else if (river > 0.5) {
      const calm = 1 - 0.7 * clamp01(ctx.win.mean('rms', centre, 0.5));
      out.push({ t0: start, t1: start + w.cell, width: river, calm });
    }
  }
  return out;
}

/** The sky at music time t. */
export function skyAt(t: number, win: FrameWindow<Column>, seed: number): SkyState {
  const s = MAPPING.sky;
  const energy =
    0.8 * win.mean('rms', t, s.energyWindow) + 0.4 * win.mean('flux', t, s.energyWindow);
  const mood = smoothstep(0.2, 0.75, energy);
  const tone = win.mean('tone', t, s.toneWindow);
  const quiet = MAPPING.silence;
  const stillness = 1 - smoothstep(quiet.quiet, quiet.loud, win.mean('rms', t, s.mistWindow));
  return {
    mood,
    brightness: clamp01(0.35 + 0.6 * tone - 0.25 * mood),
    cloudiness: clamp01(0.1 + 0.75 * mood + 0.15 * fbm1(hashSeed(seed, 'clouds'), t * 0.03, 2)),
    mist: clamp01(0.1 + 0.8 * stillness),
    warmth: tone,
  };
}
