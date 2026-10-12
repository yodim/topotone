/**
 * Live microphone input. The browser's echo cancellation, noise suppression and auto gain are
 * turned off, because they mangle music. Samples go through an AudioWorklet to the streaming
 * analyzer; the mic is never connected to the speakers.
 */
import type { FeatureFrame, FeatureSource } from '../features';
import { FrameStore } from '../framestore';
import { StreamAnalyzer } from '../stream';
import workletUrl from '../mic.worklet.ts?worker&url';

const loaded = new WeakSet<BaseAudioContext>();

export class MicSource implements FeatureSource {
  readonly kind = 'mic' as const;
  readonly name = 'microphone';
  readonly duration = Infinity;
  readonly hopSeconds: number;
  /** Every frame heard so far, packed: the export can rebuild the whole session. */
  private readonly history = new FrameStore();
  private readonly analyzer: StreamAnalyzer;
  /** Context frame index of the first sample, once known. */
  private firstFrame: number | null = null;
  private stopped = false;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
    private readonly input: MediaStreamAudioSourceNode,
    private readonly node: AudioWorkletNode,
    private readonly sink: GainNode,
  ) {
    this.analyzer = new StreamAnalyzer(ctx.sampleRate, (f) => this.history.push(f));
    this.hopSeconds = this.analyzer.hopSeconds;
    node.port.onmessage = (e: MessageEvent<{ start: number; samples: Float32Array }>) => {
      if (this.stopped) return;
      this.firstFrame ??= e.data.start;
      this.analyzer.push(e.data.samples);
    };
  }

  /** Asks for the mic and starts listening. Rejects when access is denied or no mic exists. */
  static async open(ctx: AudioContext): Promise<MicSource> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    try {
      if (!loaded.has(ctx)) {
        await ctx.audioWorklet.addModule(workletUrl);
        loaded.add(ctx);
      }
      const input = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'topotone-mic', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      // Some browsers only run a node that leads to the output. A gain of exactly 0 keeps it
      // running without letting a single sample through: no feedback, ever.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      input.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);
      return new MicSource(ctx, stream, input, node, sink);
    } catch (err) {
      for (const track of stream.getTracks()) track.stop();
      throw err;
    }
  }

  get playing(): boolean {
    return !this.stopped;
  }

  get ended(): boolean {
    return this.stopped;
  }

  /** Seconds since the first sample arrived. */
  now(): number {
    if (this.firstFrame === null) return 0;
    return Math.max(0, this.ctx.currentTime - this.firstFrame / this.ctx.sampleRate);
  }

  /** Source time up to which frames are final. */
  knownUntil(): number {
    const n = this.history.length;
    return n > 0 ? this.history.timeOf(n - 1) + this.hopSeconds : 0;
  }

  frames(from: number, to: number): FeatureFrame[] {
    return this.history.slice(this.history.indexAt(from), this.history.indexAt(to));
  }

  /** The frame in effect at t. Past the newest frame, the newest one holds. */
  frameAt(t: number): FeatureFrame {
    const n = this.history.length;
    if (n > 0) {
      return this.history.frame(Math.min(Math.max(this.history.indexAt(t + 1e-9) - 1, 0), n - 1));
    }
    return {
      t,
      rms: 0,
      low: 0,
      mid: 0,
      high: 0,
      centroid: 0,
      flux: 0,
      onset: 0,
      onsetLow: 0,
      onsetMid: 0,
      onsetHigh: 0,
      pitch: null,
      pitchConfidence: 0,
    };
  }

  lookahead(): number {
    return 0;
  }

  /** The mic cannot be paused; these keep the Song shape. */
  play(): void {}
  pause(): void {}

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.node.port.onmessage = null;
    this.input.disconnect();
    this.node.disconnect();
    this.sink.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
  }
}
