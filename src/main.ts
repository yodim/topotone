import { About } from './app/about';
import { bindControls } from './app/controls';
import { Exporter } from './app/exporter';
import { bindFiles } from './app/files';
import {
  canFullscreen,
  isFullscreen,
  onFullscreenChange,
  toggleFullscreen,
} from './app/fullscreen';
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

const find = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing ${selector} on the page`);
  return el;
};
const canvas = find<HTMLCanvasElement>('#stage');
const fileInput = find<HTMLInputElement>('#file-input');

/** Writes a value into the address bar, so a reload or a shared link shows the same thing. */
const setParam = (key: string, value: string) => {
  const url = new URL(location.href);
  url.searchParams.set(key, value);
  history.replaceState(null, '', url);
};

const params = parseParams(location.search);
let seed = params.seedText === null ? randomSeed() : seedFromText(params.seedText);
if (params.seedText === null) setParam('seed', String(seed));

const style = resolveStyle(params.style);
if (params.style && params.style !== style.id) {
  console.warn(`Unknown style "${params.style}", using "${style.id}" instead.`);
}

// Tuned values from an earlier ?tune session apply before anything is built.
if (params.tune) restoreTuning();

const status = new Status(find('#status'));
const clock = (): number => manager.now();
const manager: SourceManager = new SourceManager(new SyntheticSource(seed, clock), params.speed);
const liveUntil = () => manager.liveUntil();
let world = new World(seed, manager, liveUntil);
// Each style is set up the first time it is used, and again after a new seed.
const readyFor = new Map<Style, number>();
const prepare = async (s: Style) => {
  if (readyFor.get(s) === seed) return;
  readyFor.set(s, seed);
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

// Keys 1 to 3 pick a style, and so does the Style button in turn. The land is redrawn and
// the old style fades out over it.
const STYLE_KEYS = ['paper', 'ink', 'ukiyoe'];
/** The first word of a style's name, for the Style button. */
const shortName = (s: Style) => s.name.split(' ')[0] ?? s.name;
let currentStyle = style;
const switchStyle = async (id: string) => {
  const next = STYLES.get(id);
  if (!next) {
    status.show(`There is no ${id} style yet.`);
    return;
  }
  if (next === currentStyle) return;
  currentStyle = next;
  controls.setStyleName(shortName(next));
  await prepare(next);
  if (currentStyle !== next) return;
  renderer.setStyle(next);
  status.show(next.name);
  setParam('style', next.id);
};
const nextStyle = () => {
  const i = STYLE_KEYS.indexOf(currentStyle.id);
  void switchStyle(STYLE_KEYS[(i + 1) % STYLE_KEYS.length] ?? 'paper');
};
// Set up the other styles while the page is idle, so the first switch to each is instant.
const warmUp = () => {
  for (const id of STYLE_KEYS) {
    const s = STYLES.get(id);
    if (s) void prepare(s);
  }
};
const warmUpLater = () => {
  if ('requestIdleCallback' in window) requestIdleCallback(warmUp, { timeout: 1500 });
  else setTimeout(warmUp, 1500);
};
warmUpLater();
const styleKeys = Object.fromEntries(
  STYLE_KEYS.map((id, i) => [String(i + 1), () => void switchStyle(id)]),
);

const exporter: Exporter = new Exporter(find('#export'), {
  manager,
  seed: () => seed,
  style: () => currentStyle,
  status,
});

/**
 * A new world: a new seed for the land and for the landscape's own music. A song or the mic
 * keeps playing. The last frame stays on top, still, and fades out over the new land.
 */
const newWorld = async () => {
  if (exporter.busy) {
    status.show('A new world can wait until the export is done.');
    return;
  }
  const next = randomSeed();
  seed = next;
  await prepare(currentStyle);
  if (seed !== next) return;
  manager.setSynthetic(new SyntheticSource(next, clock));
  world = new World(next, manager, liveUntil);
  world.reset(manager.kind === 'mic');
  renderer.setWorld(world);
  meters.seed = next;
  setParam('seed', String(next));
  status.show(`A new world, seed ${next}.`);
  warmUpLater();
};

const togglePause = () => {
  if (manager.song) void audioContext().resume();
  if (!manager.togglePause()) {
    status.show('The microphone cannot pause. Press Mic (or M) to stop it.');
    return;
  }
  if (!manager.isPaused) status.hide();
  else if (manager.song) status.show('Paused. Press Play or Space to continue.', { stay: true });
  else status.show('Paused. Space to continue.', { stay: true });
};

const fullscreen = () =>
  void toggleFullscreen().then((ok) => {
    if (!ok) status.show('Fullscreen is not available here.');
  });

const about = new About(
  find<HTMLDialogElement>('#about'),
  () => new URLSearchParams(location.search).get('seed') ?? String(seed),
);
const openAbout = () => {
  exporter.close();
  about.toggle();
};
const openExport = () => {
  about.close();
  exporter.toggle();
};

const controls = bindControls(
  find('#controls'),
  find('#corner'),
  {
    song: () => fileInput.click(),
    mic: () => void mic.toggle(),
    pause: togglePause,
    style: nextStyle,
    world: () => void newWorld(),
    export: openExport,
    fullscreen,
    about: openAbout,
  },
  { fullscreen: canFullscreen() },
);
controls.setStyleName(shortName(currentStyle));
onFullscreenChange(() => controls.setFullscreen(isFullscreen()));

const songs = new SongLoader(status, (song) => manager.playSong(song));
bindFiles(fileInput, find('#drop'), (file) => void songs.load(file));

bindKeys({
  ...styleKeys,
  d: () => meters.toggle(),
  t: () => tune?.toggle(),
  o: () => fileInput.click(),
  m: () => void mic.toggle(),
  s: () => void newWorld(),
  e: openExport,
  f: fullscreen,
  a: openAbout,
  '?': openAbout,
  escape: () => {
    exporter.close();
    about.close();
  },
  ' ': togglePause,
});

// The first seconds: say what to do, then get out of the way.
const hint = matchMedia('(pointer: coarse)').matches
  ? 'Tap Song or Mic, and the land will follow the sound.'
  : 'Drop a song here, or press Song or Mic, and the land will follow the sound.';
status.show(hint, { ms: 6000 });
const dismissHint = () => {
  status.hideIf(hint);
  window.removeEventListener('pointerdown', dismissHint);
  window.removeEventListener('keydown', dismissHint);
};
window.addEventListener('pointerdown', dismissHint);
window.addEventListener('keydown', dismissHint);

startLoop(canvas, (ctx, frame) => {
  manager.tick(frame.dt);
  const now = manager.now();
  // Live input has no future to show: the playhead moves near the right edge.
  renderer.setPlayhead(manager.kind === 'mic' ? 0.92 : 0.5);
  controls.setMicOn(manager.kind === 'mic');
  controls.setSongPlaying(manager.kind === 'file' ? !manager.isPaused : null);
  renderer.render(ctx, frame.surface, now, frame.time, manager.liveUntil());
  meters.update(now, frame.dt);
  if (meters.visible) {
    const { cssWidth, cssHeight } = frame.surface;
    meters.drawPlayhead(ctx, cssWidth * renderer.playheadFraction, cssHeight);
    meters.draw(ctx, cssHeight);
  }
});

window.topotone = {
  get seed() {
    return seed;
  },
  style: () => currentStyle.id,
  stats: () => ({ now: manager.now(), fps: meters.fps, ...world.stats(), ...renderer.stats() }),
  source: () => ({
    kind: manager.kind,
    now: manager.now(),
    paused: manager.isPaused,
    song: manager.song?.name ?? null,
    live: manager.liveUntil(),
  }),
  panorama: (options) => exporter.render(options),
  onsets: (from, to, min = 0.3) =>
    manager
      .frames(from, to)
      .filter((f) => f.onset >= min)
      .map((f) => f.t),
};
