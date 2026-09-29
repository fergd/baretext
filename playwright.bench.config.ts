import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/bench',
  testMatch: '**/*.bench.ts',
  workers: 1,
  timeout: 300_000,
  reporter: [['list']],
});
