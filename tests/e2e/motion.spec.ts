import { expect, test, type Page } from '@playwright/test';

/** Seconds of music per second of page time, measured over one second. */
const pace = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        const m0 = window.topotone?.source().now ?? 0;
        setTimeout(() => {
          const m1 = window.topotone?.source().now ?? 0;
          resolve((m1 - m0) / ((performance.now() - t0) / 1000));
        }, 1000);
      }),
  );

test('reduced motion slows the landscape, and follows the setting live', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?seed=7');
  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);
  const slow = await pace(page);
  expect(slow).toBeGreaterThan(0.35);
  expect(slow).toBeLessThan(0.6);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await pace(page)).toBeGreaterThan(0.8);
});
