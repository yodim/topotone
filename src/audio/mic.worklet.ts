/**
 * Runs on the audio thread. Collects the mic input into 512-sample blocks (mixed down to
 * mono) and posts them to the page with their absolute frame index. It never writes to its
 * output, so nothing from the mic can reach the speakers.
 */

// AudioWorkletGlobalScope is not in the DOM typings; these are the parts used here.
declare const currentFrame: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const BLOCK = 512;

class MicCollector extends AudioWorkletProcessor {
  private block = new Float32Array(BLOCK);
  private fill = 0;
  private blockStart = 0;

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    const first = channels?.[0];
    if (!channels || !first) return true;
    for (let i = 0; i < first.length; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i] ?? 0;
      if (this.fill === 0) this.blockStart = currentFrame + i;
      this.block[this.fill++] = sum / channels.length;
      if (this.fill === BLOCK) {
        this.port.postMessage({ start: this.blockStart, samples: this.block }, [this.block.buffer]);
        this.block = new Float32Array(BLOCK);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('topotone-mic', MicCollector);

export {};
