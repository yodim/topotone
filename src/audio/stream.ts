/**
 * Feature extraction for live input. Same frames, same extractor and the same onset rules as
 * for songs, but everything looks back only: normalization uses the last 30 seconds, and the
 * onset median trails the frame.
 *
 * A frame is emitted once nothing can change it any more. That takes the frame's right half
 * (2 hops), the peak check (3 hops) and the onset snapping (6 hops, minus the 1 hop lag):
 * about 10 hops, or 116 ms at 44.1 kHz.
 */
import type { FeatureFrame } from './features';
import {
  FRAME_SIZE,
  FrameAnalyzer,
  HOP_SIZE,
  ONSET_DEFAULTS,
  onsetAt,
  type RawFrame,
} from './extractor';
import {
  ONSET_LAG_FRAMES,
  ONSET_SNAP_FRAMES,
  normalizeFrame,
  onsetsAt,
  trackStats,
  type TrackStats,
} from './normalize';

/** Seconds of history the running statistics look at. */
const STATS_SECONDS = 30;
/** Statistics are refreshed this often, in frames (about twice a second). */
const STATS_EVERY = 43;
/** Before this many frames, nothing is emitted: the statistics would be meaningless. */
const WARMUP_FRAMES = 20;

const PEAK = ONSET_DEFAULTS.peakFrames;
/** Frames between the newest analyzed frame and the newest frame that can be emitted. */
export const STREAM_DELAY_FRAMES = PEAK + 2 * ONSET_SNAP_FRAMES - ONSET_LAG_FRAMES;

type FluxKey = 'flux' | 'fluxLow' | 'fluxMid' | 'fluxHigh';
const FLUX_KEYS: readonly FluxKey[] = ['flux', 'fluxLow', 'fluxMid', 'fluxHigh'];

export class StreamAnalyzer {
  private readonly analyzer: FrameAnalyzer;
  private readonly frame = new Float32Array(FRAME_SIZE);
  private readonly statsFrames: number;

  // Samples, with the absolute index of samples[0].
  private samples = new Float32Array(FRAME_SIZE * 4);
  private sampleStart = 0;
  private sampleCount = 0;

  /** Absolute index of the next frame to analyze. */
  private next = 0;
  /** Absolute index of the next frame to emit. */
  private emitted = 0;

  // Per-frame history, with the absolute index of element 0.
  private base = 0;
  private raw: RawFrame[] = [];
  private normalized: FeatureFrame[] = [];
  private flux: Record<FluxKey, number[]> = { flux: [], fluxLow: [], fluxMid: [], fluxHigh: [] };
  private picks: Record<FluxKey, number[]> = { flux: [], fluxLow: [], fluxMid: [], fluxHigh: [] };
  private stats: TrackStats | null = null;
  private readonly scratch: number[] = [];

  constructor(
    readonly sampleRate: number,
    private readonly onFrame: (frame: FeatureFrame) => void,
  ) {
    this.analyzer = new FrameAnalyzer(sampleRate);
    this.statsFrames = Math.round((STATS_SECONDS * sampleRate) / HOP_SIZE);
  }

  /** Seconds between frames. */
  get hopSeconds(): number {
    return HOP_SIZE / this.sampleRate;
  }

  /** Adds samples that follow on from the previous ones, in any block size. */
  push(block: Float32Array): void {
    this.append(block);
    // Frame k is centred on sample k * HOP_SIZE and needs FRAME_SIZE / 2 samples after it.
    while (this.next * HOP_SIZE + FRAME_SIZE / 2 <= this.sampleStart + this.sampleCount) {
      this.analyzeNext();
    }
  }

  private append(block: Float32Array): void {
    // Keep only what the next frame still needs.
    const keepFrom = this.next * HOP_SIZE - FRAME_SIZE / 2;
    const drop = Math.max(0, Math.min(this.sampleCount, keepFrom - this.sampleStart));
    if (drop > 0) {
      this.samples.copyWithin(0, drop, this.sampleCount);
      this.sampleCount -= drop;
      this.sampleStart += drop;
    }
    if (this.sampleCount + block.length > this.samples.length) {
      const bigger = new Float32Array((this.sampleCount + block.length) * 2);
      bigger.set(this.samples.subarray(0, this.sampleCount));
      this.samples = bigger;
    }
    this.samples.set(block, this.sampleCount);
    this.sampleCount += block.length;
  }

  private analyzeNext(): void {
    const k = this.next++;
    const start = k * HOP_SIZE - FRAME_SIZE / 2;
    for (let i = 0; i < FRAME_SIZE; i++) {
      const at = start + i - this.sampleStart;
      this.frame[i] = at >= 0 && at < this.sampleCount ? (this.samples[at] as number) : 0;
    }
    const raw = this.analyzer.analyze(this.frame, (k * HOP_SIZE) / this.sampleRate);
    this.raw.push(raw);

    if (this.stats === null ? this.raw.length >= WARMUP_FRAMES : k % STATS_EVERY === 0) {
      this.stats = trackStats(this.raw.slice(-this.statsFrames));
    }
    const stats = this.stats;
    if (!stats) {
      // Still warming up: hold everything until the statistics exist.
      for (const key of FLUX_KEYS) this.flux[key].push(0);
      this.normalized.push(normalizeFrame(raw, trackStats([raw])));
    } else {
      for (const key of FLUX_KEYS) this.flux[key].push(Math.min(1, raw[key] / stats[key]));
      this.normalized.push(normalizeFrame(raw, stats));
    }

    // The peak check for frame k - PEAK can run now.
    const j = k - PEAK - this.base;
    if (j >= 0) {
      for (const key of FLUX_KEYS) {
        this.picks[key][j] = onsetAt(this.flux[key], j, ONSET_DEFAULTS, true, this.scratch);
      }
    }

    // Emit every frame whose onsets are final.
    const ready = k - STREAM_DELAY_FRAMES;
    const picks = {
      all: this.picks.flux,
      low: this.picks.fluxLow,
      mid: this.picks.fluxMid,
      high: this.picks.fluxHigh,
    };
    while (this.emitted <= ready) {
      const f = this.emitted++;
      if (f < WARMUP_FRAMES) continue;
      const frame = this.normalized[f - this.base];
      if (frame) this.onFrame({ ...frame, ...onsetsAt(f - this.base, picks) });
    }
    this.trim();
  }

  /** Drops history nothing looks at any more, now and then. */
  private trim(): void {
    const keep = Math.max(this.statsFrames, 2 * ONSET_DEFAULTS.medianFrames + 32);
    const excess = this.raw.length - keep;
    if (excess < 1024) return;
    // Never drop frames that still have to be emitted or that onset snapping can reach.
    const limit = this.emitted - this.base - ONSET_SNAP_FRAMES * 2 - 1;
    const drop = Math.min(excess, limit);
    if (drop <= 0) return;
    this.base += drop;
    this.raw = this.raw.slice(drop);
    this.normalized = this.normalized.slice(drop);
    for (const key of FLUX_KEYS) {
      this.flux[key] = this.flux[key].slice(drop);
      this.picks[key] = this.picks[key].slice(drop);
    }
  }
}
