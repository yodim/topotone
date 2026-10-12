import { expect, test } from '@playwright/test';

test('the mic drives the world live, and M hands back to the fallback', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?seed=7');
  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);

  // Start with the on-screen button, as on a phone.
  const button = page.locator('#mic-button');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(page.locator('#status')).toContainText('Listening');
  expect((await page.evaluate(() => window.topotone?.source()))?.kind).toBe('mic');
  await expect(button).toHaveAttribute('aria-pressed', 'true');

  await page.waitForTimeout(3000);
  const live = await page.evaluate(() => window.topotone?.source());
  // Features arrive within a fraction of a second of what is heard.
  expect(live?.live).toBeGreaterThan((live?.now ?? 0) - 0.4);
  expect(live?.live).toBeLessThanOrEqual((live?.now ?? 0) + 0.05);
  // The fake device beeps: those beeps are heard as onsets.
  const onsets = await page.evaluate(
    ([from, to]) => window.topotone?.onsets(from as number, to as number, 0.1) ?? [],
    [(live?.live ?? 0) - 2.5, live?.live ?? 0],
  );
  expect(onsets.length).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/mic.png' });

  // Space cannot pause the mic, and says so.
  await page.keyboard.press(' ');
  await expect(page.locator('#status')).toContainText('cannot pause');

  // A new world keeps listening, and the land keeps growing at the live edge.
  const rendered = await page.evaluate(() => window.topotone?.stats().chunksRendered ?? 0);
  await page.keyboard.press('s');
  await expect(page.locator('#status')).toContainText('A new world');
  await page.waitForTimeout(1500);
  const renewed = await page.evaluate(() => window.topotone?.source());
  expect(renewed?.kind).toBe('mic');
  expect(renewed?.live).toBeGreaterThan(live?.live ?? 0);
  expect(await page.evaluate(() => window.topotone?.stats().chunksRendered ?? 0)).toBeGreaterThan(
    rendered + 20,
  );
  await page.screenshot({ path: 'test-results/mic-new-world.png' });

  await page.keyboard.press('m');
  await expect(page.locator('#status')).toContainText('Microphone off');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  const after = await page.evaluate(() => window.topotone?.source());
  expect(after?.kind).toBe('synthetic');
  expect(after?.live).toBe(Infinity);
  expect(errors).toEqual([]);
});

test('a denied mic gives a short message and the fallback keeps going', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await page.goto('./?seed=7');
  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);
  const before = await page.evaluate(() => window.topotone?.source().now ?? 0);

  await page.keyboard.press('m');
  await expect(page.locator('#status')).toContainText('The microphone is blocked');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.topotone?.source());
  expect(after?.kind).toBe('synthetic');
  expect(after?.now ?? 0).toBeGreaterThan(before);
});
