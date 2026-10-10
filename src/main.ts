import { bindControls } from './app/controls';
import { bindFiles } from './app/files';
import { bindKeys } from './app/keyboard';
import { Meters } from './app/meters';
import { MicSwitch } from './app/mic';
import { parseParams, seedFromText } from './app/params';
import { SongLoader, audioContext } from './app/songs';
import { Status } from './app/status';
import { createTunePanel, restoreTuning } from './app/tune';
import { SourceManager } from './audio/sources/manager';
import { SyntheticSource } from './audio/sources/synthetic';
import { randomSeed } from './core/rng';
import { MAX_DPR, Renderer, startLoop } from './render/engine';
import { resolveStyle } from './styles/registry';
import { World } from './world/generator';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const statusEl = document.querySelector<HTMLElement>('#status');
const fileInput = document.querySelector<HTMLInputElement>('#file-input');
const controlsEl = document.querySelector<HTMLElement>('#controls');
if (!canvas || !statusEl || !fileInput || !controlsEl) throw new Error('Missing page elements');

const params = parseParams(location.search);
const seed = params.seedText === null ? randomSeed() : seedFromText(params.seedText);
if (params.seedText === null) {
  // Put the seed in the address bar, so a reload or a shared link shows the same world.
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  history.replaceState(null, '', url);
}

const style = resolveStyle(params.style);
if (params.style && params.style !== style.id) {
  console.warn(`Unknown style "${params.style}", using "${style.id}" instead.`);
}

// Tuned values from an earlier ?tune session apply before anything is built.
if (params.tune) restoreTuning();

const status = new Status(statusEl);
const synthetic: SyntheticSource = new SyntheticSource(seed, (): number => manager.now());
const manager: SourceManager = new SourceManager(synthetic, params.speed);
const world = new World(seed, manager, () => manager.liveUntil());
await style.setup?.({ seed, dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR) });
const renderer = new Renderer(world, style);
const meters = new Meters(manager, seed);

// A new song, or the mic, means a new timeline: rebuild the world and fade the new land in.
// Live input needs windows that only look back, so the land never changes once drawn.
const rebuild = () => {
  world.reset(manager.kind === 'mic');
  renderer.reset();
};
manager.onTimelineChange = rebuild;
const tune = params.tune ? createTunePanel(rebuild) : null;
const mic = new MicSwitch(manager, status);
const controls = bindControls(controlsEl, {
  song: () => fileInput.click(),
  mic: () => void mic.toggle(),
});

const songs = new SongLoader(status, (song) => manager.playSong(song));
bindFiles(fileInput, (file) => void songs.load(file));

bindKeys({
  d: () => meters.toggle(),
  t: () => tune?.toggle(),
  o: () => fileInput.click(),
  m: () => void mic.toggle(),
  ' ': () => {
    if (manager.song) void audioContext().resume();
    if (!manager.togglePause()) {
      status.show('The microphone cannot pause. Press M to stop it.');
      return;
    }
    if (manager.isPaused) status.show('Paused. Space to continue.', { stay: true });
    else status.hide();
  },
});

startLoop(canvas, (ctx, frame) => {
  manager.tick(frame.dt);
  const now = manager.now();
  // Live input has no future to show: the playhead moves near the right edge.
  renderer.setPlayhead(manager.kind === 'mic' ? 0.92 : 0.5);
  controls.setMicOn(manager.kind === 'mic');
  renderer.render(ctx, frame.surface, now, frame.time, manager.liveUntil());
  meters.update(now, frame.dt);
  if (meters.visible) {
    const { cssWidth, cssHeight } = frame.surface;
    meters.drawPlayhead(ctx, cssWidth * renderer.playheadFraction, cssHeight);
    meters.draw(ctx, cssHeight);
  }
});

window.topotone = {
  seed,
  stats: () => ({ now: manager.now(), fps: meters.fps, ...world.stats(), ...renderer.stats() }),
  source: () => ({
    kind: manager.kind,
    now: manager.now(),
    paused: manager.isPaused,
    song: manager.song?.name ?? null,
    live: manager.liveUntil(),
  }),
  onsets: (from, to, min = 0.3) =>
    manager
      .frames(from, to)
      .filter((f) => f.onset >= min)
      .map((f) => f.t),
};
