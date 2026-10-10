/**
 * Puts the sources on one continuous timeline of world (music) time.
 *
 * The synthetic source fills all time by default. Playing a song cuts the timeline at the
 * current moment: the song runs from there for its duration, then the synthetic source takes
 * over again. Features blend over BLEND_SECONDS after each cut, so the land never jumps.
 * The whole future is known as soon as a song starts, including its end and the hand-back.
 *
 * The world is frozen per timeline. Changing the timeline calls onTimelineChange, which
 * rebuilds the world and fades the new land in.
 */
import { lerp, smoothstep } from '../../core/math';
import type { FeatureFrame, FeatureSource, FeatureSourceKind } from '../features';
import type { SyntheticSource } from './synthetic';

export const BLEND_SECONDS = 2;

/** What the manager needs from a song. FileSource implements it; tests use fakes. */
export interface Song extends FeatureSource {
  readonly duration: number;
  readonly name: string;
  readonly playing: boolean;
  readonly ended: boolean;
  frameAt(t: number): FeatureFrame;
  play(): void;
  pause(): void;
  stop(): void;
  /** Live sources only: source time up to which frames are final. */
  knownUntil?(): number;
}

interface Segment {
  start: number;
  end: number;
  /** null for the synthetic source. */
  song: Song | null;
}

export function blendFrames(a: FeatureFrame, b: FeatureFrame, w: number): FeatureFrame {
  return {
    t: b.t,
    rms: lerp(a.rms, b.rms, w),
    low: lerp(a.low, b.low, w),
    mid: lerp(a.mid, b.mid, w),
    high: lerp(a.high, b.high, w),
    centroid: lerp(a.centroid, b.centroid, w),
    flux: lerp(a.flux, b.flux, w),
    onset: lerp(a.onset, b.onset, w),
    onsetLow: lerp(a.onsetLow, b.onsetLow, w),
    onsetMid: lerp(a.onsetMid, b.onsetMid, w),
    onsetHigh: lerp(a.onsetHigh, b.onsetHigh, w),
    pitch: w < 0.5 ? a.pitch : b.pitch,
    pitchConfidence: lerp(a.pitchConfidence, b.pitchConfidence, w),
  };
}

export class SourceManager implements FeatureSource {
  readonly hopSeconds: number;
  /** Called after the timeline changed: the world must be rebuilt. */
  onTimelineChange: (() => void) | null = null;
  private segments: Segment[] = [{ start: -Infinity, end: Infinity, song: null }];
  private current: { song: Song; start: number } | null = null;
  /** World time while no song drives the clock. */
  private freeTime = 0;
  private paused = false;

  constructor(
    readonly synthetic: SyntheticSource,
    private readonly speed = 1,
  ) {
    this.hopSeconds = synthetic.hopSeconds;
  }

  get kind(): FeatureSourceKind {
    return this.current ? this.current.song.kind : 'synthetic';
  }

  /** The song currently driving the clock, if any. */
  get song(): Song | null {
    return this.current?.song ?? null;
  }

  get isPaused(): boolean {
    return this.current ? !this.current.song.playing : this.paused;
  }

  /** Advances the free-running clock. When a song ends, time carries on from its end. */
  tick(dt: number): void {
    const c = this.current;
    if (c) {
      if (!c.song.ended || !Number.isFinite(c.song.duration)) return;
      this.freeTime = c.start + c.song.duration;
      this.current = null;
    }
    if (!this.paused) this.freeTime += dt * this.speed;
  }

  now(): number {
    const c = this.current;
    return c ? c.start + c.song.now() : this.freeTime;
  }

  lookahead(): number {
    return Infinity;
  }

  /** World time up to which the features are final. Infinite unless a live source runs. */
  liveUntil(): number {
    const c = this.current;
    return c?.song.knownUntil ? c.start + c.song.knownUntil() : Infinity;
  }

  /**
   * Starts a song, or a live source (infinite duration), at the current moment. The synthetic
   * source takes over at the song's end.
   */
  playSong(song: Song): void {
    const t = this.cut();
    const end = t + song.duration;
    this.segments.push({ start: t, end, song });
    if (Number.isFinite(end)) this.segments.push({ start: end, end: Infinity, song: null });
    this.current = { song, start: t };
    this.paused = false;
    song.play();
    this.onTimelineChange?.();
  }

  /** Stops the current song or live source and hands back to the synthetic source now. */
  stopCurrent(): void {
    if (!this.current) return;
    this.cut();
    this.segments.push({ start: this.freeTime, end: Infinity, song: null });
    this.onTimelineChange?.();
  }

  /** Pauses or resumes. Returns false when the current source cannot pause (the mic). */
  togglePause(): boolean {
    const c = this.current;
    if (!c) {
      this.paused = !this.paused;
      return true;
    }
    if (c.song.kind === 'mic') return false;
    if (c.song.playing) c.song.pause();
    else c.song.play();
    return true;
  }

  /** Ends the timeline at the current moment, stopping whatever plays. Returns that moment. */
  private cut(): number {
    const t = this.now();
    if (this.current) {
      this.current.song.stop();
      this.current = null;
    }
    this.freeTime = t;
    this.segments = this.segments
      .filter((s) => s.start < t)
      .map((s) => ({ ...s, end: Math.min(s.end, t) }));
    return t;
  }

  frames(from: number, to: number): FeatureFrame[] {
    const out: FeatureFrame[] = [];
    this.segments.forEach((seg, i) => {
      const a = Math.max(from, seg.start);
      const b = Math.min(to, seg.end);
      if (!(b > a)) return;
      const prev = i > 0 ? this.segments[i - 1] : undefined;
      for (const f of this.segmentFrames(seg, a, b)) {
        if (prev && f.t < seg.start + BLEND_SECONDS) {
          const w = smoothstep(seg.start, seg.start + BLEND_SECONDS, f.t);
          out.push(blendFrames(this.valueAt(prev, f.t), f, w));
        } else {
          out.push(f);
        }
      }
    });
    return out;
  }

  /** Frames of one segment with world time in [a, b). */
  private segmentFrames(seg: Segment, a: number, b: number): FeatureFrame[] {
    if (!seg.song) return this.synthetic.frames(a, b);
    // Select by world time after mapping, so adjacent ranges never share or drop a frame.
    const eps = 1e-6;
    const out: FeatureFrame[] = [];
    for (const f of seg.song.frames(a - seg.start - eps, b - seg.start + eps)) {
      const t = seg.start + f.t;
      if (t >= a && t < b) out.push({ ...f, t });
    }
    return out;
  }

  /** A segment's value at any world time, holding a song's last frame past its end. */
  private valueAt(seg: Segment, t: number): FeatureFrame {
    if (!seg.song) return this.synthetic.frameAt(t);
    return { ...seg.song.frameAt(t - seg.start), t };
  }
}
