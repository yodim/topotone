/**
 * Makes the README animation (docs/topotone.gif) and the social preview
 * (docs/social-preview.jpg) from the app itself. Run with `npm run media`, which builds the
 * app first. PLAYWRIGHT_CHROMIUM_PATH points at an installed Chromium, as for the browser
 * tests.
 *
 * The page runs on Playwright's fake clock and is stepped by hand, so every frame comes out
 * the same on every run (up to the fonts installed for the preview's text).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { preview } from 'vite';
import { encodeGif, type GifFrame } from './gif.ts';

const SEED = 'river';
const DOCS = join(import.meta.dirname, '..', 'docs');

/** The animation: the same world in paper, then ink, then ukiyo-e. */
const GIF = {
  width: 720,
  height: 300,
  /** Rendered at twice the size and scaled down, for smoother edges. */
  render: 2,
  frames: 100,
  /** Milliseconds per frame: five animation frames of 16 ms, so 12.5 per second. */
  stepMs: 80,
  switches: { 33: '2', 66: '3' } as Record<number, string>,
};

/**
 * The social preview: one moment of one world, in three diagonal bands. The world depends on
 * music time alone, so the landscape's music runs 8 times faster to get there sooner.
 */
const PREVIEW = { width: 1280, height: 640, speed: 8, atMs: 3000 };

/** Errors from any page; the script fails if there are some. */
const errors: string[] = [];

const server = await preview({ preview: { port: 4175, strictPort: true }, logLevel: 'warn' });
const base = 'http://localhost:4175/topotone/';
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {},
);

try {
  await makeGif(browser);
  await makePreview(browser);
  if (errors.length > 0) throw new Error(`The page failed: ${errors.join('; ')}`);
} finally {
  await browser.close();
  server.httpServer.close();
}

/** Opens the app on the fake clock, at time zero. */
async function openWorld(
  browser: Browser,
  options: { style: string; width: number; height: number; scale: number; speed?: number },
): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: options.scale,
  });
  page.on('pageerror', (e) => errors.push(e.message));
  // The installed clock still follows real time until it is paused.
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  const speed = options.speed ? `&speed=${options.speed}` : '';
  await page.goto(`${base}?seed=${SEED}&style=${options.style}${speed}`);
  return page;
}

/** The canvas as RGBA pixels, scaled to width by height. */
async function grab(page: Page, width: number, height: number): Promise<Uint8Array> {
  const b64 = await page.evaluate(
    ([w, h]) => {
      const stage = document.querySelector<HTMLCanvasElement>('#stage');
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!stage || !ctx) throw new Error('No canvas to grab');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(stage, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let s = '';
      for (let i = 0; i < data.length; i += 0x8000) {
        s += String.fromCharCode(...data.subarray(i, i + 0x8000));
      }
      return btoa(s);
    },
    [width, height] as const,
  );
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function makeGif(browser: Browser): Promise<void> {
  const { width, height, render } = GIF;
  const page = await openWorld(browser, {
    style: 'paper',
    width: width * render,
    height: height * render,
    scale: 1,
  });
  // Let the land and the other styles get ready first.
  await page.clock.runFor(2000);
  const frames: GifFrame[] = [];
  for (let i = 0; i < GIF.frames; i++) {
    const key = GIF.switches[i];
    if (key) await page.keyboard.press(key);
    await page.clock.runFor(GIF.stepMs);
    frames.push({ rgba: await grab(page, width, height), delayCs: GIF.stepMs / 10 });
  }
  await page.close();

  const gif = encodeGif(width, height, frames);
  const path = join(DOCS, 'topotone.gif');
  writeFileSync(path, gif);
  const error = await checkGif(browser, gif, frames[0]?.rgba, width, height);
  console.log(
    `wrote docs/topotone.gif: ${width} × ${height}, ${frames.length} frames, ` +
      `${(gif.length / 1e6).toFixed(2)} MB, first frame off by ${error.toFixed(1)} on average`,
  );
}

/** Decodes the GIF in the browser and compares its first frame with what went in. */
async function checkGif(
  browser: Browser,
  gif: Uint8Array,
  first: Uint8Array | Uint8ClampedArray | undefined,
  width: number,
  height: number,
): Promise<number> {
  if (!first) throw new Error('No frames');
  const page = await browser.newPage();
  const decoded = await page.evaluate(
    async ([src, w, h]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('No 2D context');
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(0, 0, w, h).data);
    },
    [`data:image/gif;base64,${Buffer.from(gif).toString('base64')}`, width, height] as const,
  );
  await page.close();
  let sum = 0;
  for (let i = 0; i < first.length; i++) {
    if (i % 4 !== 3) sum += Math.abs((first[i] as number) - (decoded[i] as number));
  }
  const error = sum / ((first.length * 3) / 4);
  if (error > 6) throw new Error(`The GIF does not match its first frame (off by ${error})`);
  return error;
}

async function makePreview(browser: Browser): Promise<void> {
  const { width, height } = PREVIEW;
  const styles = ['paper', 'ink', 'ukiyoe'];
  const shots: string[] = [];
  for (const style of styles) {
    const page = await openWorld(browser, {
      style,
      width,
      height,
      scale: 2,
      speed: PREVIEW.speed,
    });
    await page.clock.runFor(PREVIEW.atMs);
    shots.push(Buffer.from(await grab(page, width, height)).toString('base64'));
    await page.close();
  }

  const page = await browser.newPage();
  await page.setContent('<canvas></canvas>');
  const jpeg = await page.evaluate(
    ([w, h, images]) => {
      const c = document.querySelector('canvas');
      const ctx = c?.getContext('2d');
      if (!c || !ctx) throw new Error('No 2D context');
      c.width = w;
      c.height = h;
      // Three bands split by slanted edges: the same moment of one world in each style.
      const slant = 160;
      const edges = [w / 3, (2 * w) / 3];
      const band = (i: number) => {
        const left = i === 0 ? -slant : (edges[i - 1] as number);
        const right = i === 2 ? w + slant : (edges[i] as number);
        ctx.beginPath();
        ctx.moveTo(left + slant / 2, 0);
        ctx.lineTo(right + slant / 2, 0);
        ctx.lineTo(right - slant / 2, h);
        ctx.lineTo(left - slant / 2, h);
        ctx.closePath();
      };
      images.forEach((b64, i) => {
        const bytes = Uint8ClampedArray.from(atob(b64), (ch) => ch.charCodeAt(0));
        const layer = document.createElement('canvas');
        layer.width = w;
        layer.height = h;
        layer.getContext('2d')?.putImageData(new ImageData(bytes, w, h), 0, 0);
        ctx.save();
        band(i);
        ctx.clip();
        ctx.drawImage(layer, 0, 0);
        ctx.restore();
      });
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 3;
      for (const x of edges) {
        ctx.beginPath();
        ctx.moveTo(x + slant / 2, 0);
        ctx.lineTo(x - slant / 2, h);
        ctx.stroke();
      }

      const font = 'Inter, "Inter Display", system-ui, sans-serif';
      const pill = (text: string, x: number, y: number, size: number) => {
        ctx.font = `500 ${size}px ${font}`;
        const tw = ctx.measureText(text).width;
        const pad = size * 0.7;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.beginPath();
        ctx.roundRect(x - tw / 2 - pad, y - size, tw + 2 * pad, size * 2, size);
        ctx.fill();
        ctx.fillStyle = '#2a2f36';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y + size * 0.05);
      };
      // The middle of band i at height y: the edges lean, so it shifts with y.
      const middle = (i: number, y: number) => {
        const shift = slant / 2 - (slant * y) / h;
        const left = i === 0 ? 0 : (edges[i - 1] as number) + shift;
        const right = i === 2 ? w : (edges[i] as number) + shift;
        return (left + right) / 2;
      };
      // The title sits on the plain rice paper of the ink band's sky.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#2a2f36';
      ctx.font = `600 78px ${font}`;
      ctx.fillText('Topotone', middle(1, 100), 108);
      ctx.fillStyle = '#4a525c';
      ctx.font = `400 26px ${font}`;
      ctx.fillText('Sound turned into a landscape', middle(1, 146), 152);
      // Each style's name at the foot of its band.
      const names = ['Paper cutout', 'Ink painting', 'Ukiyo-e woodblock'];
      names.forEach((name, i) => pill(name, middle(i, h - 52), h - 52, 20));
      return c.toDataURL('image/jpeg', 0.9);
    },
    [width, height, shots] as const,
  );
  await page.close();
  const bytes = Buffer.from(jpeg.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
  writeFileSync(join(DOCS, 'social-preview.jpg'), bytes);
  console.log(
    `wrote docs/social-preview.jpg: ${width} × ${height}, ${(bytes.length / 1e3).toFixed(0)} KB`,
  );
}
