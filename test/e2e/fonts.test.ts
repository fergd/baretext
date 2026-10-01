import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launch, setAppearance } from './launch.ts';

const FILE = '# The Bag on the Table\n\n## Give Me the Bag\n\nThe first line of prose.\n\nAnother line.\n';
const family = (page: Page, selector: string) => page.$eval(selector, (e) => getComputedStyle(e).fontFamily);

test('IBM Plex: interface in Sans Condensed, numbers in Plex Mono, prose in Plex Mono by default', async () => {
  const { app, page } = await launch({ file: { name: 'F.md', content: FILE } });
  try {
    await page.click('[data-ref="sidebar"]');
    expect(await family(page, '.bt-chrome-crumb')).toMatch(/^"IBM Plex Sans Condensed"/);
    expect(await family(page, '.bt-outline-name')).toMatch(/^"IBM Plex Sans Condensed"/);
    expect(await family(page, '.bt-outline-num')).toMatch(/^"IBM Plex Mono"/);
    expect(await family(page, '.bt-outline-meta')).toMatch(/^"IBM Plex Mono"/);
    expect(await family(page, '[data-ref="words"] .bt-num-text')).toMatch(/^"IBM Plex Mono"/);
    expect(await family(page, '[data-ref="words"]')).toMatch(/^"IBM Plex Sans Condensed"/);
    expect(await family(page, '.ProseMirror')).toMatch(/^"IBM Plex Mono"/);
    expect(await family(page, '.bt-num')).toMatch(/^"IBM Plex Mono"/);
    // The faces actually loaded (no silent fallback).
    expect(await page.evaluate(async () => {
      await document.fonts.ready;
      return ['IBM Plex Mono', 'IBM Plex Sans Condensed'].map((f) => document.fonts.check(`12px "${f}"`));
    })).toEqual([true, true]);
  } finally {
    await app.close();
  }
});

test('prose font: Serif and Sans from Appearance; headings follow, numbers stay mono; the caret line stays; remembered', async () => {
  const { app, page, userData, saveDir } = await launch({ file: { name: 'F.md', content: FILE } });
  try {
    await page.evaluate(() => (window as any).__baretext.caretAfter('first line'));
    const before = await page.evaluate(() => (window as any).__baretext.caretTop());
    await setAppearance(page, ['serif']);
    expect(await family(page, '.ProseMirror')).toMatch(/^"IBM Plex Serif"/);
    expect(await family(page, '.bt-chapter-title')).toMatch(/^"IBM Plex Serif"/);
    expect(await family(page, '.bt-num')).toMatch(/^"IBM Plex Mono"/);
    expect(await page.evaluate(() => (window as any).__baretext.caretTop())).toBeCloseTo(before, 0);
    expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('15px "IBM Plex Serif"'); })).toBe(true);
    await page.waitForTimeout(200);
    expect(JSON.parse(readFileSync(`${userData}/settings.json`, 'utf8')).proseFont).toBe('serif');
    await app.close();

    const again = await launch({ reuse: { userData, saveDir } });
    try {
      expect(await family(again.page, '.ProseMirror')).toMatch(/^"IBM Plex Serif"/);
      await setAppearance(again.page, ['sans']);
      expect(await family(again.page, '.ProseMirror')).toMatch(/^"IBM Plex Sans"/);
    } finally {
      await again.app.close();
    }
  } finally {
    await app.close().catch(() => {});
  }
});
