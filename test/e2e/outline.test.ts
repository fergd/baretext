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

test('rename from the outline: F2 or double-click, Enter keeps it, Esc cancels, blank unnames a scene', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    const t = bt(page);
    const m0 = await model(page);
    await page.evaluate((id) => (window as any).__baretext.navigate(id), m0.chapters[0].scenes[0].id);
    const caret = await page.evaluate(() => (window as any).__baretext.selection());
    const input = page.locator('.bt-outline-input');

    // Keyboard: F2 on a row, type, Enter. Focus returns to the row.
    await page.keyboard.press('Meta+Alt+Backslash');
    await page.keyboard.press('ArrowDown'); // 1.2
    await page.keyboard.press('F2');
    await expect(input).toBeFocused();
    expect(await input.inputValue()).toBe('Scene 1.2');
    await page.keyboard.type('The Quarry'); // replaces the selected name
    await page.keyboard.press('Enter');
    expect((await model(page)).chapters[0].scenes[1].name).toBe('The Quarry');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')).toMatch(/^1\.2 The Quarry/);
    // Arrow keys inside the field never moved the tree, and the caret never moved.
    expect(await page.evaluate(() => (window as any).__baretext.selection())).toEqual(caret);

    // Esc cancels.
    await page.keyboard.press('F2');
    await page.keyboard.type('Nope');
    await page.keyboard.press('Escape');
    expect((await model(page)).chapters[0].scenes[1].name).toBe('The Quarry');
    expect((await t.outline()).focused).toBe(true); // Esc left the field, not the outline

    // Blank: the scene becomes unnamed. One ⌘Z brings the name back.
    await page.keyboard.press('F2');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    expect((await model(page)).chapters[0].scenes[1].name).toBe(null);
    await expect(row(page, '1.2 Unnamed scene')).toHaveCount(1);
    await page.keyboard.press('Escape'); // back to the manuscript
    await page.keyboard.press('Meta+z');
    expect((await model(page)).chapters[0].scenes[1].name).toBe('The Quarry');

    // Mouse: double-click a chapter's name; clicking inside the field doesn't navigate; clicking away keeps the edit.
    await row(page, 'Chapter 3 ').locator('.bt-outline-name').dblclick();
    await expect(input).toBeFocused();
    await input.click();
    await page.keyboard.press('End');
    await page.keyboard.type(': The Return');
    await page.locator('.bt-scroller').click({ position: { x: 600, y: 200 } });
    expect((await model(page)).chapters[2].title).toBe('Chapter 3: The Return');
    await expect(input).toHaveCount(0);
    expect(await t.hasFocus()).toBe(true);

    // The book title.
    await page.click('.bt-outline-title');
    await page.keyboard.type('Testing the Spirits');
    await page.keyboard.press('Enter');
    expect((await model(page)).title).toBe('Testing the Spirits');
    expect(await page.$eval('[data-ref="title"]', (e) => e.textContent)).toBe('Testing the Spirits');
    expect(await t.hasFocus()).toBe(true);
  } finally {
    await app.close();
  }
});

test('adding: + on a chapter adds a scene there and goes to it; New chapter adds one and asks for its title', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    const t = bt(page);
    await page.click('[data-ref="sidebar"]');
    const chapter2 = row(page, 'Chapter 2 ');
    const add = chapter2.locator('.bt-outline-action[data-action="add"]');
    await expect(add).toBeHidden();
    await chapter2.hover();
    await expect(add).toBeVisible();
    await add.click();
    let m = await model(page);
    expect(m.chapters.map((c: any) => c.scenes.length)).toEqual([3, 4, 3, 3]);
    expect(await t.scene()).toBe(m.chapters[1].scenes[3].id);
    expect(await t.hasFocus()).toBe(true);
    await expect(row(page, '2.4 Unnamed scene')).toHaveAttribute('aria-current', 'location');
    await page.keyboard.type('First words.');
    expect((await model(page)).chapters[1].scenes[3].blocks[0].content[0].text).toBe('First words.');

    // Keyboard: ⌘↵ on a chapter row.
    await page.keyboard.press('Meta+Alt+Backslash');
    await page.keyboard.press('Home'); // Chapter 1
    await page.keyboard.press('Meta+Enter');
    expect((await model(page)).chapters[0].scenes).toHaveLength(4);
    expect(await t.hasFocus()).toBe(true);

    // New chapter: at the end, with its title field open; Enter names it and returns to the page.
    await page.click('.bt-outline-new-chapter');
    await expect(page.locator('.bt-outline-input')).toBeFocused();
    await page.keyboard.type('Epilogue');
    await page.keyboard.press('Enter');
    m = await model(page);
    expect(m.chapters.map((c: any) => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Epilogue']);
    expect(await t.scene()).toBe(m.chapters[4].scenes[0].id);
    expect(await t.hasFocus()).toBe(true);

    // Undo takes back the title, then the chapter.
    await page.keyboard.press('Meta+z');
    expect((await model(page)).chapters[4].title).toBe('');
    await page.keyboard.press('Meta+z');
    expect((await model(page)).chapters).toHaveLength(4);
  } finally {
    await app.close();
  }
});

test('New chapter from the palette with the outline closed puts the caret in its title on the page', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('new chapter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Coda');
    const m = await model(page);
    expect(m.chapters).toHaveLength(5);
    expect(m.chapters[4].title).toBe('Coda');
  } finally {
    await app.close();
  }
});

// ── drag to reorder ──
async function openOutline(page: Page) {
  await page.click('[data-ref="sidebar"]');
  await page.waitForFunction(() => document.getAnimations().length === 0); // settled
}
async function drag(page: Page, from: string, to: string, where: 'top' | 'bottom' | 'middle', opts: { cancel?: boolean } = {}) {
  const a = (await row(page, from).boundingBox())!;
  const b = (await row(page, to).boundingBox())!;
  const y = where === 'top' ? b.y + 4 : where === 'bottom' ? b.y + b.height - 4 : b.y + b.height / 2;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, y, { steps: 8 });
  if (opts.cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}
const order = async (page: Page): Promise<string[][]> => (await model(page)).chapters.map((c: any) => [c.title, ...c.scenes.map((s: any) => s.name)]);

test('drag a scene: within its chapter, into another, or onto a chapter (its end); the caret and focus stay put', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    const t = bt(page);
    await openOutline(page);
    const scene0 = await t.scene();

    await drag(page, '1.1 ', '1.2 ', 'bottom');
    expect((await order(page))[0]).toEqual(['Chapter 1', 'Scene 1.2', 'Scene 1.1', 'Scene 1.3']);
    expect(await t.scene()).toBe(scene0); // the caret went with its scene, not to the drop
    expect(await t.hasFocus()).toBe(true);

    await drag(page, '1.3 ', '3.2 ', 'top');
    expect((await order(page))[2]).toEqual(['Chapter 3', 'Scene 3.1', 'Scene 1.3', 'Scene 3.2', 'Scene 3.3']);
    expect((await order(page))[0]).toEqual(['Chapter 1', 'Scene 1.2', 'Scene 1.1']);

    await drag(page, '2.1 ', 'Chapter 4 ', 'middle');
    expect((await order(page))[3]).toEqual(['Chapter 4', 'Scene 4.1', 'Scene 4.2', 'Scene 4.3', 'Scene 2.1']);

    // One ⌘Z per move.
    await page.keyboard.press('Meta+z');
    expect((await order(page))[1]).toEqual(['Chapter 2', 'Scene 2.1', 'Scene 2.2', 'Scene 2.3']);
  } finally {
    await app.close();
  }
});

test('drag a chapter with all its scenes; Esc or dropping in place changes nothing', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    await openOutline(page);
    const start = await order(page);
    await drag(page, 'Chapter 3 ', 'Chapter 1 ', 'top');
    expect((await order(page)).map((c) => c[0])).toEqual(['Chapter 3', 'Chapter 1', 'Chapter 2', 'Chapter 4']);
    expect((await order(page))[0]).toEqual(start[2]);

    const now = await order(page);
    await drag(page, 'Chapter 2 ', 'Chapter 4 ', 'top', { cancel: true });
    expect(await order(page)).toEqual(now);
    await expect(page.locator('.bt-outline-ghost')).toHaveCount(0, { timeout: 2000 });
    expect((await bt(page).outline()).presence).toBe('pinned'); // Esc only cancelled the drag
    await drag(page, '2.2 ', '2.2 ', 'top');
    expect(await order(page)).toEqual(now);
    // A drag never navigates.
    expect(await bt(page).scene()).toBe((await model(page)).chapters[1].scenes[0].id);
  } finally {
    await app.close();
  }
});

test("a chapter's only scene can't be dragged out (the chapter would be empty)", async () => {
  const file = '# One\n\n## A\n\nText a.\n\n# Two\n\n## Only\n\nText only.\n';
  const { app, page } = await launch({ file: { name: 'S.md', content: file } });
  try {
    await openOutline(page);
    const start = await order(page);
    await drag(page, '2.1 ', '1.1 ', 'top');
    expect(await order(page)).toEqual(start);
  } finally {
    await app.close();
  }
});

test('the outline is 296px wide, and 248px in a window narrower than 1,100px', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    const width = () => page.$eval('.bt-outline', (e) => e.getBoundingClientRect().width);
    const pageLeft = () => page.$eval('.bt-scroller', (e) => e.getBoundingClientRect().left);
    const size = (w: number) => app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setContentSize(w, 760), w);
    await size(1300);
    await page.click('[data-ref="sidebar"]');
    await expect.poll(width).toBe(296);
    expect(await pageLeft()).toBe(296);
    await size(1000);
    await expect.poll(width).toBe(248);
    expect(await pageLeft()).toBe(248);
    await size(1100);
    await expect.poll(width).toBe(296);
  } finally {
    await app.close();
  }
});

test('opening another manuscript mid-action leaves nothing of the old one behind (rename field, palette, panels)', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+Alt+Backslash');
    await page.keyboard.press('F2');
    await page.keyboard.type('Half-typed name');
    await expect(page.locator('.bt-outline-input')).toBeFocused();
    await app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu()!.items.find((i) => i.label === 'File')!;
      file.submenu!.items.find((i) => i.label === 'New')!.click();
    });
    await expect.poll(() => page.evaluate(() => (window as any).__baretext.model().chapters.length)).toBe(1);
    await expect(page.locator('.bt-outline-input')).toHaveCount(0);
    await expect(page.locator('.bt-outline-row')).toHaveCount(2); // the new manuscript: one chapter, one scene
    // The old manuscript kept its name: the half-typed rename went nowhere.
    expect(JSON.stringify(await page.evaluate(() => (window as any).__baretext.model()))).not.toContain('Half-typed');

    // Appearance open while a file opens from the menu bar: it closes (its sample showed the old book).
    await page.keyboard.press('Meta+Comma');
    await app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu()!.items.find((i) => i.label === 'File')!;
      file.submenu!.items.find((i) => i.label === 'New')!.click();
    });
    await expect.poll(() => page.evaluate(() => (window as any).__baretext.appearance().open)).toBe(false);
  } finally {
    await app.close();
  }
});

test('reading back with the outline open: the current-scene highlight glides to the new row, not a jump', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    await page.click('[data-ref="sidebar"]');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const highlight = page.locator('.bt-outline-current');
    await expect(highlight).toHaveAttribute('data-visible', 'true');
    const box = (await page.locator('.bt-scroller').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const start = await page.locator('.bt-outline-row[aria-current="location"]').getAttribute('aria-label');
    // Scroll by hand until another scene is the one being read.
    let gliding = false;
    for (let i = 0; i < 30 && !gliding; i++) {
      await page.mouse.wheel(0, 400);
      gliding = await page.evaluate(() => document.getAnimations().some((a) =>
        (a as CSSTransition).transitionProperty === 'transform' && ((a.effect as KeyframeEffect).target as HTMLElement)?.classList.contains('bt-outline-current')));
    }
    expect(gliding).toBe(true);
    expect(await page.locator('.bt-outline-row[aria-current="location"]').getAttribute('aria-label')).not.toBe(start);
    // It settles exactly on the current row.
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const [h, row] = await page.$$eval('.bt-outline-current, .bt-outline-row[aria-current="location"]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(h).toBe(row);
  } finally {
    await app.close();
  }
});

// ── delete (two steps) ──
const armed = (page: Page) => page.locator('.bt-outline-row[data-arming="true"]');

test('delete a scene with the mouse: arm, then confirm; a snapshot first, ⌘Z brings it back', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    await openOutline(page);
    const before = await model(page);
    const target = row(page, '1.2 ');
    await target.hover();
    await target.locator('.bt-outline-action[data-action="delete"]').click();
    await expect(armed(page)).toHaveCount(1);
    await expect(armed(page).locator('.bt-outline-name')).toHaveText('Delete 1.2 “Scene 1.2”?');
    expect(await model(page)).toEqual(before); // nothing yet
    await armed(page).getByRole('button', { name: /Confirm: delete 1\.2/ }).click();
    expect((await order(page))[0]).toEqual(['Chapter 1', 'Scene 1.1', 'Scene 1.3']);
    await expect(page.locator('[data-ref="toast"]')).toContainText('Deleted 1.2 “Scene 1.2”');
    await expect(page.locator('[data-ref="toast"]')).toContainText('⌘Z brings it back');
    expect(await bt(page).hasFocus()).toBe(true);
    // The manuscript as it was is in History.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'history'));
    await expect(page.locator('.bt-history-row').first()).toContainText('Before deleting 1.2 “Scene 1.2”');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+z');
    expect(await model(page)).toEqual(before);
  } finally {
    await app.close();
  }
});

test('delete with the keyboard: ⌫ arms, Esc cancels, ⌫ then ↵ deletes a whole chapter', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    await openOutline(page);
    await page.keyboard.press('Meta+Alt+Backslash'); // focus on 1.1
    await page.keyboard.press('ArrowUp'); // Chapter 1
    await page.keyboard.press('Backspace');
    await expect(armed(page).locator('.bt-outline-name')).toHaveText('Delete chapter 1 and its 3 scenes?');
    await page.keyboard.press('Escape');
    await expect(armed(page)).toHaveCount(0);
    expect((await bt(page).outline()).focused).toBe(true); // Esc only cancelled
    expect((await model(page)).chapters).toHaveLength(4);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    expect((await order(page)).map((c) => c[0])).toEqual(['Chapter 2', 'Chapter 3', 'Chapter 4']);
    await expect(page.locator('[data-ref="toast"]')).toContainText('Deleted chapter 1 “Chapter 1”');
  } finally {
    await app.close();
  }
});

test('an armed delete is cancelled by clicking elsewhere or by waiting', async () => {
  const { app, page } = await launch({ file: { name: 'O.md', content: FILE } });
  try {
    await openOutline(page);
    const target = row(page, '2.1 ');
    await target.hover();
    await target.locator('.bt-outline-action[data-action="delete"]').click();
    await expect(armed(page)).toHaveCount(1);
    await page.locator('.bt-scroller').click({ position: { x: 600, y: 300 } });
    await expect(armed(page)).toHaveCount(0);
    await target.hover();
    await target.locator('.bt-outline-action[data-action="delete"]').click();
    await expect(armed(page)).toHaveCount(1);
    await expect(armed(page)).toHaveCount(0, { timeout: 6000 }); // disarms by itself after a few seconds
    expect((await model(page)).chapters[1].scenes).toHaveLength(3);
  } finally {
    await app.close();
  }
});

test("deleting a chapter's only scene leaves the chapter with an empty scene", async () => {
  const file = '# One\n\n## Only\n\nThe only scene.\n\n# Two\n\nMore.\n';
  const { app, page } = await launch({ file: { name: 'S.md', content: file } });
  try {
    await openOutline(page);
    const target = row(page, '1.1 ');
    await target.hover();
    await target.locator('.bt-outline-action[data-action="delete"]').click();
    await armed(page).getByRole('button', { name: /Confirm/ }).click();
    const m = await model(page);
    expect(m.chapters[0].title).toBe('One');
    expect(m.chapters[0].scenes).toHaveLength(1);
    expect(JSON.stringify(m)).not.toContain('The only scene');
  } finally {
    await app.close();
  }
});
