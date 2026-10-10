/**
 * Analysis of a whole song, off the main thread. The decoded samples go to a worker, which
 * runs the extractor and normalization and sends back packed frames with progress updates.
 */
import type { FeatureFrame } from './features';
import { HOP_SIZE, analyzeSamples } from './extractor';
import { normalizeTrack } from './normalize';

const FIELDS = 13;

/** Frames as one flat Float64Array, cheap to transfer between threads. NaN means no pitch. */
export function packFrames(frames: readonly FeatureFrame[]): Float64Array {
  const out = new Float64Array(frames.length * FIELDS);
  frames.forEach((f, i) => {
    out.set(
      [
        f.t,
        f.rms,
        f.low,
        f.mid,
        f.high,
        f.centroid,
        f.flux,
        f.onset,
        f.onsetLow,
        f.onsetMid,
        f.onsetHigh,
        f.pitch ?? Number.NaN,
        f.pitchConfidence,
      ],
      i * FIELDS,
    );
  });
  return out;
}

export function unpackFrames(data: Float64Array): FeatureFrame[] {
  const out: FeatureFrame[] = [];
  for (let o = 0; o + FIELDS <= data.length; o += FIELDS) {
    const v = (k: number) => data[o + k] as number;
    out.push({
      t: v(0),
      rms: v(1),
      low: v(2),
      mid: v(3),
      high: v(4),
      centroid: v(5),
      flux: v(6),
      onset: v(7),
      onsetLow: v(8),
      onsetMid: v(9),
      onsetHigh: v(10),
      pitch: Number.isNaN(v(11)) ? null : v(11),
      pitchConfidence: v(12),
    });
  }
  return out;
}

export function hopSecondsFor(sampleRate: number): number {
  return HOP_SIZE / sampleRate;
}

/** The whole pipeline on the current thread. Used by the worker and by tests. */
export function analyzeTrack(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): FeatureFrame[] {
  return normalizeTrack(analyzeSamples(samples, sampleRate, onProgress));
}

/** Averages all channels into one. */
export function mixToMono(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) + (data[i] as number);
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / buffer.numberOfChannels;
  }
  return out;
}

export type WorkerMessage =
  | { type: 'progress'; value: number }
  | { type: 'done'; packed: Float64Array }
  | { type: 'error'; message: string };

/** Runs the analysis in a worker. The samples buffer is transferred, not copied. */
export function analyzeInWorker(
  samples: Float32Array,
  sampleRate: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<FeatureFrame[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => worker.terminate();
    signal?.addEventListener('abort', () => {
      finish();
      reject(new DOMException('Analysis cancelled', 'AbortError'));
    });
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'progress') onProgress(msg.value);
      else if (msg.type === 'done') {
        finish();
        resolve(unpackFrames(msg.packed));
      } else {
        finish();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || 'Analysis failed'));
    };
    worker.postMessage({ samples, sampleRate }, [samples.buffer]);
  });
}
