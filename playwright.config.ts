import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  // Each test launches its own hidden app with its own throwaway data, so
  // files run side by side (tests within a file, in order).
  workers: 6,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list']],
});
