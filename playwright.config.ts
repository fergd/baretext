import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  // E2E files share app instances' resources; run them one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list']],
});
