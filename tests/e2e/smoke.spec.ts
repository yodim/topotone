import { expect, test } from '@playwright/test';

test('loads the page and draws on the canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('./');
  const canvas = page.locator('#stage');
  await expect(canvas).toBeVisible();

  // The canvas fills the viewport and something has been painted near the bottom.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('#stage');
        const ctx = c?.getContext('2d');
        if (!c || !ctx || c.width < 2) return 0;
        return ctx.getImageData(c.width / 2, c.height - 2, 1, 1).data[3] ?? 0;
      }),
    )
    .toBe(255);

  const size = await canvas.boundingBox();
  const viewport = page.viewportSize();
  expect(size?.width).toBe(viewport?.width);
  expect(size?.height).toBe(viewport?.height);

  await page.screenshot({ path: 'test-results/smoke.png' });
  expect(errors).toEqual([]);
});
