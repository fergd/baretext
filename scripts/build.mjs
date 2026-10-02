// Builds main, preload, and renderer into build/.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}build`;
const alias = {
  '@baretext/format': `${root}packages/format/src/index.ts`,
  '@baretext/editor': `${root}packages/editor/src/index.ts`,
};

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/renderer`, { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: 'warning', alias, target: 'es2023' };

await Promise.all([
  build({ ...common, entryPoints: [`${root}app/main/main.ts`], outfile: `${out}/main/main.cjs`, platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: [`${root}app/preload/preload.ts`], outfile: `${out}/preload/preload.cjs`, platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: [`${root}app/renderer/index.ts`], outfile: `${out}/renderer/renderer.js`, platform: 'browser', format: 'iife' }),
  // The component gallery (dev only; never loaded by the app).
  build({ ...common, entryPoints: [`${root}app/renderer/gallery/gallery.ts`], outfile: `${out}/renderer/gallery.js`, platform: 'browser', format: 'iife' }),
]);

for (const item of ['index.html', 'styles', 'fonts', 'assets', 'gallery/gallery.html', 'gallery/gallery.css']) {
  cpSync(`${root}app/renderer/${item}`, `${out}/renderer/${item.replace('gallery/', '')}`, { recursive: true });
}
