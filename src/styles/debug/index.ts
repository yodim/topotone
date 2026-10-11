/**
 * Debug wireframe. Ridges as polylines, markers for objects, blue bars for water, a tick at
 * every chunk start and the sky values as text. Meant for development, not for looking at.
 */
import { lerp } from '../../core/math';
import { CHUNK_SECONDS, chunkStart, type WorldObject } from '../../world/scene';
import { ridgeAt, objectsAround, waterAround } from '../shared/ridge';
import type { ChunkEnv, Style } from '../types';

function grey(depth: number, alpha = 1): string {
  const v = Math.round(lerp(175, 35, depth));
  return `rgba(${v}, ${v + 4}, ${v + 10}, ${alpha})`;
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  o: WorldObject,
  x: number,
  y: number,
  k: number,
) {
  switch (o.kind) {
    case 'tree': {
      const h = (10 + 30 * o.size) * k;
      ctx.fillStyle = 'rgba(46, 125, 50, 0.85)';
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + h * 0.28, y - h * 0.25);
      ctx.lineTo(x - h * 0.28, y - h * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - 0.75 * k, y - h * 0.25, 1.5 * k, h * 0.25);
      break;
    }
    case 'rock': {
      const s = (4 + 10 * o.size) * k;
      ctx.fillStyle = 'rgba(121, 85, 72, 0.9)';
      ctx.fillRect(x - s / 2, y - s, s, s);
      break;
    }
    case 'grass': {
      ctx.strokeStyle = 'rgba(104, 159, 56, 0.9)';
      ctx.lineWidth = 1.2 * k;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - (4 + 8 * o.size) * k);
      ctx.stroke();
      break;
    }
    case 'bird': {
      const by = y - (40 + 70 * o.variant) * k;
      const w = (4 + 4 * o.size) * k;
      ctx.strokeStyle = 'rgba(30, 30, 30, 0.9)';
      ctx.lineWidth = 1.2 * k;
      ctx.beginPath();
      ctx.moveTo(x - w, by - w * 0.5);
      ctx.lineTo(x, by);
      ctx.lineTo(x + w, by - w * 0.5);
      ctx.stroke();
      break;
    }
    case 'lone-peak': {
      ctx.strokeStyle = 'rgba(198, 40, 40, 0.9)';
      ctx.fillStyle = 'rgba(198, 40, 40, 0.9)';
      ctx.lineWidth = 1.5 * k;
      ctx.beginPath();
      ctx.moveTo(x, y - 4 * k);
      ctx.lineTo(x, y - 18 * k);
      ctx.stroke();
      ctx.font = `${Math.round(10 * k)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('peak', x, y - 22 * k);
      break;
    }
  }
}

const debug: Style = {
  id: 'debug',
  name: 'Debug',
  description: 'Wireframe view of the generated world, for development.',
  author: 'Topotone',

  drawSky(ctx, sky, view) {
    const v = Math.round(lerp(205, 246, sky.brightness));
    ctx.fillStyle = `rgb(${v}, ${v}, ${v - 6})`;
    ctx.fillRect(0, 0, view.width, view.height);

    ctx.fillStyle = 'rgba(40, 40, 40, 0.8)';
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'right';
    const f = (n: number) => n.toFixed(2);
    ctx.fillText(
      `t ${view.now.toFixed(1)}s  mood ${f(sky.mood)}  bright ${f(sky.brightness)}  cloud ${f(sky.cloudiness)}  mist ${f(sky.mist)}  warm ${f(sky.warmth)}`,
      view.width - 12,
      20,
    );
  },

  drawLayerChunk(ctx, chunk, env: ChunkEnv) {
    const { neighbors, scale } = env;
    const start = chunkStart(chunk.index);
    const { pxPerSecond } = env;
    const t0 = start - env.toX(start) / pxPerSecond;
    const k = scale * (0.5 + 0.5 * chunk.depth);

    // Ridge, with a pale fill so nearer layers hide the ones behind.
    ctx.beginPath();
    const step = 2;
    for (let x = 0; x <= env.width + step; x += step) {
      const t = t0 + x / pxPerSecond;
      const y = env.toY(ridgeAt(chunk, neighbors, t));
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(env.width + step, env.height);
    ctx.lineTo(0, env.height);
    ctx.closePath();
    ctx.fillStyle = `rgba(250, 250, 248, ${0.35 + 0.4 * chunk.depth})`;
    ctx.fill();
    ctx.strokeStyle = grey(chunk.depth);
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.stroke();

    // Chunk start: a dashed tick from the ridge down, and the index when there is room.
    const x0 = env.toX(start);
    ctx.strokeStyle = grey(chunk.depth, 0.35);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, env.toY(chunk.ridge[0] ?? 0));
    ctx.lineTo(x0 + 0.5, env.toY(0));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '10px ui-monospace, monospace';
    const label = `${chunk.role} ${chunk.index}`;
    if (ctx.measureText(label).width + 6 < env.toX(start + CHUNK_SECONDS) - x0) {
      ctx.fillStyle = grey(chunk.depth, 0.7);
      ctx.textAlign = 'left';
      ctx.fillText(label, x0 + 3, env.toY(0) - 3);
    }

    for (const w of waterAround(chunk, neighbors)) {
      const centre = (w.t0 + w.t1) / 2;
      const y = env.toY(ridgeAt(chunk, neighbors, centre));
      const h = (2 + 6 * w.width) * scale;
      ctx.fillStyle = `rgba(30, 110, 210, ${0.35 + 0.4 * w.calm})`;
      ctx.fillRect(env.toX(w.t0), y - h / 2, env.toX(w.t1) - env.toX(w.t0), h);
    }

    for (const o of objectsAround(chunk, neighbors)) {
      const x = env.toX(o.t);
      if (x < -60 * k || x > env.width + 60 * k) continue;
      drawObject(ctx, o, x, env.toY(ridgeAt(chunk, neighbors, o.t)), k);
    }
  },
};

export default debug;
