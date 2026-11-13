import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests in lokale modus (zonder database). Lokaal draaien: npm run test:e2e. In CI eerst npm run build.
 * Met PW_CHROMIUM=/pad/naar/chromium gebruikt Playwright een al geïnstalleerde browser.
 */
const launchOptions = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

export default defineConfig({
  testDir: './e2e',
  testIgnore: /(azure|rook)\//,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 3,
  timeout: 90_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    launchOptions,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'mobiel', use: { ...devices['Pixel 7'], launchOptions }, testMatch: /medewerker/ },
  ],
  // in CI tegen de productiebuild (eerst npm run build), lokaal tegen de dev-server; altijd in lokale modus
  webServer: {
    command: process.env.CI ? 'npm run start' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_PUBLIC_GRIP_PLATFORM: '', ZONDER_LOGIN: '1' },
  },
});
