import { expect, test } from '@playwright/test';

test('loads the page and draws the world', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('./');
  const canvas = page.locator('#stage');
  await expect(canvas).toBeVisible();

  // A fresh visit writes its random seed into the address bar.
  await expect(page).toHaveURL(/[?&]seed=\d+/);

  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);
  const painted = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#stage');
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return 0;
    return ctx.getImageData(c.width / 2, c.height - 2, 1, 1).data[3] ?? 0;
  });
  expect(painted).toBe(255);

  const size = await canvas.boundingBox();
  const viewport = page.viewportSize();
  expect(size?.width).toBe(viewport?.width);
  expect(size?.height).toBe(viewport?.height);

  await page.keyboard.press('d');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/smoke.png' });
  expect(errors).toEqual([]);
});

test('the same seed draws the same world', async ({ page }) => {
  const shot = async () => {
    await page.goto('./?seed=river&speed=0.05');
    await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);
    return page.evaluate(() => window.topotone?.seed);
  };
  const a = await shot();
  const b = await shot();
  expect(a).toBe(b);
});
