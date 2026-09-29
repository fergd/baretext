import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@baretext/format': src('./packages/format/src/index.ts'),
      '@baretext/editor': src('./packages/editor/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'app/**/test/**/*.test.ts'],
    environment: 'node',
  },
});
