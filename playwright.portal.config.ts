import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/portal', timeout: 90000, workers: 1, fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/portal', open: 'never' }]],
  // Auth redirects and request headers contain credentials: never record traces/videos.
  use: { baseURL: 'http://localhost:4180', trace: 'off', screenshot: 'off', locale: 'es-MX' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});
