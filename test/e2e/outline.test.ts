import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launch, model } from './launch.ts';

// 4 chapters × 3 scenes, each scene long enough to fill a window.
const para = 'Words that fill the scene so that it takes up real vertical space on the page. '.repeat(3);
const FILE = [1, 2, 3, 4].map((c) =>
  `# Chapter ${c}\n\n` + [1, 2, 3].map((s) => `## Scene ${c}.${s}\n\n` + Array.from({ length: 8 }, () => para).join('\n')).join('\n\n'),
).join('\n\n') + '\n';

const bt = (page: Page) => ({
  outline: () => page.evaluate(() => (window as any).__baretext.outline()),
  scene: () => page.evaluate(() => (window as any).__baretext.currentScene()),
  hasFocus: () => page.evaluate(() => (window as any).__baretext.hasFocus()),
  caretTop: () => page.evaluate(() => (window as any).__baretext.caretTop()),
});
const row = (page: Page, label: string) => page.locator(`.bt-outline-row[aria-label^="${label}"]`);

async function hoverSpine(page: Page) {
  const b = (await page.locator('.bt-spine').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
}

test('the outline opens only deliberately: hovering the spine never opens it', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    await hoverSpine(page);
    await page.waitForTimeout(800);
    expect((await bt(page).outline()).presence).toBe('hidden');
    // The ticks stay clickable.
    const hit = await page.evaluate(() => {
      const b = document.querySelector('.bt-tick')!.getBoundingClientRect();
      return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.className ?? '';
    });
    expect(hit).toContain('bt-tick');
  } finally {
    await app.close();
  }
});

test('the title bar sidebar button opens and closes the outline without taking focus from the manuscript', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    const t = bt(page);
    const button = page.locator('[data-ref="sidebar"]');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();
    expect((await t.outline()).presence).toBe('pinned');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toHaveAttribute('aria-label', 'Hide outline');
    expect(await t.hasFocus()).toBe(true);
    // Choosing a scene goes there; the outline stays open.
    await row(page, '3.2 ').click();
    expect(await t.scene()).toBe((await model(page)).chapters[2].scenes[1].id);
    expect(await t.hasFocus()).toBe(true);
    expect((await t.outline()).presence).toBe('pinned');
    await button.click();
    expect((await t.outline()).presence).toBe('hidden');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await app.close();
  }
});

test('⌘\\ pins the outline beside the page without moving the caret line, and it is remembered', async () => {
  const { app, page, userData, saveDir } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    const t = bt(page);
    await page.evaluate(async (id) => (window as any).__baretext.navigate(id), (await model(page)).chapters[0].scenes[0].id);
    await page.waitForTimeout(500); // the jump's motion settles
    const before = await t.caretTop();
    const pageLeft = async () => (await page.locator('.bt-scroller').boundingBox())!.x;
    const left0 = await pageLeft();
    await page.keyboard.press('Meta+Backslash');
    expect((await t.outline()).presence).toBe('pinned');
    expect(await pageLeft()).toBeGreaterThan(left0); // a column, not an overlay
    expect(await t.caretTop()).toBeCloseTo(before, 0);
    expect(await t.hasFocus()).toBe(true);
    // Typing keeps the counts current (after a short pause) and never takes focus.
    await page.keyboard.type('Fresh words here ');
    await expect.poll(() => row(page, '1.1 ').getAttribute('aria-label')).toContain('387 words');
    expect(await t.hasFocus()).toBe(true);
    await page.waitForTimeout(200);
    expect(JSON.parse(readFileSync(`${userData}/settings.json`, 'utf8')).outline).toBe('pinned');
    await app.close();

    const again = await launch({ reuse: { userData, saveDir } });
    try {
      expect((await bt(again.page).outline()).presence).toBe('pinned');
      await again.page.keyboard.press('Meta+Backslash');
      expect((await bt(again.page).outline()).presence).toBe('hidden');
    } finally {
      await again.app.close();
    }
  } finally {
    await app.close().catch(() => {});
  }
});

test('the outline is a keyboard tree: ⌥⌘\\ enters on the current scene, arrows move and fold, Enter goes, Esc returns', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    const t = bt(page);
    const m = await model(page);
    await page.evaluate((id) => (window as any).__baretext.navigate(id), m.chapters[1].scenes[1].id);
    await page.keyboard.press('Meta+Alt+Backslash');
    expect(await t.outline()).toEqual({ presence: 'pinned', focused: true });
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
    expect(await focused()).toMatch(/^2\.2 /);
    await expect(page.locator('.bt-outline-row[tabindex="0"]')).toHaveCount(1); // one tab stop

    await page.keyboard.press('ArrowDown');
    expect(await focused()).toMatch(/^2\.3 /);
    await page.keyboard.press('ArrowLeft'); // to its chapter
    expect(await focused()).toMatch(/^Chapter 2 /);
    await page.keyboard.press('ArrowLeft'); // fold it
    await expect(row(page, 'Chapter 2 ')).toHaveAttribute('aria-expanded', 'false');
    await expect(row(page, '2.1 ')).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    expect(await focused()).toMatch(/^Chapter 3 /);
    await page.keyboard.press('ArrowRight'); // into its first scene
    await page.keyboard.press('ArrowDown');
    expect(await focused()).toMatch(/^3\.2 /);
    await page.keyboard.press('Enter');
    expect(await t.scene()).toBe(m.chapters[2].scenes[1].id);
    expect(await t.hasFocus()).toBe(true);

    // Esc from the tree goes back to the manuscript, caret untouched, focus mode untouched.
    await page.keyboard.press('Meta+Alt+Backslash');
    const sel = await page.evaluate(() => (window as any).__baretext.selection());
    await page.keyboard.press('Escape');
    expect(await t.hasFocus()).toBe(true);
    expect(await page.evaluate(() => (window as any).__baretext.selection())).toEqual(sel);
    expect((await t.outline()).presence).toBe('pinned');
  } finally {
    await app.close();
  }
});

test('focus mode hides the pinned outline and brings it back', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+Backslash');
    const outline = page.locator('.bt-outline');
    await expect(outline).toBeVisible();
    await page.keyboard.press('Meta+.');
    await expect(outline).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(outline).toBeVisible();
    expect((await bt(page).outline()).presence).toBe('pinned');
  } finally {
    await app.close();
  }
});

test('opening and closing are motion: the column slides, the page glides, rows cascade; reduced motion skips it', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    const t = bt(page);
    const moving = () => page.evaluate(() => {
      const targets = document.getAnimations().map((a) => (a.effect as KeyframeEffect).target as HTMLElement);
      return {
        column: targets.some((e) => e?.classList.contains('bt-outline')),
        page: targets.some((e) => e?.classList.contains('bt-page')),
        rows: targets.filter((e) => e?.classList.contains('bt-outline-row')).length,
      };
    });
    await page.click('[data-ref="sidebar"]');
    const opening = await moving();
    expect(opening.column).toBe(true);
    expect(opening.page).toBe(true);
    expect(opening.rows).toBeGreaterThan(3);
    expect(await t.hasFocus()).toBe(true);
    await page.waitForTimeout(700);

    // Closing: the state changes at once, but the column stays painted until it has slid away.
    await page.click('[data-ref="sidebar"]');
    expect((await t.outline()).presence).toBe('hidden');
    await expect(page.locator('.bt-outline')).toBeVisible();
    await expect(page.locator('.bt-outline')).toBeHidden();

    // Reduced motion: no animation at all.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('[data-ref="sidebar"]');
    expect(await moving()).toEqual({ column: false, page: false, rows: 0 });
    await expect(page.locator('.bt-outline')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the sidebar button turns into a close button while the outline is open', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    const button = page.locator('[data-ref="sidebar"]');
    const chevron = () => button.locator('.bt-sidebar-chevron').evaluate((e) => getComputedStyle(e).opacity);
    expect(await chevron()).toBe('0');
    await button.click();
    await expect(button).toHaveAttribute('aria-label', 'Hide outline');
    expect(await button.getAttribute('title')).toContain('Hide outline');
    await expect.poll(chevron).toBe('1');
    await button.click();
    await expect(button).toHaveAttribute('aria-label', 'Show outline');
    await expect.poll(chevron).toBe('0');
  } finally {
    await app.close();
  }
});
