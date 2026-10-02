import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { launch } from './launch.ts';

const FILE = '# Spring\n\n## Garden\n\nThey planted *basil* in the garden.\n\n## Market\n\nA second scene.\n\n# Summer\n\n## Rain\n\nIt rained.\n';

/** The next save dialog answers with `file` (or is cancelled); returns what it was offered. */
async function answerSaveDialog(app: ElectronApplication, file: string | null) {
  await app.evaluate(({ dialog }, file) => {
    const g = globalThis as any;
    dialog.showSaveDialog = (async (_win: unknown, options: { defaultPath?: string }) => {
      g.__offered = options.defaultPath;
      return file ? { canceled: false, filePath: file } : { canceled: true, filePath: undefined };
    }) as any;
  }, file);
  return () => app.evaluate(() => (globalThis as any).__offered as string);
}

async function addNote(page: Page, passage: string, body: string) {
  await page.evaluate((t) => (window as any).__baretext.selectText(t), passage);
  await page.keyboard.press('Meta+Shift+m');
  await page.keyboard.type(body);
  await page.keyboard.press('Enter');
}

test('⇧⌘E: choose Markdown with notes, export where the save dialog says; the choices are remembered', async () => {
  const { app, page, userData, saveDir } = await launch({ file: { name: 'E.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    await addNote(page, 'basil', 'Right for this climate?');
    const out = path.join(saveDir, 'out.md');
    const offered = await answerSaveDialog(app, out);

    await page.keyboard.press('Meta+Shift+e');
    const panel = page.locator('.bt-export');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.bt-export-summary')).toHaveText('2 chapters · 11 words');
    await expect(panel.getByRole('radio', { name: /Word/ })).toHaveAttribute('aria-checked', 'true'); // the default
    await expect(panel.getByRole('switch', { name: /Cold Storage/ })).toBeDisabled(); // nothing parked

    await panel.getByRole('radio', { name: /Markdown/ }).click();
    await expect(panel.locator('.bt-export-author')).toBeHidden(); // a name is for Word
    await panel.getByRole('switch', { name: /Notes/ }).click();
    await panel.getByRole('button', { name: 'Export…' }).click();

    await expect(panel).toBeHidden();
    await expect(page.locator('[data-ref="toast"]')).toHaveText('Exported “out.md”');
    expect(path.basename(await offered())).toMatch(/\.md$/);
    expect(readFileSync(out, 'utf8')).toBe([
      '# E', '', // the book's title (an imported file is named after it)
      '## Spring', '',
      'They planted *basil*[^1] in the garden.', '',
      '* * *', '',
      'A second scene.', '',
      '## Summer', '',
      'It rained.', '',
      '[^1]: Right for this climate?',
    ].join('\n') + '\n');
    await app.close();

    const again = await launch({ reuse: { userData, saveDir } });
    try {
      await again.page.keyboard.press('Meta+Shift+e');
      const p = again.page.locator('.bt-export');
      await expect(p.getByRole('radio', { name: /Markdown/ })).toHaveAttribute('aria-checked', 'true');
      await expect(p.getByRole('switch', { name: /Notes/ })).toHaveAttribute('aria-checked', 'true');
    } finally {
      await again.app.close();
    }
  } finally {
    await app.close().catch(() => {});
  }
});

test('Word: a real .docx in manuscript format with the writer’s name; a cancelled save dialog leaves the panel open', async () => {
  const { app, page, saveDir } = await launch({ file: { name: 'E.md', content: FILE } });
  try {
    await answerSaveDialog(app, null);
    await page.keyboard.press('Meta+Shift+e');
    const panel = page.locator('.bt-export');
    await expect(panel.locator('.bt-export-hint')).toHaveText('For the title page’s byline and the header atop each page');
    await panel.locator('.bt-export-input').fill('Ada Lovelace');
    await expect(panel.locator('.bt-export-hint')).toHaveText('“by Ada Lovelace” on the title page; “Lovelace / E / 2” atop each page');
    await panel.getByRole('button', { name: 'Export…' }).click();
    await expect(panel).toBeVisible(); // cancelled: nothing written, still here

    const out = path.join(saveDir, 'Book.docx');
    await answerSaveDialog(app, out);
    await page.keyboard.press('Meta+Enter'); // ⌘↵ exports from anywhere in the panel
    await expect(panel).toBeHidden();
    expect(existsSync(out)).toBe(true);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const doc = await zip.file('word/document.xml')!.async('string');
    for (const text of ['Ada Lovelace', 'by Ada Lovelace', 'Spring', 'They planted ', 'basil', '#', 'Summer', 'END']) expect(doc).toContain(`>${text}<`);
    expect(doc).not.toContain('Garden'); // scene names stay behind
  } finally {
    await app.close();
  }
});

test('Esc closes the panel; while it is open other commands wait', async () => {
  const { app, page } = await launch({ file: { name: 'E.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+Shift+e');
    await expect(page.locator('.bt-export')).toBeVisible();
    await page.keyboard.press('Meta+Shift+n'); // notes panel: not now
    await expect(page.locator('.bt-notes-panel')).toHaveAttribute('data-open', 'false');
    await page.keyboard.press('Escape');
    await expect(page.locator('.bt-export')).toBeHidden();
    expect(await page.evaluate(() => (window as any).__baretext.hasFocus())).toBe(true);
  } finally {
    await app.close();
  }
});
