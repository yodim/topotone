import { defineConfig, devices } from '@playwright/test';

// Set PLAYWRIGHT_CHROMIUM_PATH to use an already installed Chromium
// instead of the one Playwright downloads with `npx playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/topotone/',
    ...devices['Desktop Chrome'],
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        // Lets the tests start audio without a real click.
        '--autoplay-policy=no-user-gesture-required',
        // A fake microphone that plays a beep, and a permission prompt that says yes.
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/topotone/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
