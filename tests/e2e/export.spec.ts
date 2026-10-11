import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { clickTrack, encodeWav, mixedPiece } from '../fixtures/signals.ts';

/** Width and height from a PNG file's header. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function exportNow(page: Page, caption = false) {
  await page.keyboard.press('e');
  const panel = page.locator('#export');
  await expect(panel).toBeVisible();
  if (caption) await panel.locator('#export-caption').check();
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export' }).click();
  const file = await download;
  await expect(page.locator('#status')).toContainText('Saved');
  return { name: file.suggestedFilename(), size: pngSize((await file.path()) as string) };
}

test('E exports the landscape so far as a PNG', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?seed=7&speed=4');
  await page.waitForFunction(() => (window.topotone?.source().now ?? 0) > 8);
  await page.keyboard.press('e');
  await expect(page.locator('#export-what')).toContainText('of the landscape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#export')).toBeHidden();

  const { name, size } = await exportNow(page);
  expect(name).toBe('topotone-paper.png');
  expect(size.height).toBe(1080);
  // At least the shortest stretch, 20 s, at 64 px per second.
  expect(size.width).toBeGreaterThanOrEqual(20 * 64 - 2);
  expect(errors).toEqual([]);
});

test('a song exports in full, with its name in the caption', async ({ page }) => {
  await page.goto('./?seed=7&style=ink');
  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);
  await page.locator('#file-input').setInputFiles({
    name: 'clicks.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(encodeWav(clickTrack(44100, 12, 120, 0.25))),
  });
  await expect(page.locator('#status')).toContainText('Playing clicks');
  await page.keyboard.press('e');
  await expect(page.locator('#export-what')).toContainText('clicks');
  await expect(page.locator('#export-title')).toHaveValue('clicks');
  await page.keyboard.press('Escape');

  const { name, size } = await exportNow(page, true);
  expect(name).toBe('clicks-ink.png');
  // The whole 12 s song, before most of it has even played, plus the caption strip.
  expect(Math.abs(size.width - 12 * 64)).toBeLessThanOrEqual(2);
  expect(size.height).toBe(1080 + 56);
});

test('a four minute song exports in about ten seconds', async ({ page }) => {
  test.slow();
  await page.goto('./?seed=7&style=paper');
  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);
  await page.locator('#file-input').setInputFiles({
    name: 'four minutes.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(encodeWav(mixedPiece(44100, 240))),
  });
  await expect(page.locator('#status')).toContainText('Playing', { timeout: 60_000 });
  const started = Date.now();
  const { name, size } = await exportNow(page);
  const seconds = (Date.now() - started) / 1000;
  console.log(`Exported a 4 minute song in ${seconds.toFixed(1)} s`);
  expect(name).toBe('four-minutes-paper.png');
  expect(Math.abs(size.width - 240 * 64)).toBeLessThanOrEqual(2);
  // The plan asks for about 10 s; this leaves room for a slow test machine.
  expect(seconds).toBeLessThan(25);
});

test.describe('at 1920 by 1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('the panorama matches the live view where the ground layer is drawn', async ({ page }) => {
    await page.goto('./?seed=7&style=paper');
    await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);
    await page.keyboard.press(' ');
    await page.waitForTimeout(800);
    const scores = await page.evaluate(async () => {
      const t = window.topotone;
      if (!t) return [];
      const now = t.source().now;
      // The ground layer moves at 64 px per second at this size; the playhead is at 960.
      const { canvas, layout } = await t.panorama({ from: now - 15, to: now + 15, height: 1080 });
      const stage = document.querySelector<HTMLCanvasElement>('#stage');
      const live = stage?.getContext('2d')?.getImageData(0, 0, 1920, 1080).data;
      const pano = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, 1080).data;
      if (!live || !pano) return [];
      const offset = (now - layout.t0) * layout.pxPerSecond - 960;
      // Mean difference over the bottom rows, which hold only the ground layer's sheet in
      // front of everything else, with the panorama shifted by -8 to 8 pixels.
      const out: number[] = [];
      for (let shift = -8; shift <= 8; shift++) {
        let sum = 0;
        let n = 0;
        for (let y = 1040; y < 1076; y += 2) {
          for (let x = 40; x < 1880; x += 2) {
            const px = Math.round(x + offset + shift);
            if (px < 0 || px >= canvas.width) continue;
            for (let c = 0; c < 3; c++) {
              const a = live[(y * 1920 + x) * 4 + c] ?? 0;
              const b = pano[(y * canvas.width + px) * 4 + c] ?? 0;
              sum += Math.abs(a - b);
              n++;
            }
          }
        }
        out.push(sum / n);
      }
      return out;
    });
    expect(scores).toHaveLength(17);
    const best = Math.min(...scores);
    // The two line up where they should: the closest match is within a pixel of no shift,
    // nearly equal (the live view sits at a fraction of a pixel and is filtered), and far
    // closer than a shifted one.
    expect(Math.abs(scores.indexOf(best) - 8)).toBeLessThanOrEqual(1);
    expect(best).toBeLessThan(2);
    expect(Math.min(scores[0] ?? 0, scores[16] ?? 0)).toBeGreaterThan(2.5 * best);
  });
});
