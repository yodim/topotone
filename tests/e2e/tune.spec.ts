import { expect, test } from '@playwright/test';

test('?tune opens the panel; changes rebuild the land and survive a reload', async ({ page }) => {
  await page.goto('./?seed=7');
  await expect(page.locator('#tune')).toHaveCount(0);

  await page.goto('./?seed=7&tune');
  const panel = page.locator('#tune');
  await expect(panel).toBeVisible();
  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);
  const before = await page.evaluate(() => window.topotone?.stats().chunksBuilt ?? 0);

  // Move the far range's tone weight.
  const row = panel.locator('label', { hasText: 'tone' }).first();
  await row.locator('input').evaluate((input: HTMLInputElement) => {
    input.value = '0.9';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(row).toHaveClass(/changed/);
  await expect(row.locator('output')).toHaveText('0.900');
  // The land is rebuilt shortly after.
  await expect
    .poll(() => page.evaluate(() => window.topotone?.stats().chunksBuilt ?? 0))
    .toBeGreaterThan(before + 20);

  await page.reload();
  await expect(panel.locator('label', { hasText: 'tone' }).first().locator('output')).toHaveText(
    '0.900',
  );

  // Reset brings the defaults back, and T hides the panel.
  await panel.getByRole('button', { name: 'Reset' }).click();
  await expect(panel.locator('label.changed')).toHaveCount(0);
  await page.keyboard.press('t');
  await expect(panel).toBeHidden();
});
