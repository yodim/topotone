import { expect, test } from '@playwright/test';
import { clickTrack, encodeWav } from '../fixtures/signals.ts';

test('a dropped song is analyzed, played and drives the world', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('./?seed=7');
  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);

  const clicks = clickTrack(44100, 12, 120, 0.25);
  await page.locator('#file-input').setInputFiles({
    name: 'clicks.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(encodeWav(clicks)),
  });

  await expect(page.locator('#status')).toContainText('Playing clicks');
  const started = await page.evaluate(() => window.topotone?.source());
  expect(started?.kind).toBe('file');
  expect(started?.song).toBe('clicks');

  // The audio clock moves the world forward.
  await page.waitForTimeout(1500);
  const later = await page.evaluate(() => window.topotone?.source());
  expect((later?.now ?? 0) - (started?.now ?? 0)).toBeGreaterThan(1);

  // The song's clicks show up as onsets every 0.5 s on the world timeline.
  const songStart = (started?.now ?? 0) - 0; // the song starts where the world was
  const onsets = await page.evaluate(
    ([from, to]) => window.topotone?.onsets(from as number, to as number) ?? [],
    [songStart + 3, songStart + 9],
  );
  expect(onsets.length).toBe(12);
  for (let i = 1; i < onsets.length; i++) {
    expect(Math.abs((onsets[i] ?? 0) - (onsets[i - 1] ?? 0) - 0.5)).toBeLessThan(0.02);
  }

  // Space pauses the song and the world with it.
  await page.keyboard.press(' ');
  const paused = await page.evaluate(() => window.topotone?.source());
  await page.waitForTimeout(500);
  const stillPaused = await page.evaluate(() => window.topotone?.source());
  expect(paused?.paused).toBe(true);
  expect(stillPaused?.now).toBe(paused?.now);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  expect((await page.evaluate(() => window.topotone?.source()))?.paused).toBe(false);

  await page.screenshot({ path: 'test-results/song.png' });
  expect(errors).toEqual([]);
});

test('the Song button opens the file picker', async ({ page }) => {
  await page.goto('./?seed=7');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#song-button').click();
  expect((await chooser).isMultiple()).toBe(false);
});

test('a file that is not audio gives a friendly message', async ({ page }) => {
  await page.goto('./?seed=7');
  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);
  await page.locator('#file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a song'),
  });
  await expect(page.locator('#status')).toContainText('notes.txt is not a sound file');
  expect((await page.evaluate(() => window.topotone?.source()))?.kind).toBe('synthetic');
});

test('a damaged or silent song gives a friendly message', async ({ page }) => {
  await page.goto('./?seed=7');
  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);
  const input = page.locator('#file-input');

  // Looks like an mp3, but the browser cannot decode it.
  await input.setInputFiles({
    name: 'broken.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.alloc(4096, 7),
  });
  await expect(page.locator('#status')).toContainText('Could not read broken.mp3');

  await input.setInputFiles({
    name: 'quiet.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(encodeWav({ samples: new Float32Array(44100 * 2), sampleRate: 44100 })),
  });
  await expect(page.locator('#status')).toContainText('quiet.wav is silent');
  expect((await page.evaluate(() => window.topotone?.source()))?.kind).toBe('synthetic');
});
