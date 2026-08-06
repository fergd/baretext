// Regression guard for design_handoff_baretext/ACCESSIBILITY.md's P0 finding:
// --text-dimmer was used for real, readable text (status bar secondary
// items, placeholders, word counts, palette hints, keycaps) but failed WCAG
// AA badly in every theme (as low as ~2.0:1). Parses the actual values out
// of src/index.html (not a hand-copied table) so a future theme edit that
// regresses contrast fails here instead of shipping.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '../../src/index.html'), 'utf8');

function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Extracts the [data-theme="id"] { ... } blocks from the :root/index.html
// stylesheet and pulls out the handful of hex-valued custom properties this
// test cares about. Skips --sel/--typewriter-focus/etc that aren't relevant.
function parseThemeBlocks() {
  const themes = {};
  const blockRe = /\[data-theme="(\w+)"\]\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(html))) {
    const [, id, body] = m;
    const get = (token) => {
      const tokenMatch = body.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`));
      return tokenMatch ? tokenMatch[1] : null;
    };
    const bg = get('bg(?!-alt)');
    const bgAlt = get('bg-alt');
    const textDim = get('text-dim(?!mer)');
    const textDimmer = get('text-dimmer');
    if (bg && bgAlt && textDim && textDimmer) {
      themes[id] = { bg, bgAlt, textDim, textDimmer };
    }
  }
  return themes;
}

const THEMES = parseThemeBlocks();

test('every theme block was actually found and parsed', () => {
  assert.deepEqual(Object.keys(THEMES).sort(), ['amstrad', 'dark', 'dracula', 'grove', 'light']);
});

for (const [id, t] of Object.entries(THEMES)) {
  test(`${id}: --text-dimmer clears WCAG AA (4.5:1) against both --bg and --bg-alt`, () => {
    const vsBgAlt = contrastRatio(t.textDimmer, t.bgAlt);
    const vsBg = contrastRatio(t.textDimmer, t.bg);
    assert.ok(vsBgAlt >= 4.5, `${id} --text-dimmer vs --bg-alt is only ${vsBgAlt.toFixed(2)}:1`);
    assert.ok(vsBg >= 4.5, `${id} --text-dimmer vs --bg is only ${vsBg.toFixed(2)}:1`);
  });

  test(`${id}: --text-dim clears WCAG AA (4.5:1) against --bg-alt`, () => {
    const vsBgAlt = contrastRatio(t.textDim, t.bgAlt);
    assert.ok(vsBgAlt >= 4.5, `${id} --text-dim vs --bg-alt is only ${vsBgAlt.toFixed(2)}:1`);
  });

  test(`${id}: --text-dim stays visually more prominent than --text-dimmer (hierarchy preserved)`, () => {
    const dimContrast = contrastRatio(t.textDim, t.bgAlt);
    const dimmerContrast = contrastRatio(t.textDimmer, t.bgAlt);
    assert.ok(dimContrast > dimmerContrast, `${id}: --text-dim (${dimContrast.toFixed(2)}) should read more prominent than --text-dimmer (${dimmerContrast.toFixed(2)}), not the reverse`);
  });
}
