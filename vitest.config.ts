import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['__tests__/**/*.test.{ts,tsx}'],
    setupFiles: [],
    // de tests draaien altijd los van een echte omgeving, ook waar deze variabelen wel staan
    env: {
      // een build zet NODE_ENV=production; de tests horen altijd als test te draaien
      NODE_ENV: 'test',
      NEXT_PUBLIC_GRIP_PLATFORM: '',
      DATABASE_URL: '',
      AI_URL: '',
      AI_SLEUTEL: '',
      AI_MODEL: '',
      CRON_SECRET: '',
      REISTIJD_AANBIEDER: '',
      REISTIJD_URL: '',
      REISTIJD_SLEUTEL: '',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
