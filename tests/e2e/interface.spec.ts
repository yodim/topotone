import { expect, test, type Page } from '@playwright/test';
import { clickTrack, encodeWav } from '../fixtures/signals.ts';

const watchErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
};

const ready = (page: Page) =>
  page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);

const chunksRendered = (page: Page) =>
  page.evaluate(() => window.topotone?.stats().chunksRendered ?? 0);

const playClicks = async (page: Page) => {
  await page.locator('#file-input').setInputFiles({
    name: 'clicks.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(encodeWav(clickTrack(44100, 20, 120, 0.25))),
  });
  await expect(page.locator('#status')).toContainText('Playing clicks');
};

test('a first visit says what to do, and the hint goes at the first key', async ({ page }) => {
  await page.goto('./?seed=7');
  await expect(page.locator('#status')).toContainText('Drop a song here, or press Song or Mic');
  await page.keyboard.press('d');
  await expect(page.locator('#status')).not.toHaveClass(/visible/);
});

test('S makes a new world in place, and a song keeps playing', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?seed=7');
  await ready(page);
  await playClicks(page);
  const before = await page.evaluate(() => window.topotone?.source());
  const rendered = await chunksRendered(page);

  await page.keyboard.press('s');
  await expect(page.locator('#status')).toContainText('A new world, seed');
  const seed = await page.evaluate(() => window.topotone?.seed);
  expect(seed).not.toBe(7);
  await expect(page).toHaveURL(new RegExp(`[?&]seed=${seed}(&|$)`));
  // The land is rebuilt for the new seed.
  await expect.poll(() => chunksRendered(page)).toBeGreaterThan(rendered + 20);

  // The song was not interrupted: same song, still playing, its clock still moving.
  const after = await page.evaluate(() => window.topotone?.source());
  expect(after?.kind).toBe('file');
  expect(after?.song).toBe('clicks');
  expect(after?.paused).toBe(false);
  expect(after?.now ?? 0).toBeGreaterThan(before?.now ?? 0);

  // The New world button does the same.
  await page.locator('#world-button').click();
  await expect.poll(() => page.evaluate(() => window.topotone?.seed)).not.toBe(seed);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/new-world.png' });
  expect(errors).toEqual([]);
});

test('the Pause button shows only with a song, and pauses it', async ({ page }) => {
  await page.goto('./?seed=7');
  await ready(page);
  const pause = page.locator('#pause-button');
  await expect(pause).toBeHidden();
  await playClicks(page);
  await expect(pause).toBeVisible();
  await expect(pause).toContainText('Pause');

  await pause.click();
  await expect(pause).toContainText('Play');
  expect((await page.evaluate(() => window.topotone?.source()))?.paused).toBe(true);
  await expect(page.locator('#status')).toContainText('Paused');

  await pause.click();
  await expect(pause).toContainText('Pause');
  expect((await page.evaluate(() => window.topotone?.source()))?.paused).toBe(false);
});

test('the Style button steps through the styles', async ({ page }) => {
  await page.goto('./?seed=7');
  await ready(page);
  const button = page.locator('#style-button');
  await expect(button).toContainText('Paper');
  await button.click();
  await expect(button).toContainText('Ink');
  await expect(page).toHaveURL(/[?&]style=ink/);
  await button.click();
  await expect(button).toContainText('Ukiyo-e');
  await button.click();
  await expect(button).toContainText('Paper');
  expect(await page.evaluate(() => window.topotone?.style())).toBe('paper');
});

test('About opens with A or its button, and Escape closes it', async ({ page }) => {
  await page.goto('./?seed=river');
  await ready(page);
  const about = page.locator('#about');
  await expect(about).toBeHidden();

  await page.keyboard.press('a');
  await expect(about).toBeVisible();
  await expect(about).toContainText('Your audio never leaves this device');
  await expect(about.locator('#about-seed')).toHaveText('river');
  await expect(about.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/yodim/topotone',
  );
  await page.screenshot({ path: 'test-results/about.png' });
  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();

  await page.getByRole('button', { name: 'About' }).click();
  await expect(about).toBeVisible();
  await about.getByRole('button', { name: 'Close' }).click();
  await expect(about).toBeHidden();
  // Focus is back on the page, so Space pauses instead of pressing a button.
  await page.keyboard.press(' ');
  expect((await page.evaluate(() => window.topotone?.source()))?.paused).toBe(true);
});

test('F and the Fullscreen button toggle fullscreen', async ({ page }) => {
  await page.goto('./?seed=7');
  await ready(page);
  const button = page.locator('#fullscreen-button');
  await expect(button).toBeVisible();
  await page.keyboard.press('f');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test('a file dragged over the page shows where it will go', async ({ page }) => {
  await page.goto('./?seed=7');
  await ready(page);
  const veil = page.locator('#drop');
  await expect(veil).toBeHidden();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['x'], 'song.mp3', { type: 'audio/mpeg' }));
    window.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, cancelable: true }));
  });
  await expect(veil).toBeVisible();
  await expect(veil).toContainText('Drop to play');
  // Once the file stops hovering, the veil goes.
  await expect(veil).toBeHidden();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('every button fits and works by touch', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./?seed=7');
    await ready(page);
    await expect(page.locator('#status')).toContainText('Tap Song or Mic');

    // All buttons sit inside the screen, one row along the bottom, none overlapping.
    const ids = ['song', 'mic', 'style', 'world', 'export'];
    const boxes = [];
    for (const id of ids) {
      const box = await page.locator(`#${id}-button`).boundingBox();
      expect(box, id).not.toBeNull();
      if (!box) continue;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.y + box.height).toBeLessThanOrEqual(844);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      boxes.push(box);
    }
    for (let i = 1; i < boxes.length; i++) {
      const a = boxes[i - 1];
      const b = boxes[i];
      if (a && b) expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
    }

    await page.locator('#style-button').tap();
    await expect.poll(() => page.evaluate(() => window.topotone?.style())).toBe('ink');

    const seed = await page.evaluate(() => window.topotone?.seed);
    await page.locator('#world-button').tap();
    await expect.poll(() => page.evaluate(() => window.topotone?.seed)).not.toBe(seed);

    await page.locator('#about-button').tap();
    await expect(page.locator('#about')).toBeVisible();
    // No keyboard here: the list of keys stays out of the way.
    await expect(page.locator('#about dl')).toBeHidden();
    await page.locator('#about').getByRole('button', { name: 'Close' }).tap();
    await expect(page.locator('#about')).toBeHidden();

    // Left alone, the buttons dim.
    await expect(page.locator('body')).toHaveClass(/idle/, { timeout: 6000 });
    await page.screenshot({ path: 'test-results/phone.png' });
    expect(errors).toEqual([]);
  });
});
