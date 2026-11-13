import { defineConfig, devices } from '@playwright/test';

/** Rooktest tegen een uitgerolde omgeving: GRIP_ADRES=https://... npx playwright test -c playwright.rook.config.ts */
const launchOptions = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

export default defineConfig({
  testDir: './e2e/rook',
  workers: 1,
  retries: 2,
  timeout: 60_000,
  reporter: process.env.CI ? [['junit', { outputFile: 'test-results/rook.xml' }], ['list']] : 'list',
  use: { baseURL: process.env.GRIP_ADRES || 'http://localhost:3000', ignoreHTTPSErrors: false, ...devices['Desktop Chrome'], launchOptions },
});
