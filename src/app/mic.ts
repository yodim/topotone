/** Turning the microphone on and off, with short friendly messages when it cannot start. */
import { MicSource } from '../audio/sources/mic';
import type { SourceManager } from '../audio/sources/manager';
import { audioContext } from './songs';
import type { Status } from './status';

function reason(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The microphone is blocked, so the landscape keeps going on its own. You can allow it in the browser settings.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found. The landscape keeps going on its own.';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'The microphone is busy, maybe in another app. The landscape keeps going on its own.';
  }
  return 'The microphone could not start. The landscape keeps going on its own.';
}

export class MicSwitch {
  private opening = false;

  constructor(
    private readonly manager: SourceManager,
    private readonly status: Status,
  ) {}

  async toggle(): Promise<void> {
    if (this.manager.kind === 'mic') {
      this.manager.stopCurrent();
      this.status.show('Microphone off.');
      return;
    }
    if (this.opening) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      this.status.show('This browser cannot listen to the microphone.', { error: true });
      return;
    }
    this.opening = true;
    this.status.show('Asking for the microphone…', { stay: true });
    try {
      const ctx = audioContext();
      await ctx.resume();
      const mic = await MicSource.open(ctx);
      this.manager.playSong(mic);
      this.status.show('Listening. Press Mic (or M) to stop.');
    } catch (err) {
      console.warn(err);
      this.status.show(reason(err), { error: true });
    } finally {
      this.opening = false;
    }
  }
}
