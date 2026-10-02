import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serialize } from '../../packages/format/src/index.ts';
import { launch } from './launch.ts';

const para = (text: string) => ({ type: 'paragraph' as const, content: [{ text }] });
const BOOK = serialize({
  title: 'The Lighthouse Keeper',
  coldStorage: [{ id: 'k1x', name: 'Parked', link: null, blocks: [para('PARKED TEXT NEVER PRINTS.')] }],
  chapters: [
    { id: 'c1x', title: 'Arrival', scenes: [
      { id: 's1x', name: null, link: null, blocks: Array.from({ length: 30 }, (_, i) => para(`Paragraph ${i + 1} of the arrival, long enough to wrap across the line and fill the page with prose.`)) },
      { id: 's2x', name: 'The log', link: null, blocks: [para('Wind, sea, ships.')] },
    ] },
    { id: 'c2x', title: 'Weather', scenes: [{ id: 's3x', name: null, link: null, blocks: [para('By October the light came late.')] }] },
  ],
});

/** Pages in a PDF (its page objects, not the page tree). */
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;

test('⌘P prints the manuscript in standard format: title page, each chapter on new pages', async () => {
  const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'bt-print-')), 'book.pdf');
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK }, env: { BARETEXT_PRINT_TO: out }, settings: { export: { format: 'docx', coldStorage: false, notes: false, author: 'Ada Byron King' } } });
  try {
    await page.keyboard.press('Meta+P');
    await expect.poll(() => existsSync(out), { timeout: 15_000 }).toBe(true);
    const pdf = readFileSync(out);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // Title page, chapter 1 (30 double-spaced paragraphs: several pages), chapter 2 on its own page.
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(5);
    expect(await page.evaluate(() => document.querySelector('.bt-toast[data-kind="error"][data-visible="true"]'))).toBeNull();
  } finally {
    await app.close();
  }
});

test('Print is in the File menu and the palette', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    const item = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find((i) => i.label === 'File')!.submenu!.items.find((i) => i.label === 'Print…')?.accelerator);
    expect(item).toBe('CmdOrCtrl+P');
    await page.keyboard.press('Meta+K');
    await page.keyboard.type('print');
    await expect(page.locator('.bt-palette [role="option"]').first()).toContainText('Print…');
  } finally {
    await app.close();
  }
});
