import { expect, test, type Page } from '@playwright/test';
import { launch, model } from './launch.ts';

const FILE = '# One\n\n## Scene\n\nThe quick brown fox jumps over the lazy dog.\nSecond paragraph here.\nThird paragraph at the end.\n';

/** Viewport rect of `word` (first occurrence) in the manuscript. */
const wordRect = (page: Page, word: string) => page.evaluate((word) => {
  const walker = document.createTreeWalker(document.querySelector('.ProseMirror')!, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.textContent!.indexOf(word);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + word.length);
    return r.getBoundingClientRect().toJSON() as DOMRect;
  }
  throw new Error(`not found: ${word}`);
}, word);

/** The toolbar's wait for a keyboard selection to pause (KEYBOARD_PAUSE_MS in toolbar.ts). */
const PAUSE_MS = 400;
const bar = (page: Page) => page.evaluate(() => (window as any).__baretext.toolbar());
const selection = (page: Page) => page.evaluate(() => (window as any).__baretext.selection());
const paragraphs = async (page: Page) => (await model(page)).chapters[0].scenes[0].blocks;

async function dragSelect(page: Page, from: string, to: string) {
  const a = await wordRect(page, from);
  const b = await wordRect(page, to);
  await page.mouse.move(a.left + 1, a.top + a.height / 2);
  await page.mouse.down();
  await page.mouse.move((a.left + b.right) / 2, b.top + b.height / 2, { steps: 4 });
  await page.mouse.move(b.right - 1, b.top + b.height / 2, { steps: 2 });
  expect((await bar(page)).visible).toBe(false); // never while dragging
  await page.mouse.up();
}

test('appears above a mouse selection, formats it, and keeps the selection', async () => {
  const { app, page } = await launch({ file: { name: 'T.md', content: FILE } });
  try {
    await dragSelect(page, 'quick', 'brown');
    await expect.poll(async () => (await bar(page)).visible).toBe(true);
    const sel = await selection(page);
    expect(sel.to - sel.from).toBe('quick brown'.length);

    // Centered above the selection.
    const r = await wordRect(page, 'quick');
    const { el } = await bar(page);
    await expect.poll(async () => (await bar(page)).el.bottom).toBeLessThanOrEqual(r.top);
    const center = (r.left + (await wordRect(page, 'brown')).right) / 2;
    expect(Math.abs(el.left + el.width / 2 - center)).toBeLessThanOrEqual(1);

    await page.click('.bt-toolbar-button[data-action="bold"]');
    expect((await paragraphs(page))[0].content).toEqual([
      { text: 'The ' }, { text: 'quick brown', bold: true }, { text: ' fox jumps over the lazy dog.' },
    ]);
    expect(await selection(page)).toEqual(sel);
    expect((await bar(page)).visible).toBe(true);
    await expect(page.locator('.bt-toolbar-button[data-action="bold"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true);

    // Typing replaces the selection and hides the toolbar.
    await page.keyboard.type('slow');
    expect((await bar(page)).visible).toBe(false);
    expect((await paragraphs(page))[0].content.map((r: any) => r.text).join('')).toBe('The slow fox jumps over the lazy dog.');
  } finally {
    await app.close();
  }
});

test('keyboard selection: appears after a pause; Esc hides it; ⌘B keeps it', async () => {
  const { app, page } = await launch({ file: { name: 'T.md', content: FILE } });
  try {
    const r = await wordRect(page, 'Second');
    await page.mouse.click(r.left + 1, r.top + r.height / 2);
    await page.keyboard.press('Home');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
    expect((await bar(page)).visible).toBe(false); // not while still selecting
    await expect.poll(async () => (await bar(page)).visible).toBe(true);

    await page.keyboard.press('Meta+b');
    expect((await paragraphs(page))[1].content[0]).toEqual({ text: 'Second', bold: true });
    expect((await bar(page)).visible).toBe(true);

    await page.keyboard.press('Escape');
    expect((await bar(page)).visible).toBe(false);
    const sel = await selection(page);
    expect(sel.to - sel.from).toBe(6); // Esc keeps the selection
  } finally {
    await app.close();
  }
});

test('quote button wraps and unwraps the selected paragraphs', async () => {
  const { app, page } = await launch({ file: { name: 'T.md', content: FILE } });
  try {
    await dragSelect(page, 'Second', 'Third');
    await expect.poll(async () => (await bar(page)).visible).toBe(true);
    await page.click('.bt-toolbar-button[data-action="quote"]');
    const blocks = await paragraphs(page);
    expect(blocks.map((b: any) => b.type)).toEqual(['paragraph', 'quote', 'paragraph']);
    expect(blocks[1].paragraphs).toHaveLength(2);
    await expect(page.locator('.bt-toolbar-button[data-action="quote"]')).toHaveAttribute('aria-pressed', 'true');
    await page.click('.bt-toolbar-button[data-action="quote"]');
    // Back exactly as it was: the line quoting added at the scene's end goes too.
    expect((await paragraphs(page)).map((b: any) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  } finally {
    await app.close();
  }
});

const linkFromMenu = (app: import('@playwright/test').ElectronApplication) => app.evaluate(({ Menu }) => {
  const format = Menu.getApplicationMenu()!.items.find((i) => i.label === 'Format')!;
  format.submenu!.items.find((i) => i.label === 'Link…')!.click();
});

test('the link button edits a link in the toolbar and returns to the same selection', async () => {
  const { app, page } = await launch({ file: { name: 'T.md', content: FILE } });
  try {
    await dragSelect(page, 'lazy', 'dog');
    await expect.poll(async () => (await bar(page)).visible).toBe(true);
    const sel = await selection(page);
    // ⌘K is the command palette: it never opens the link field.
    await page.keyboard.press('Meta+k');
    expect((await page.evaluate(() => (window as any).__baretext.palette())).view).toBe('commands');
    await expect(page.locator('.bt-toolbar')).toHaveAttribute('data-mode', 'buttons');
    await page.keyboard.press('Escape'); // closes the palette; the selection is untouched
    expect(await selection(page)).toEqual(sel);
    await page.click('.bt-toolbar-button[data-action="link"]');
    const input = page.locator('.bt-toolbar-input');
    await expect(input).toBeFocused();
    await expect(page.locator('.bt-pending-selection')).toHaveText('lazy dog');

    await page.keyboard.type('not a link');
    await page.keyboard.press('Enter');
    await expect(input).toHaveAttribute('aria-invalid', 'true'); // stays open, nothing applied

    await input.fill('example.com');
    await page.keyboard.press('Enter');
    const runs = (await paragraphs(page))[0].content;
    expect(runs.find((r: any) => r.text === 'lazy dog').link).toBe('https://example.com');
    expect(await selection(page)).toEqual(sel);
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true);
    await expect(page.locator('.bt-pending-selection')).toHaveCount(0);

    // Reopen from the menu: shows the current link; Remove takes it off.
    await linkFromMenu(app);
    await expect(input).toHaveValue('https://example.com');
    await page.click('.bt-toolbar-text-button');
    expect((await paragraphs(page))[0].content.some((r: any) => r.link)).toBe(false);

    // Esc from the field changes nothing and goes back to the editor.
    await linkFromMenu(app);
    await expect(input).toBeFocused();
    await page.keyboard.type('example.org');
    await page.keyboard.press('Escape');
    expect((await paragraphs(page))[0].content.some((r: any) => r.link)).toBe(false);
    expect(await selection(page)).toEqual(sel);
  } finally {
    await app.close();
  }
});

test('never appears for titles; hides while the selection is scrolled away', async () => {
  const long = '# One\n\n## Scene\n\n' + Array.from({ length: 80 }, (_, i) => `Paragraph number ${i + 1} of the long scene.`).join('\n') + '\n';
  const { app, page } = await launch({ file: { name: 'T.md', content: long } });
  try {
    const t = await wordRect(page, 'Scene');
    await page.mouse.dblclick(t.left + 2, t.top + t.height / 2);
    await page.waitForTimeout(500);
    expect((await bar(page)).visible).toBe(false);

    const w = await wordRect(page, 'number 3 ');
    await page.mouse.dblclick(w.left + 2, w.top + w.height / 2);
    await expect.poll(async () => (await bar(page)).visible).toBe(true);
    await page.evaluate(() => { document.querySelector('[data-ref="scroller"]')!.scrollTop += 2000; });
    await expect.poll(async () => (await bar(page)).visible).toBe(false);
    await page.evaluate(() => { document.querySelector('[data-ref="scroller"]')!.scrollTop = 0; });
    await expect.poll(async () => (await bar(page)).visible).toBe(true);
  } finally {
    await app.close();
  }
});

test('a keyboard selection right after a click still waits for the pause', async () => {
  const { app, page } = await launch({ file: { name: 'T.md', content: FILE } });
  try {
    const r = await wordRect(page, 'Second');
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Escape');
      // Mouse up and a Shift+Arrow in the same moment (no awaits between).
      await page.evaluate(() => { document.querySelector('[data-ref="scroller"]')!.scrollTop = 0; });
      const started = Date.now();
      await Promise.all([
        page.mouse.click(r.left + 1, r.top + r.height / 2),
        page.keyboard.press('Shift+ArrowRight'),
      ]);
      await page.keyboard.press('Shift+ArrowRight');
      // The selection and the toolbar, read in the same instant.
      const { sel, visible } = await page.evaluate(() => ({ sel: (window as any).__baretext.selection(), visible: (window as any).__baretext.toolbar().visible }));
      // (On a busy machine the pause itself may have run out by now: then there is nothing to judge.)
      if (sel.to > sel.from && Date.now() - started < PAUSE_MS - 100) expect(visible, `iteration ${i}`).toBe(false);
    }
  } finally {
    await app.close();
  }
});
