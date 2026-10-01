import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launch, model } from './launch.ts';

const FILE = '# One\n\n## Harbor\n\nThe harbor was quiet. The **harbor** slept.\nDon’t leave the harbor.\n\n## Lighthouse\n\nFar from the Harbor, a light.\n';
const find = (page: Page) => page.evaluate(() => (window as any).__baretext.find());
const sel = (page: Page) => page.evaluate(() => (window as any).__baretext.selection());
const text = async (page: Page) => (await model(page)).chapters[0].scenes.flatMap((s: any) => s.blocks.map((b: any) => b.content.map((r: any) => r.text).join('')));

test('⌘F searches as you type, counts, steps, highlights, and leaves the match selected on Esc', async () => {
  const { app, page } = await launch({ file: { name: 'F.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+f');
    await page.keyboard.type('harbor'); // focus is already in the field
    // 5 matches including the "Harbor" scene name (the text you see); the
    // caret is in the first paragraph, so the first match after it is #2.
    expect((await find(page)).count).toBe('2 of 5');
    await expect(page.locator('.bt-find-match')).toHaveCount(5);
    await expect(page.locator('.bt-find-current')).toHaveCount(1);
    await page.keyboard.press('Enter');
    expect((await find(page)).count).toBe('3 of 5');
    await page.keyboard.press('Shift+Enter');
    expect((await find(page)).count).toBe('2 of 5');
    await page.keyboard.press('Meta+g');
    await page.keyboard.press('Meta+g');
    expect((await find(page)).count).toBe('4 of 5');
    await page.keyboard.press('Meta+Shift+g');
    expect((await find(page)).count).toBe('3 of 5');

    // "don't" finds the curly "Don’t".
    await page.fill('.bt-find-input', "don't");
    expect((await find(page)).count).toBe('1 of 1');
    await page.keyboard.press('Escape');
    expect((await find(page)).open).toBe(false);
    const s = await sel(page);
    expect(await page.evaluate(({ from, to }) => (window as any).__baretext.textBetween(from, to), s)).toBe('Don’t');
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true);
    await page.waitForTimeout(600); // longer than the toolbar's keyboard pause
    expect((await page.evaluate(() => (window as any).__baretext.toolbar())).visible).toBe(false);
    await expect(page.locator('.bt-find-match')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the selection becomes the query; options narrow it', async () => {
  const { app, page } = await launch({ file: { name: 'F.md', content: FILE } });
  try {
    await page.evaluate(() => (window as any).__baretext.selectText('harbor was'));
    await page.keyboard.press('Meta+f');
    expect(await page.inputValue('.bt-find-input')).toBe('harbor was');
    await page.fill('.bt-find-input', 'Harbor');
    expect((await find(page)).count).toMatch(/ of 5$/);
    await page.click('[data-option="case"]');
    expect((await find(page)).count).toMatch(/ of 2$/); // scene name + "Harbor," in the prose
    await page.click('[data-option="case"]');
    await page.fill('.bt-find-input', 'harbo');
    await page.click('[data-option="word"]');
    expect((await find(page)).count).toBe('No results');
  } finally {
    await app.close();
  }
});

test('replace one and replace all keep formatting; all is one undo', async () => {
  const { app, page } = await launch({ file: { name: 'F.md', content: FILE } });
  try {
    await page.evaluate(() => (window as any).__baretext.caretAfter('The harbor was quiet.'));
    await page.keyboard.press('Meta+Alt+f');
    await expect(page.locator('.bt-find-replace-row')).toBeVisible();
    await page.keyboard.type('harbor');
    expect((await find(page)).count).toBe('3 of 5'); // the first after the caret: the bold one
    await page.fill('[data-ref="replace"]', 'port');
    await page.click('[data-action="replace"]');
    const runs = (await model(page)).chapters[0].scenes[0].blocks[0].content;
    expect(runs.find((r: any) => r.bold)?.text).toBe('port'); // keeps the bold
    expect((await find(page)).count).toBe('3 of 4'); // moved on to the next one

    await page.click('[data-action="all"]');
    expect((await find(page)).count).toBe('Replaced 4');
    expect((await text(page)).join('\n')).not.toMatch(/harbor/i);
    expect((await model(page)).chapters[0].scenes[0].name).toBe('port'); // the scene name too
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+z');
    expect((await text(page)).join('\n').match(/harbor/gi)).toHaveLength(3); // back to just the one-off replace
    expect((await model(page)).chapters[0].scenes[0].name).toBe('Harbor');
  } finally {
    await app.close();
  }
});

test('find on a 120k-word book stays fast, and a common letter is capped', async () => {
  const content = readFileSync(new URL('../../samples/lorem-ipsum-120k.md', import.meta.url), 'utf8');
  const { app, page } = await launch({ file: { name: 'L.md', content } });
  try {
    await page.keyboard.press('Meta+f');
    const times: number[] = [];
    for (const ch of 'dolore magna') {
      await page.keyboard.type(ch);
      times.push((await find(page)).ms);
    }
    await page.fill('.bt-find-input', 'e');
    expect((await find(page)).count).toMatch(/of 10,000\+$/);
    await expect(page.locator('.bt-find-match').first()).toBeVisible();
    expect(await page.locator('.bt-find-match').count()).toBeLessThanOrEqual(601);
    console.log(`find keystroke max ${Math.max(...times).toFixed(1)} ms`);
    expect(Math.max(...times.slice(1))).toBeLessThan(25);
  } finally {
    await app.close();
  }
});

test('Replace is discoverable from the find bar: a toggle shows it', async () => {
  const { app, page } = await launch({ file: { name: 'F.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+f');
    const row = page.locator('.bt-find-replace-row');
    const toggle = page.locator('[data-action="toggle-replace"]');
    await expect(row).toBeHidden();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(row).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Find and Replace fields line up exactly.
    const [findBox, replaceBox] = await Promise.all([
      page.locator('.bt-find-input').first().boundingBox(),
      page.locator('[data-ref="replace"]').boundingBox(),
    ]);
    expect(replaceBox!.x).toBe(findBox!.x);
    expect(replaceBox!.width).toBe(findBox!.width);
    await expect(page.locator('[data-ref="replace"]')).toBeFocused();

    await toggle.click();
    await expect(row).toBeHidden();
    await expect(page.locator('.bt-find-input').first()).toBeFocused();

    // ⌥⌘F with find already open and a query: straight to the Replace field.
    await page.keyboard.type('harbor');
    await page.keyboard.press('Meta+Alt+f');
    await expect(row).toBeVisible();
    await expect(page.locator('[data-ref="replace"]')).toBeFocused();
  } finally {
    await app.close();
  }
});

test('Replace after editing the manuscript (find still open) replaces the right words, never stale positions', async () => {
  const { app, page } = await launch({ file: { name: 'F.md', content: '# One\n\nThe cat sat on the mat.\n\nA dog lay by the door.\n' } });
  try {
    await page.keyboard.press('Meta+Alt+f');
    await page.keyboard.type('the');
    await page.locator('[data-ref="replace"]').fill('THE');
    // Back to the manuscript: type before the matches, which moves them.
    await page.evaluate(() => (window as any).__baretext.selectText('The cat'));
    await page.keyboard.press('ArrowLeft'); // the caret just before the current match
    await page.keyboard.type('Yes. ');
    await page.click('.bt-find [data-action="replace"]');
    const text = JSON.stringify(await model(page));
    expect(text).toContain('Yes. THE cat sat on the mat.'); // the match itself was replaced; what was typed is untouched
    expect(text).toContain('A dog lay by the door.');
  } finally {
    await app.close();
  }
});
