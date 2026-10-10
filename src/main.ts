import { bindFiles } from './app/files';
import { bindKeys } from './app/keyboard';
import { Meters } from './app/meters';
import { parseParams, seedFromText } from './app/params';
import { SongLoader, audioContext } from './app/songs';
import { Status } from './app/status';
import { SourceManager } from './audio/sources/manager';
import { SyntheticSource } from './audio/sources/synthetic';
import { randomSeed } from './core/rng';
import { MAX_DPR, Renderer, startLoop } from './render/engine';
import { resolveStyle } from './styles/registry';
import { World } from './world/generator';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const statusEl = document.querySelector<HTMLElement>('#status');
const fileInput = document.querySelector<HTMLInputElement>('#file-input');
if (!canvas || !statusEl || !fileInput) throw new Error('Missing page elements');

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

const status = new Status(statusEl);
const synthetic: SyntheticSource = new SyntheticSource(seed, (): number => manager.now());
const manager: SourceManager = new SourceManager(synthetic, params.speed);
const world = new World(seed, manager);
await style.setup?.({ seed, dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR) });
const renderer = new Renderer(world, style);
const meters = new Meters(manager, seed);

// A new song means a new timeline: rebuild the world and fade the new land in.
manager.onTimelineChange = () => {
  world.reset();
  renderer.reset();
};

const songs = new SongLoader(status, (song) => manager.playSong(song));
bindFiles(fileInput, (file) => void songs.load(file));

bindKeys({
  d: () => meters.toggle(),
  o: () => fileInput.click(),
  ' ': () => {
    if (manager.song) void audioContext().resume();
    manager.togglePause();
    if (manager.isPaused) status.show('Paused. Space to continue.', { stay: true });
    else status.hide();
  },
});

startLoop(canvas, (ctx, frame) => {
  manager.tick(frame.dt);
  const now = manager.now();
  renderer.render(ctx, frame.surface, now, frame.time);
  meters.update(now, frame.dt);
  if (meters.visible) meters.draw(ctx, frame.surface.cssHeight);
});

window.topotone = {
  seed,
  stats: () => ({ now: manager.now(), fps: meters.fps, ...world.stats(), ...renderer.stats() }),
  source: () => ({
    kind: manager.kind,
    now: manager.now(),
    paused: manager.isPaused,
    song: manager.song?.name ?? null,
  }),
  onsets: (from, to, min = 0.3) =>
    manager
      .frames(from, to)
      .filter((f) => f.onset >= min)
      .map((f) => f.t),
};
