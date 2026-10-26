import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The suite follows src/site.config.json: proposal mode exercises the demo,
// official mode verifies the published site without demo or preview notices.
const site = JSON.parse(readFileSync('src/site.config.json', 'utf8'));
const sitePath = site.official ? new URL(site.canonicalUrl).pathname : '/PulmonogyClinic/';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: site.official ? ['**/demo.spec.ts', '**/public-layout.spec.ts'] : ['**/official.spec.ts'],
  outputDir: './test-results/public',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/public', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173' + sitePath,
    reuseExistingServer: !process.env.CI,
  },
});
