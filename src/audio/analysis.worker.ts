/** Offline analysis of a whole track. See analysis.ts for the main-thread side. */
import { analyzeTrack, packFrames, type WorkerMessage } from './analysis';

interface WorkerScope {
  onmessage: ((e: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => void) | null;
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { samples, sampleRate } = e.data;
  try {
    let last = -1;
    const frames = analyzeTrack(samples, sampleRate, (value) => {
      // Throttle to whole percents.
      const percent = Math.floor(value * 100);
      if (percent === last) return;
      last = percent;
      scope.postMessage({ type: 'progress', value });
    });
    const packed = packFrames(frames);
    scope.postMessage({ type: 'done', packed }, [packed.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
