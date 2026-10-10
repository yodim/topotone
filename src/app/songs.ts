/**
 * Loading a song: decode, analyze in a worker with progress, then hand over a FileSource.
 * A newer file cancels the one still loading. Audio never leaves the device.
 */
import { analyzeInWorker, hopSecondsFor, mixToMono } from '../audio/analysis';
import { FileSource, Track } from '../audio/sources/file';
import type { Status } from './status';

let context: AudioContext | null = null;

/** The shared AudioContext, created on first use. */
export function audioContext(): AudioContext {
  context ??= new AudioContext();
  return context;
}

/** Resolves once the context runs. Browsers only allow that after a click or a key press. */
function whenRunning(ctx: AudioContext, status: Status): Promise<void> {
  if (ctx.state === 'running') return Promise.resolve();
  return ctx.resume().then(
    () => (ctx.state === 'running' ? undefined : waitForGesture(ctx, status)),
    () => waitForGesture(ctx, status),
  );
}

function waitForGesture(ctx: AudioContext, status: Status): Promise<void> {
  status.show('Ready. Click or press any key to start the song.', { stay: true });
  return new Promise((resolve) => {
    const go = () => {
      void ctx.resume().then(() => {
        if (ctx.state !== 'running') return;
        window.removeEventListener('pointerdown', go);
        window.removeEventListener('keydown', go);
        resolve();
      });
    };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  });
}

export class SongLoader {
  private pending: AbortController | null = null;

  constructor(
    private readonly status: Status,
    private readonly onReady: (song: FileSource) => void,
  ) {}

  async load(file: File): Promise<void> {
    this.pending?.abort();
    const job = new AbortController();
    this.pending = job;
    const name = file.name.replace(/\.[^.]+$/, '') || 'this song';
    const ctx = audioContext();
    // Try to unlock audio while we are still inside the drop or click.
    void ctx.resume().catch(() => undefined);

    this.status.show(`Opening ${name}…`, { stay: true });
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      if (job.signal.aborted) return;
      this.status.show(`Could not read ${file.name}. Try an mp3, ogg, wav or m4a file.`, {
        error: true,
      });
      return;
    }
    if (job.signal.aborted) return;

    let frames;
    try {
      frames = await analyzeInWorker(
        mixToMono(buffer),
        buffer.sampleRate,
        (p) => this.status.show(`Listening to ${name}… ${Math.round(p * 100)}%`, { stay: true }),
        job.signal,
      );
    } catch (err) {
      if (job.signal.aborted) return;
      console.error(err);
      this.status.show(`Something went wrong while listening to ${name}.`, { error: true });
      return;
    }
    if (job.signal.aborted || frames.length === 0) return;

    await whenRunning(ctx, this.status);
    if (job.signal.aborted) return;
    this.pending = null;
    const track = new Track(frames, buffer.duration);
    this.onReady(new FileSource(ctx, buffer, track, hopSecondsFor(buffer.sampleRate), name));
    this.status.show(`Playing ${name}. Space to pause.`);
  }
}
