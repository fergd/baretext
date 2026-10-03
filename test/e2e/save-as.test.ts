// File › Save As… (⌥⇧⌘S): the book, saved first, written where the writer
// chooses through the verified save, its notes with it; the window carries
// on with the new file, and the original stays as it was last saved.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { serialize } from '../../packages/format/src/index.ts';
import { launch } from './launch.ts';

const p = (text: string) => ({ type: 'paragraph' as const, content: [{ text }] });
const BOOK = serialize({ title: 'Keeper', coldStorage: [], chapters: [{ id: 'c1x', title: 'One', scenes: [{ id: 's1x', name: null, link: null, blocks: [p('The boat left.')] }] }] });
const NOTE = { v: 1, notes: [{ id: 'n1', body: 'Check the tide.', anchor: null, resolved: false, created: 1, updated: 1 }] };

/** The save dialog answers with `file` (a native dialog can't be clicked by a test). */
const answerSaveDialog = (app: ElectronApplication, file: string) => app.evaluate(({ dialog }, f) => {
  dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as never;
}, file);
const saveAs = (app: ElectronApplication) => app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find((i) => i.label === 'File')!.submenu!.items.find((i) => i.label === 'Save As…')!.click());

test('Save As writes the book (and its notes) to the new place and carries on there; the original keeps its last save', async () => {
  // The book and its notes, on disk before the app opens it.
  const first = await launch({ file: { name: 'Keeper.md', content: BOOK } });
  await first.app.close();
  const original = path.join(first.saveDir, 'Keeper.md');
  writeFileSync(original.replace(/\.md$/, '.notes.json'), JSON.stringify(NOTE));
  const { app, page, saveDir } = await launch({ reuse: { userData: first.userData, saveDir: first.saveDir } });
  try {
    await page.keyboard.press('Meta+ArrowRight'); // (the line's end)
    await page.keyboard.type(' Before.');
    const to = path.join(saveDir, 'Second draft'); // (no extension given: .md is added)
    await answerSaveDialog(app, to);
    await saveAs(app);
    await expect.poll(() => page.evaluate(() => (window as any).__baretext.filePath())).toBe(`${to}.md`);
    expect(readFileSync(`${to}.md`, 'utf8')).toBe(readFileSync(original, 'utf8')); // (the same book, saved first)
    expect(readFileSync(original, 'utf8')).toContain('The boat left. Before.');
    expect(JSON.parse(readFileSync(`${to}.notes.json`, 'utf8')).notes.map((n: { body: string }) => n.body)).toEqual(['Check the tide.']); // (its notes went with it)

    await page.keyboard.type(' After.');
    await page.evaluate(() => (window as any).__baretext.saveNow());
    expect(readFileSync(`${to}.md`, 'utf8')).toContain('Before. After.');
    expect(readFileSync(original, 'utf8')).not.toContain('After.'); // (the original stays as it was)
  } finally {
    await app.close();
  }
});
