import { bindKeys } from './app/keyboard';
import { Meters } from './app/meters';
import { parseParams, seedFromText } from './app/params';
import { SyntheticSource } from './audio/sources/synthetic';
import { randomSeed } from './core/rng';
import { MAX_DPR, Renderer, startLoop } from './render/engine';
import { resolveStyle } from './styles/registry';
import { World } from './world/generator';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
if (!canvas) throw new Error('Missing #stage canvas');

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

let musicTime = 0;
const source = new SyntheticSource(seed, () => musicTime);
const world = new World(seed, source);
await style.setup?.({ seed, dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR) });
const renderer = new Renderer(world, style);
const meters = new Meters(source, seed);

bindKeys({ d: () => meters.toggle() });

startLoop(canvas, (ctx, frame) => {
  musicTime += frame.dt * params.speed;
  const now = source.now();
  renderer.render(ctx, frame.surface, now, frame.time);
  meters.update(now, frame.dt);
  if (meters.visible) meters.draw(ctx, frame.surface.cssHeight);
});

window.topotone = {
  seed,
  stats: () => ({ now: musicTime, fps: meters.fps, ...world.stats(), ...renderer.stats() }),
};
