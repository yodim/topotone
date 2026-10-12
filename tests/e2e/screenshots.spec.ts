import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Reference screenshots: every style on the three reference seeds, about 24 seconds into
 * the world. They land in test-results/screenshots/; run with UPDATE_SCREENSHOTS=1 to write
 * them to docs/screenshots/ instead. A new style is added to STYLES below.
 */
const STYLES = ['paper', 'ink', 'ukiyoe'];
/** Chosen so that paper shows each of its three paper sets. */
const SEEDS = ['river', 'ember', 'willow'];
const dir = process.env.UPDATE_SCREENSHOTS ? 'docs/screenshots' : 'test-results/screenshots';

test.use({ viewport: { width: 1280, height: 720 } });

for (const seed of SEEDS) {
  for (const style of STYLES) {
    test(`${style} on seed ${seed}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`./?seed=${seed}&style=${style}&speed=8`);
      await page.addStyleTag({ content: '.bar, #status { display: none !important; }' });
      await page.waitForFunction(() => (window.topotone?.source().now ?? 0) >= 24, null, {
        timeout: 20_000,
      });
      await page.keyboard.press(' ');
      // Let the paused frame settle: chunks drawn, no fade left.
      await page.waitForTimeout(800);
      expect(await page.evaluate(() => window.topotone?.style())).toBe(style);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/${style}-${seed}.jpg`, type: 'jpeg', quality: 82 });
      expect(errors).toEqual([]);
    });
  }
}
