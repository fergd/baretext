// Regression guard: src/main.js keeps its own THEME_BG lookup (id -> hex),
// a duplicate of each theme's --bg token in src/index.html, because the
// native BrowserWindow backgroundColor can't reference a CSS custom
// property — it has to be a literal hex string known before the page even
// loads. That's exactly the kind of two-copies-of-the-same-fact setup that
// silently drifts (a theme's --bg edited in one file, forgotten in the
// other) — most visibly as a mismatched-color strip at the very top of the
// screen in macOS fullscreen (titleBarStyle: 'hiddenInset' leaves a native
// gap there that renders raw backgroundColor, outside the web content
// entirely). Parses both files directly rather than hand-copying either
// list, so a future theme edit that only touches one side fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '../../src/index.html'), 'utf8');
const mainjs = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

function parseHtmlBg() {
  const themes = {};
  const blockRe = /\[data-theme="(\w+)"\]\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(html))) {
    const [, id, body] = m;
    const bgMatch = body.match(/--bg:\s*(#[0-9a-fA-F]{6})/);
    if (bgMatch) themes[id] = bgMatch[1].toLowerCase();
  }
  return themes;
}

function parseMainJsThemeBg() {
  const blockMatch = mainjs.match(/const THEME_BG = \{([^}]*)\}/s);
  assert.ok(blockMatch, 'src/main.js should define a THEME_BG lookup');
  const themes = {};
  const entryRe = /(\w+):\s*'(#[0-9a-fA-F]{6})'/g;
  let m;
  while ((m = entryRe.exec(blockMatch[1]))) themes[m[1]] = m[2].toLowerCase();
  return themes;
}

test('main.js THEME_BG has every theme index.html defines, with matching --bg hex values', () => {
  const htmlBg = parseHtmlBg();
  const mainBg = parseMainJsThemeBg();
  assert.deepEqual(Object.keys(htmlBg).sort(), ['amstrad', 'cga', 'crt', 'dark', 'dracula', 'gameboy', 'grove', 'light']);
  assert.deepEqual(mainBg, htmlBg);
});
