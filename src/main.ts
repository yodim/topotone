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
import { STYLES, resolveStyle } from './styles/registry';
import type { Style } from './styles/types';
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
// Each style is set up once, the first time it is used.
const ready = new Set<Style>();
const prepare = async (s: Style) => {
  if (ready.has(s)) return;
  ready.add(s);
  await s.setup?.({ seed, dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR) });
};
await prepare(style);
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

// Keys 1 to 3 pick a style. The land is redrawn and the old style fades out over it.
const STYLE_KEYS = ['paper', 'ink', 'ukiyoe'];
let currentStyle = style;
const switchStyle = async (id: string) => {
  const next = STYLES.get(id);
  if (!next) {
    status.show(`There is no ${id} style yet.`);
    return;
  }
  if (next === currentStyle) return;
  currentStyle = next;
  await prepare(next);
  if (currentStyle !== next) return;
  renderer.setStyle(next);
  status.show(next.name);
  const url = new URL(location.href);
  url.searchParams.set('style', next.id);
  history.replaceState(null, '', url);
};
// Set up the other styles while the page is idle, so the first switch to each is instant.
const warmUp = () => {
  for (const id of STYLE_KEYS) {
    const s = STYLES.get(id);
    if (s) void prepare(s);
  }
};
if ('requestIdleCallback' in window) requestIdleCallback(warmUp, { timeout: 1500 });
else setTimeout(warmUp, 1500);
const styleKeys = Object.fromEntries(
  STYLE_KEYS.map((id, i) => [String(i + 1), () => void switchStyle(id)]),
);

const songs = new SongLoader(status, (song) => manager.playSong(song));
bindFiles(fileInput, (file) => void songs.load(file));

bindKeys({
  ...styleKeys,
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
  style: () => currentStyle.id,
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
