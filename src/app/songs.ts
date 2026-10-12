/**
 * Loading a song: check the file, decode, analyze in a worker with progress, then hand over
 * a FileSource. A newer file cancels the one still loading. Audio never leaves the device.
 *
 * Phones need care. Safari on iOS only lets a page start sound inside a tap, mutes it with the
 * ringer switch unless told otherwise, and can leave it stopped after the page was in the
 * background. The helpers below deal with each.
 */
import { analyzeInWorker, hopSecondsFor, mixToMono } from '../audio/analysis';
import { FileSource, Track } from '../audio/sources/file';
import { SILENCE_PEAK, checkSongFile, peak } from './audiofile';
import { isTouch } from './device';
import type { Status } from './status';

let context: AudioContext | null = null;

/** False in a browser without Web Audio, where songs and the mic cannot work. */
export function canPlayAudio(): boolean {
  return typeof AudioContext !== 'undefined';
}

/** The shared AudioContext, created on first use. */
export function audioContext(): AudioContext {
  context ??= new AudioContext();
  return context;
}

/**
 * Call inside a tap or click: wakes the audio context while the browser allows it. A song
 * takes a while to analyze, so the Song button does this before the file picker opens.
 */
export function unlockAudio(): void {
  if (!canPlayAudio()) return;
  const ctx = audioContext();
  if (ctx.state === 'running') return;
  void ctx.resume().catch(() => undefined);
  // Older iOS also wants a sound started inside the gesture: one silent sample.
  const source = ctx.createBufferSource();
  source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  source.connect(ctx.destination);
  source.start();
}

/**
 * Safari's audio session. 'playback' lets a song be heard with the ringer switch on silent;
 * the mic needs 'play-and-record'. Other browsers have none, and this does nothing there.
 */
export function setAudioSession(type: 'playback' | 'play-and-record'): void {
  const session = navigator.audioSession;
  if (!session || session.type === type) return;
  try {
    session.type = type;
  } catch (err) {
    console.warn(err);
  }
}

let waiting: Promise<void> | null = null;

/**
 * Resolves once the context runs: right away, after a resume, or after the next tap, click
 * or key when the browser wants a gesture. The message stays until then.
 */
function whenRunning(ctx: AudioContext, status: Status, message: string): Promise<void> {
  if (ctx.state === 'running') return Promise.resolve();
  return ctx.resume().then(
    () => (ctx.state === 'running' ? undefined : waitForGesture(ctx, status, message)),
    () => waitForGesture(ctx, status, message),
  );
}

function waitForGesture(ctx: AudioContext, status: Status, message: string): Promise<void> {
  status.show(message, { stay: true });
  waiting ??= new Promise<void>((resolve) => {
    const done = () => {
      if (ctx.state !== 'running') return;
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
      ctx.removeEventListener('statechange', done);
      waiting = null;
      resolve();
    };
    const go = () => void ctx.resume().then(done);
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
    // Safari may also resume on its own, after an interruption ends.
    ctx.addEventListener('statechange', done);
  });
  return waiting;
}

/**
 * Keeps a playing song audible when the page comes back from the background: iOS stops the
 * audio meanwhile and does not always start it again.
 */
export function keepSongsPlaying(status: Status, songPlaying: () => boolean): void {
  const check = () => {
    const ctx = context;
    if (document.hidden || !ctx || ctx.state === 'running' || !songPlaying()) return;
    const message = isTouch()
      ? 'Tap anywhere to continue the song.'
      : 'Click or press any key to continue the song.';
    void whenRunning(ctx, status, message).then(() => status.hideIf(message));
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('pageshow', check);
}

export class SongLoader {
  private pending: AbortController | null = null;

  constructor(
    private readonly status: Status,
    private readonly onReady: (song: FileSource) => void,
  ) {}

  async load(file: File): Promise<void> {
    if (!canPlayAudio()) {
      this.status.show('This browser cannot play songs. The landscape keeps going on its own.', {
        error: true,
      });
      return;
    }
    const problem = checkSongFile(file);
    if (problem) {
      this.status.show(problem, { error: true });
      return;
    }
    this.pending?.abort();
    const job = new AbortController();
    this.pending = job;
    const name = file.name.replace(/\.[^.]+$/, '') || 'this song';
    const ctx = audioContext();
    setAudioSession('playback');
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
    const mono = mixToMono(buffer);
    if (mono.length === 0) {
      this.status.show(`${file.name} is empty.`, { error: true });
      return;
    }
    if (peak(mono) < SILENCE_PEAK) {
      this.status.show(`${file.name} is silent, so there is nothing to follow.`, { error: true });
      return;
    }

    let frames;
    try {
      frames = await analyzeInWorker(
        mono,
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
    if (job.signal.aborted) return;
    if (frames.length === 0) {
      this.status.show(`${file.name} is too short to draw anything.`, { error: true });
      return;
    }

    const ready = isTouch()
      ? 'Ready. Tap anywhere to start the song.'
      : 'Ready. Click or press any key to start the song.';
    await whenRunning(ctx, this.status, ready);
    if (job.signal.aborted) return;
    this.pending = null;
    const track = new Track(frames, buffer.duration);
    this.onReady(new FileSource(ctx, buffer, track, hopSecondsFor(buffer.sampleRate), name));
    this.status.show(isTouch() ? `Playing ${name}.` : `Playing ${name}. Space to pause.`);
  }
}
