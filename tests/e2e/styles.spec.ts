import { expect, test } from '@playwright/test';

test('paper is the default, and number keys switch styles with a crossfade', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('./?seed=7');
  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);
  expect(await page.evaluate(() => window.topotone?.style())).toBe('paper');

  // Debug stays reachable from the address.
  await page.goto('./?seed=7&style=debug');
  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);
  expect(await page.evaluate(() => window.topotone?.style())).toBe('debug');

  const before = await page.evaluate(() => window.topotone?.stats().chunksRendered ?? 0);
  await page.keyboard.press('1');
  await expect(page.locator('#status')).toContainText('Paper cutout');
  await expect(page).toHaveURL(/[?&]style=paper/);
  expect(await page.evaluate(() => window.topotone?.style())).toBe('paper');
  // The land is redrawn in the new style.
  await expect
    .poll(() => page.evaluate(() => window.topotone?.stats().chunksRendered ?? 0))
    .toBeGreaterThan(before + 20);
  await page.screenshot({ path: 'test-results/style-switch.png' });

  // Key 2 picks ink, with its own setup done while the page was idle or right then.
  await page.keyboard.press('2');
  await expect(page.locator('#status')).toContainText('Ink painting');
  await expect(page).toHaveURL(/[?&]style=ink/);
  expect(await page.evaluate(() => window.topotone?.style())).toBe('ink');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/style-ink.png' });

  await page.keyboard.press('3');
  await expect(page.locator('#status')).toContainText('Ukiyo-e woodblock');
  await expect(page).toHaveURL(/[?&]style=ukiyoe/);
  expect(await page.evaluate(() => window.topotone?.style())).toBe('ukiyoe');

  // The world keeps moving through the switch.
  const t0 = await page.evaluate(() => window.topotone?.source().now ?? 0);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.topotone?.source().now ?? 0)).toBeGreaterThan(t0);
  expect(errors).toEqual([]);
});
