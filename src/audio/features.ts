/**
 * The audio contract. Every audio source (synthetic, file, mic) emits FeatureFrames,
 * and the world generator only ever sees these frames, never raw audio.
 *
 * Change this file only deliberately. Record any change in PLAN.md.
 */

/** One analysis frame. Values are normalized to 0..1 unless noted. */
export interface FeatureFrame {
  /** Seconds from source start. */
  t: number;
  /** Loudness. */
  rms: number;
  /** Band energy below about 250 Hz. */
  low: number;
  /** Band energy from about 250 Hz to 2 kHz. */
  mid: number;
  /** Band energy above about 2 kHz. */
  high: number;
  /** Brightness, on a log-frequency scale. */
  centroid: number;
  /** Spectral change, the raw onset strength. */
  flux: number;
  /** Strongest onset across the whole spectrum. 0 when there is none, otherwise its strength. */
  onset: number;
  /** Onset in the low band (kicks, bass notes). 0 when there is none. */
  onsetLow: number;
  /** Onset in the mid band (strong notes, snares). 0 when there is none. */
  onsetMid: number;
  /** Onset in the high band (hi-hats, plucks). 0 when there is none. */
  onsetHigh: number;
  /** Pitch on a log-frequency scale 0..1, null when unvoiced or unsure. */
  pitch: number | null;
  pitchConfidence: number;
}

export type FeatureSourceKind = 'synthetic' | 'file' | 'mic';

export interface FeatureSource {
  readonly kind: FeatureSourceKind;
  /**
   * Seconds between consecutive frames. Mapping uses it to express smoothing in seconds,
   * so the world reacts the same way whichever source is running.
   */
  readonly hopSeconds: number;
  /** Current source time in seconds. File and mic use the AudioContext clock. */
  now(): number;
  /** Frames with t in [from, to), in time order. */
  frames(from: number, to: number): FeatureFrame[];
  /** Seconds available ahead of now(): Infinity for synthetic, rest of track for file, 0 for mic. */
  lookahead(): number;
}
