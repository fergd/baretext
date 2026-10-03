// Book setup (DECISIONS §26): a new book asks its title, author, structure
// and target length; File › Book Settings… later. Stored in the book's front
// matter; one undoable change; the author goes to export and print.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { serialize } from '../../packages/format/src/index.ts';
import { launch } from './launch.ts';

const p = (text: string) => ({ type: 'paragraph' as const, content: [{ text }] });
const BOOK = serialize({
  title: 'The Lighthouse Keeper',
  coldStorage: [],
  chapters: [{ id: 'c1x', title: 'Arrival', scenes: [{ id: 's1x', name: null, link: null, blocks: [p('The boat left her on the jetty.')] }] }],
});

/** Choose a menu item by its labels (File › New). */
const menu = (app: ElectronApplication, ...labels: string[]) => app.evaluate(({ Menu }, path) => {
  let items = Menu.getApplicationMenu()!.items;
  let item;
  for (const label of path) { item = items.find((i) => i.label === label)!; items = item.submenu?.items ?? []; }
  item!.click();
}, labels);
const setup = (page: Page) => page.evaluate(() => (window as any).__baretext.book().setup);
const saved = async (page: Page) => {
  await page.evaluate(() => (window as any).__baretext.saveNow());
  return readFileSync(await page.evaluate(() => (window as any).__baretext.filePath()), 'utf8');
};
const frontMatter = (text: string) => text.split('\n---\n')[0];

test('a new book asks what it is: title, author, structure, target — saved in its front matter, one undo away', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await menu(app, 'File', 'New');
    const panel = page.locator('.bt-book');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.bt-appearance-title')).toHaveText('New book');
    const title = panel.locator('[data-field="title"]');
    await expect(title).toBeFocused();
    expect(await title.evaluate((i: HTMLInputElement) => [i.value, i.selectionStart, i.selectionEnd])).toEqual(['Untitled', 0, 8]);

    await page.keyboard.type('The Keeper'); // (replaces the selected "Untitled")
    await panel.locator('[data-field="author"]').fill('Ann Lee');
    await panel.locator('[data-field="structure"]').selectOption('three-act');
    await panel.locator('[data-field="target"]').fill('90000');
    await page.keyboard.press('Enter');

    await expect(panel).toBeHidden();
    await expect(page.locator('[data-ref="title"]')).toHaveText('The Keeper');
    await expect(page.locator('[data-ref="words"]')).toHaveText('0 of 90,000 words');
    expect(frontMatter(await saved(page))).toBe('---\ntitle: "The Keeper"\nauthor: "Ann Lee"\nstructure: three-act\ntarget: 90000\nbaretext: 1');

    // One change: one undo, from the page.
    expect(await page.evaluate(() => (window as any).__baretext.hasFocus())).toBe(true);
    await page.keyboard.press('Meta+Z');
    expect(await setup(page)).toEqual({ title: 'Untitled', author: '', structure: null, target: null });
    await expect(page.locator('[data-ref="words"]')).toHaveText('0 words');
    await page.keyboard.press('Meta+Shift+Z');
    expect(await setup(page)).toEqual({ title: 'The Keeper', author: 'Ann Lee', structure: 'three-act', target: 90000 });

    // The next new book starts with the author last used.
    await menu(app, 'File', 'New');
    await expect(panel.locator('[data-field="author"]')).toHaveValue('Ann Lee');
  } finally {
    await app.close();
  }
});

test('Book Settings…: Esc changes nothing; a target that isn’t a number of words holds Done; the author goes to export', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    const before = await saved(page);
    await menu(app, 'File', 'Book Settings…');
    const panel = page.locator('.bt-book');
    await expect(panel.locator('.bt-appearance-title')).toHaveText('Book');
    await expect(panel.locator('[data-field="title"]')).toHaveValue('The Lighthouse Keeper');
    await expect(panel.locator('[data-field="author"]')).toHaveValue(''); // (an existing book isn't given one)
    await panel.locator('[data-field="author"]').fill('Somebody');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    expect(await saved(page)).toBe(before);

    await menu(app, 'File', 'Book Settings…');
    await panel.locator('[data-field="author"]').fill('Ann Lee');
    await panel.locator('[data-field="target"]').fill('about 90k');
    await expect(panel.locator('[data-action="done"]')).toBeDisabled();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible(); // not applied
    await expect(panel.locator('[data-field="target"]')).toBeFocused();
    await panel.locator('[data-field="target"]').fill('85,000');
    await panel.locator('[data-action="done"]').click();
    await expect(panel).toBeHidden();
    await expect(page.locator('[data-ref="words"]')).toHaveText('7 of 85,000 words');

    await page.keyboard.press('Meta+Shift+e');
    await expect(page.locator('.bt-export-input')).toHaveValue('Ann Lee');
  } finally {
    await app.close();
  }
});

test('a structure this app doesn’t know (a newer one’s) is kept through the panel and every save', async () => {
  const file = BOOK.replace('baretext: 1', 'structure: future-arc\nbaretext: 1');
  const { app, page } = await launch({ file: { name: 'F.md', content: file } });
  try {
    await menu(app, 'File', 'Book Settings…');
    const panel = page.locator('.bt-book');
    await expect(panel.locator('[data-field="structure"]')).toHaveValue('future-arc');
    await panel.locator('[data-field="title"]').fill('Renamed');
    await page.keyboard.press('Enter');
    expect(frontMatter(await saved(page))).toBe('---\ntitle: "Renamed"\nstructure: future-arc\nbaretext: 1');
  } finally {
    await app.close();
  }
});
