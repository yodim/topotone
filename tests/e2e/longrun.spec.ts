import { expect, test } from '@playwright/test';

// Music at speed 20: the caches fill up in the first seconds, then about eight more
// minutes of music play between the two measurements.
test('memory stays flat over a long run', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Heap measurement needs Chromium');
  test.setTimeout(120_000);

  await page.goto('./?seed=7&speed=20');
  await page.waitForFunction(() => (window.topotone?.stats().chunksRendered ?? 0) > 0);

  const cdp = await page.context().newCDPSession(page);
  type Sample = Record<
    'heap' | 'now' | 'chunks' | 'frameBlocks' | 'skyBlocks' | 'stripPixels',
    number
  >;
  const sample = async (): Promise<Sample> => {
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const stats = await page.evaluate(() => window.topotone?.stats() ?? {});
    return { ...(stats as Sample), heap: heap.usedSize };
  };

  await page.waitForTimeout(15_000);
  const early = await sample();
  await page.waitForTimeout(25_000);
  const late = await sample();
  console.log({ early, late });

  // Music time really advanced, by several minutes.
  expect(late.now - early.now).toBeGreaterThan(200);
  // Caches stay bounded.
  expect(late.chunks).toBeLessThanOrEqual(early.chunks * 1.5 + 8);
  expect(late.frameBlocks).toBeLessThanOrEqual(256);
  expect(late.skyBlocks).toBeLessThanOrEqual(128);
  expect(late.stripPixels).toBe(early.stripPixels);
  // The JS heap does not keep growing.
  expect(late.heap - early.heap).toBeLessThan(3 * 1024 * 1024);
});
