/**
 * A song file: its analyzed frames plus playback through Web Audio. The clock follows
 * AudioContext.currentTime, corrected for output latency, so the playhead shows what is
 * heard rather than what was just handed to the sound card.
 */
import type { FeatureFrame, FeatureSource } from '../features';

/** The analyzed frames of a song, in source time. */
export class Track {
  constructor(
    readonly frames: readonly FeatureFrame[],
    readonly duration: number,
  ) {}

  /** Index of the first frame with t >= time. */
  private indexAt(time: number): number {
    let lo = 0;
    let hi = this.frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.frames[mid] as FeatureFrame).t < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Frames with t in [from, to). */
  range(from: number, to: number): FeatureFrame[] {
    return this.frames.slice(this.indexAt(from), this.indexAt(to));
  }

  /** The frame in effect at time t: the last one at or before it, clamped to the track. */
  at(t: number): FeatureFrame {
    const i = Math.min(Math.max(this.indexAt(t + 1e-9) - 1, 0), this.frames.length - 1);
    const frame = this.frames[i];
    if (!frame) throw new Error('empty track');
    return frame;
  }
}

export class FileSource implements FeatureSource {
  readonly kind = 'file' as const;
  readonly duration: number;
  private node: AudioBufferSourceNode | null = null;
  /** Context time at which source time 0 was (or would have been) played. */
  private startedAt = 0;
  /** Source time while paused, and the floor right after resuming. */
  private position = 0;
  private holdUntilPast = 0;
  private state: 'ready' | 'playing' | 'paused' | 'ended' = 'ready';

  constructor(
    private readonly ctx: AudioContext,
    private readonly buffer: AudioBuffer,
    readonly track: Track,
    readonly hopSeconds: number,
    readonly name: string,
  ) {
    this.duration = buffer.duration;
  }

  get playing(): boolean {
    return this.state === 'playing';
  }

  get ended(): boolean {
    return this.state === 'ended';
  }

  play(): void {
    if (this.state === 'playing' || this.state === 'ended') return;
    const node = this.ctx.createBufferSource();
    node.buffer = this.buffer;
    node.connect(this.ctx.destination);
    node.onended = () => {
      if (this.node !== node) return;
      this.node = null;
      this.position = this.duration;
      this.state = 'ended';
    };
    this.startedAt = this.ctx.currentTime - this.position;
    // Right after a resume the latency-corrected clock reads a little behind the pause
    // position; hold the position until it catches up, so time never runs backwards.
    this.holdUntilPast = this.position;
    node.start(0, this.position);
    this.node = node;
    this.state = 'playing';
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.position = this.now();
    this.release();
    this.state = 'paused';
  }

  /** Stops for good, for example when another song replaces this one. */
  stop(): void {
    if (this.state === 'playing') this.position = this.now();
    this.release();
    this.state = 'ended';
  }

  now(): number {
    if (this.state !== 'playing') return this.position;
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    const t = this.ctx.currentTime - this.startedAt - latency;
    return Math.min(this.duration, Math.max(t, this.holdUntilPast));
  }

  frames(from: number, to: number): FeatureFrame[] {
    return this.track.range(from, to);
  }

  frameAt(t: number): FeatureFrame {
    return this.track.at(t);
  }

  lookahead(): number {
    return this.duration - this.now();
  }

  private release(): void {
    if (!this.node) return;
    const node = this.node;
    this.node = null;
    node.onended = null;
    node.stop();
    node.disconnect();
  }
}
