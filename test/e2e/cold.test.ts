import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launch, model } from './launch.ts';

// 3 chapters × 3 scenes, each scene long enough to fill some of the window.
const para = 'Words that fill the scene so that it takes up real vertical space on the page. '.repeat(2);
const FILE = [1, 2, 3].map((c) =>
  `# Chapter ${c}\n\n` + [1, 2, 3].map((s) => `## Scene ${c}.${s}\n\n` + Array.from({ length: 6 }, () => para).join('\n')).join('\n\n'),
).join('\n\n') + '\n';

const bt = (page: Page) => ({
  scene: () => page.evaluate(() => (window as any).__baretext.currentScene()),
  selection: () => page.evaluate(() => (window as any).__baretext.selection()),
  hasFocus: () => page.evaluate(() => (window as any).__baretext.hasFocus()),
});
const row = (page: Page, label: string) => page.locator(`.bt-outline-row[aria-label^="${label}"]`);
const names = async (page: Page) => (await model(page)).chapters.map((c: any) => c.scenes.map((s: any) => s.name));
const parked = async (page: Page) => (await model(page)).coldStorage.map((s: any) => s.name);
async function openOutline(page: Page) {
  await page.click('[data-ref="sidebar"]');
  await page.waitForFunction(() => document.getAnimations().length === 0);
}
async function action(page: Page, label: string, name: string) {
  const r = row(page, label);
  await r.hover();
  await r.locator(`.bt-outline-action[data-action="${name}"]`).click();
}

test('move a scene to Cold Storage: it leaves the manuscript, keeps its words, remembers where it was; ⌘Z undoes', async () => {
  const { app, page, userData, saveDir } = await launch({ file: { name: 'C.md', content: FILE } });
  try {
    await openOutline(page);
    const total = await page.$eval('[data-ref="words"] .bt-num-text', (e) => e.textContent);
    await action(page, '2.2 ', 'park');
    expect(await names(page)).toEqual([['Scene 1.1', 'Scene 1.2', 'Scene 1.3'], ['Scene 2.1', 'Scene 2.3'], ['Scene 3.1', 'Scene 3.2', 'Scene 3.3']]);
    expect(await parked(page)).toEqual(['Scene 2.2']);
    await expect(page.locator('[data-ref="toast"]')).toContainText('Moved 2.2 “Scene 2.2” to Cold Storage');
    await expect(row(page, 'Cold Storage')).toBeVisible();
    await expect(page.locator('.bt-outline-parked')).toHaveCount(1);
    expect(await page.$eval('[data-ref="words"] .bt-num-text', (e) => e.textContent)).not.toBe(total); // parked words don't count

    await page.keyboard.press('Meta+z');
    expect(await parked(page)).toEqual([]);
    await page.keyboard.press('Meta+Shift+z');
    expect(await parked(page)).toEqual(['Scene 2.2']);

    // Saved with its origin: after a relaunch, Restore still knows where it goes.
    expect(await page.evaluate(() => (window as any).__baretext.saveNow())).toBe(true);
    const file = await page.evaluate(() => (window as any).__baretext.filePath());
    expect(readFileSync(file, 'utf8')).toContain('"origins"');
    await app.close();
    const again = await launch({ reuse: { userData, saveDir } });
    try {
      // The outline reopens as it was left (open).
      await expect(again.page.locator('.bt-outline')).toHaveAttribute('data-presence', 'pinned');
      await again.page.waitForFunction(() => document.getAnimations().length === 0);
      await action(again.page, 'Scene 2.2', 'restore');
      expect((await names(again.page))[1]).toEqual(['Scene 2.1', 'Scene 2.2', 'Scene 2.3']);
      await expect(again.page.locator('[data-ref="toast"]')).toContainText('Restored “Scene 2.2” as 2.2');
    } finally {
      await again.app.close();
    }
  } finally {
    await app.close().catch(() => {});
  }
});

test('open a parked scene: the page shows only it, the writer edits it, Esc returns exactly where they were', async () => {
  const { app, page } = await launch({ file: { name: 'C.md', content: FILE } });
  try {
    const t = bt(page);
    await openOutline(page);
    await action(page, '3.1 ', 'park');
    await page.evaluate(() => (window as any).__baretext.caretAfter('Words that'));
    const before = await t.selection();
    const scroll = await page.$eval('[data-ref="scroller"]', (e) => e.scrollTop);

    await page.locator('.bt-outline-parked').click();
    await expect(page.locator('.bt-parked-bar')).toBeVisible();
    await expect(page.locator('[data-ref="parked-name"]')).toHaveText('Scene 3.1');
    await expect(page.locator('[data-ref="crumb"]')).toHaveText('Cold Storage · Scene 3.1');
    await expect(page.locator('[data-ref="words"]')).toContainText('in this scene');
    // Only the parked scene is on the page.
    expect(await page.$eval('.bt-chapter', (e) => getComputedStyle(e).display)).toBe('none');
    expect(await page.$eval('.bt-parked-open', (e) => getComputedStyle(e).display)).not.toBe('none');
    expect(await t.hasFocus()).toBe(true);
    await expect(page.locator('.bt-outline-parked')).toHaveAttribute('aria-current', 'location');

    await page.keyboard.type('Fresh start. ');
    expect((await model(page)).coldStorage[0].blocks[0].content[0].text).toMatch(/^Fresh start\. Words that/);

    await page.keyboard.press('Escape');
    await expect(page.locator('.bt-parked-bar')).toBeHidden();
    expect(await t.selection()).toEqual(before);
    expect(await page.$eval('[data-ref="scroller"]', (e) => e.scrollTop)).toBe(scroll);
    // The edit stayed with the parked scene.
    expect((await model(page)).coldStorage[0].blocks[0].content[0].text).toMatch(/^Fresh start\./);
  } finally {
    await app.close();
  }
});

test('Restore from the open scene puts it back where it came from and follows it there', async () => {
  const { app, page } = await launch({ file: { name: 'C.md', content: FILE } });
  try {
    await openOutline(page);
    await action(page, '1.2 ', 'park');
    await page.locator('.bt-outline-parked').click();
    await page.click('[data-ref="parked-restore"]');
    await expect(page.locator('.bt-parked-bar')).toBeHidden();
    expect((await names(page))[0]).toEqual(['Scene 1.1', 'Scene 1.2', 'Scene 1.3']);
    expect(await parked(page)).toEqual([]);
    expect(await bt(page).scene()).toBe((await model(page)).chapters[0].scenes[1].id);
    await expect(row(page, 'Cold Storage')).toHaveCount(0); // an empty Cold Storage has no section
  } finally {
    await app.close();
  }
});

test('drag a scene onto Cold Storage to park it; drag a parked scene into a chapter to restore it there', async () => {
  const { app, page } = await launch({ file: { name: 'C.md', content: FILE } });
  try {
    await openOutline(page);
    await action(page, '1.1 ', 'park'); // Cold Storage now has a section to drop on
    const drag = async (from: string, to: string, where: 'top' | 'middle') => {
      const a = (await row(page, from).boundingBox())!;
      const b = (await row(page, to).boundingBox())!;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, { steps: 3 });
      await page.mouse.move(b.x + b.width / 2, where === 'top' ? b.y + 4 : b.y + b.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => document.getAnimations().length === 0);
    };
    await drag('2.3 ', 'Cold Storage', 'middle');
    expect(await parked(page)).toEqual(['Scene 2.3', 'Scene 1.1']);
    await drag('Scene 1.1', '3.2 ', 'top');
    expect((await names(page))[2]).toEqual(['Scene 3.1', 'Scene 1.1', 'Scene 3.2', 'Scene 3.3']);
    expect(await parked(page)).toEqual(['Scene 2.3']);
  } finally {
    await app.close();
  }
});

test('the palette moves the current scene; while a parked scene is open it offers Back and Restore; Find returns to the manuscript', async () => {
  const { app, page } = await launch({ file: { name: 'C.md', content: FILE } });
  try {
    await page.evaluate(() => (window as any).__baretext.navigate((window as any).__baretext.model().chapters[1].scenes[0].id));
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('cold storage');
    await expect(page.locator('.bt-palette-row[aria-selected="true"]')).toContainText('Move scene to Cold Storage');
    await page.keyboard.press('Enter');
    expect(await parked(page)).toEqual(['Scene 2.1']);

    await openOutline(page);
    await page.locator('.bt-outline-parked').click();
    await page.keyboard.press('Meta+k');
    await expect(page.locator('.bt-palette-row').first()).toContainText('Back to manuscript');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+f');
    await expect(page.locator('.bt-parked-bar')).toBeHidden();
    expect((await page.evaluate(() => (window as any).__baretext.find())).open).toBe(true);
  } finally {
    await app.close();
  }
});

test('deleting the open parked scene (two steps) returns to the manuscript where the writer was', async () => {
  const { app, page } = await launch({ file: { name: 'C.md', content: FILE } });
  try {
    await openOutline(page);
    await action(page, '3.3 ', 'park');
    await page.evaluate(() => (window as any).__baretext.caretAfter('Words that'));
    const before = await bt(page).selection();
    await page.locator('.bt-outline-parked').click();
    await action(page, 'Scene 3.3', 'delete');
    await page.locator('.bt-outline-row[data-arming="true"]').getByRole('button', { name: /Confirm/ }).click();
    expect(await parked(page)).toEqual([]);
    await expect(page.locator('.bt-parked-bar')).toBeHidden();
    await expect.poll(() => bt(page).selection()).toEqual(before);
  } finally {
    await app.close();
  }
});
