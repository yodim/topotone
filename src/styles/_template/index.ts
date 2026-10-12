/**
 * Template for a new style. Copy this folder to src/styles/<id>/, set `id` to the folder
 * name, and the registry picks it up: open the page with ?style=<id>.
 *
 * It draws flat silhouettes, a gradient sky and a little mist. Small on purpose: replace
 * each part with your own technique. The rules that keep the world seamless and
 * deterministic are in the comments, look for "Rule".
 */
import { lerp } from '../../core/math';
import { createRng } from '../../core/rng';
import type { LayerChunk, WorldObject } from '../../world/scene';
import { css, hex, mix } from '../shared/palette';
import {
  objectsAround,
  ridgeAt,
  sampleRidge,
  timeAt,
  waterAround,
  waterRuns,
} from '../shared/ridge';
import type { ChunkEnv, Style } from '../types';

const SKY_TOP = hex('#9db8cc');
const SKY_LOW = hex('#efe9dc');
const FAR = hex('#b7c3c9');
const NEAR = hex('#3c4a45');

const template: Style = {
  // Rule: the id must match the folder name.
  id: 'template',
  name: 'Template',
  description: 'Flat silhouettes. A starting point for new styles.',
  author: 'Your name',

  // Optional. Runs when the style is first used, and again for each new seed: build textures
  // and palettes here, from env.seed (for example makeGrainTile from ../shared/grain). Never in
  // the draw calls. Anything cached from the old seed must be rebuilt or keyed by the seed.
  setup() {},

  // Rule: runs every frame, keep it cheap. One gradient fill is fine; per-pixel work is not.
  drawSky(ctx, sky, view) {
    const g = ctx.createLinearGradient(0, 0, 0, view.height * 0.6);
    g.addColorStop(0, css(mix(SKY_TOP, SKY_LOW, 1 - sky.brightness)));
    g.addColorStop(1, css(SKY_LOW));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.width, view.height);
  },

  // Optional, for the panorama export: the sky behind the whole image. It may be thousands
  // of pixels wide; read the sky along it with strip.skyAt. Here: the same gradient in
  // narrow slices, each with the sky above it. Without this hook, drawSky is used in tiles.
  drawSkyStrip(ctx, strip) {
    for (let x = 0; x < strip.width; x += 16) {
      const sky = strip.skyAt(strip.t0 + (x + 8) / strip.pxPerSecond);
      const g = ctx.createLinearGradient(0, 0, 0, strip.height * 0.6);
      g.addColorStop(0, css(mix(SKY_TOP, SKY_LOW, 1 - sky.brightness)));
      g.addColorStop(1, css(SKY_LOW));
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 16, strip.height);
    }
  },

  // Runs once per chunk; the engine caches the result. Heavy work belongs here.
  // Rule: draw in CSS pixels and multiply sizes by env.scale.
  drawLayerChunk(ctx, chunk, env: ChunkEnv) {
    const color = mix(FAR, NEAR, chunk.depth);

    // Rule: draw past the chunk edges. sampleRidge covers the whole canvas, bleed included,
    // reading the neighbors where needed; the engine clips the bleed away.
    const line = sampleRidge(chunk, env, 2);
    ctx.beginPath();
    ctx.moveTo(line.xs[0] as number, env.height);
    for (let i = 0; i < line.xs.length; i++) ctx.lineTo(line.xs[i] as number, line.ys[i] as number);
    ctx.lineTo(line.xs[line.xs.length - 1] as number, env.height);
    ctx.closePath();
    ctx.fillStyle = css(color);
    ctx.fill();

    // Rule: env.rng is the chunk's randomness, for texture inside the chunk. Use it in a fixed
    // order (here: a fixed number of specks first), so a redrawn chunk matches the cached one.
    // Anything that must continue across a chunk edge (an outline, a wave) must instead be a
    // function of music time, like the helpers in ../shared/edges do.
    ctx.fillStyle = css(mix(color, SKY_LOW, 0.15));
    for (let i = 0; i < 12; i++) {
      const x = env.rng.range(0, env.width);
      const t = timeAt(chunk, env, x);
      const y = env.toY(ridgeAt(chunk, env.neighbors, t)) + env.rng.range(6, 40) * env.scale;
      ctx.fillRect(x, y, 2 * env.scale, 1 * env.scale);
    }

    if (chunk.role === 'ground') drawWater(ctx, chunk, env);

    // Rule: per-object detail comes from createRng(object.seed), never from env.rng. An object
    // is drawn by every chunk it overhangs, and under live input a chunk is redrawn as
    // objects arrive: its own seed keeps it identical everywhere.
    for (const o of objectsAround(chunk, env.neighbors)) {
      const x = env.toX(o.t);
      if (x < -50 || x > env.width + 50) continue;
      const y = env.toY(ridgeAt(chunk, env.neighbors, o.t));
      drawObject(ctx, o, x, y, env.scale * (0.4 + 0.6 * chunk.depth), color);
    }
  },

  // Optional, every frame after each layer: haze between depths. Keep it cheap too.
  drawAtmosphere(ctx, depth, sky, view) {
    if (depth >= 1) return;
    ctx.fillStyle = css(SKY_LOW, 0.12 * sky.mist);
    ctx.fillRect(0, 0, view.width, view.height);
  },

  // Optional, every frame on top of everything: grain, vignette, drifting mist.
  // view.clock is the animation time; never read the clock yourself.
  drawOverlay() {},
};

function drawWater(ctx: CanvasRenderingContext2D, chunk: LayerChunk, env: ChunkEnv): void {
  ctx.fillStyle = css(hex('#8fb3c4'));
  for (const run of waterRuns(waterAround(chunk, env.neighbors))) {
    const x0 = env.toX(run.t0);
    const x1 = env.toX(run.t1);
    if (x1 < 0 || x0 > env.width) continue;
    const y = env.toY(ridgeAt(chunk, env.neighbors, (run.t0 + run.t1) / 2)) - 3 * env.scale;
    ctx.fillRect(x0, y, x1 - x0, env.height - y);
  }
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  o: WorldObject,
  x: number,
  y: number,
  k: number,
  color: readonly [number, number, number],
): void {
  const rng = createRng(o.seed);
  ctx.fillStyle = css(mix(color, NEAR, 0.6));
  switch (o.kind) {
    case 'tree': {
      const h = lerp(20, 70, o.size) * k * rng.range(0.9, 1.1);
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + h * 0.25, y);
      ctx.lineTo(x - h * 0.25, y);
      ctx.fill();
      break;
    }
    case 'rock':
      ctx.beginPath();
      ctx.ellipse(x, y, (5 + 10 * o.size) * k, (3 + 6 * o.size) * k, 0, Math.PI, 0);
      ctx.fill();
      break;
    case 'grass':
      ctx.fillRect(x - k, y - (4 + 8 * o.size) * k, 2 * k, (4 + 8 * o.size) * k);
      break;
    case 'bird':
      ctx.fillRect(x - 4 * k, y - (40 + 70 * o.variant) * k, 8 * k, 1.5 * k);
      break;
    case 'lone-peak':
      // The ridge already rises here. A style can mark it: snow, a flag, a brighter tone.
      break;
  }
}

export default template;
