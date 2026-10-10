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
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/topotone/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
