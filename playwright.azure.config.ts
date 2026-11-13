import { defineConfig, devices } from '@playwright/test';

/**
 * De app zoals in Azure: de zelfstandige server (output standalone), Postgres met RLS, inloggen via een nagebootste
 * Entra ID en live bijwerken. Eerst bouwen: npm run build:azure. Draait alleen met GRIP_TEST_PG.
 */
const launchOptions = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};
const pg = new URL(process.env.GRIP_TEST_PG || 'postgres://postgres@localhost:5432/postgres');
pg.pathname = '/grip_e2e_azure';
process.env.GRIP_E2E_DATABASE = pg.toString();

export default defineConfig({
  testDir: './e2e/azure',
  workers: 1,
  timeout: 90_000,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './e2e/azure/opzet.ts',
  use: { baseURL: 'http://localhost:3100', locale: 'nl-NL', timezoneId: 'Europe/Amsterdam', ...devices['Desktop Chrome'], launchOptions },
  webServer: [
    { command: 'node e2e/azure/nep-entra.mjs 3199', url: 'http://localhost:3199/11111111-2222-3333-4444-555555555555/v2.0/.well-known/openid-configuration', reuseExistingServer: false },
    {
      command: 'node .next-azure/standalone/server.js',
      url: 'http://localhost:3100/login',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: '3100', HOSTNAME: 'localhost', DATABASE_URL: pg.toString(), GRIP_URL: 'http://localhost:3100',
        SESSIE_GEHEIM: 'e2e-geheim-van-minstens-tweeendertig-tekens', CRON_SECRET: 'e2e-cron', GRIP_BEHEERDER: 'eerste@voorbeeld.nl',
        ENTRA_TENANT_ID: '11111111-2222-3333-4444-555555555555', ENTRA_CLIENT_ID: 'grip-test', ENTRA_CLIENT_SECRET: 'geheim-van-de-test',
        ENTRA_ISSUER: 'http://localhost:3199/11111111-2222-3333-4444-555555555555/v2.0', ENTRA_GRAPH: 'http://localhost:3199',
      },
    },
  ],
});
