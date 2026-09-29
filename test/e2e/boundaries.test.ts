// Real keyboard input in the real (hidden) app: the structure rules from
// spec §4.4 hold end to end. Assertions are on the model, not the DOM.
import { expect, test, type Page } from '@playwright/test';
import { sampleFile } from '../fixtures/sample.ts';
import { launch, model } from './launch.ts';

type M = Awaited<ReturnType<typeof model>>;
const shape = (m: M) => m.chapters.map((c: any) => [c.id, c.title, c.scenes.map((s: any) => [s.id, s.name])]);
const sceneText = (s: any) => s.blocks.filter((b: any) => b.type === 'paragraph').map((b: any) => b.content.map((r: any) => r.text).join(''));

async function goTo(page: Page, chapter: number, scene: number) {
  const m = await model(page);
  await page.evaluate((id) => (window as any).__baretext.navigate(id), m.chapters[chapter].scenes[scene].id);
}

test.describe('structure is safe from the keyboard', () => {
  let ctx: Awaited<ReturnType<typeof launch>>;
  test.beforeEach(async () => { ctx = await launch({ file: { name: 'Novel.md', content: sampleFile() } }); });
  test.afterEach(async () => { await ctx.app.close(); });

  test('Backspace at the start of a scene never merges scenes', async () => {
    const { page } = ctx;
    const before = await model(page);
    await goTo(page, 3, 1);
    for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+Backspace');
    const after = await model(page);
    expect(shape(after)).toEqual(shape(before));
    expect(after).toEqual(before);
  });

  test('Enter at the end of a scene adds a line to that scene', async () => {
    const { page } = ctx;
    const before = await model(page);
    // (Synthetic ⌘→ doesn't run macOS editing commands in a hidden window.)
    await page.evaluate((id) => (window as any).__baretext.caretToSceneEnd(id), before.chapters[3].scenes[0].id);
    await page.keyboard.press('Enter');
    await page.keyboard.type('New line');
    const after = await model(page);
    expect(shape(after)).toEqual(shape(before));
    expect(sceneText(after.chapters[3].scenes[0]).at(-1)).toBe('New line');
    expect(after.chapters[3].scenes[1]).toEqual(before.chapters[3].scenes[1]);
  });

  test('a selection across scenes deletes text but keeps every scene', async () => {
    const { page } = ctx;
    const before = await model(page);
    await goTo(page, 3, 1);
    for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('x');
    const after = await model(page);
    expect(shape(after).map((c: any) => [c[0], c[2].map((s: any) => s[0])])).toEqual(shape(before).map((c: any) => [c[0], c[2].map((s: any) => s[0])]));
  });

  test('⌘↵ splits the scene; ⌘Z restores it exactly', async () => {
    const { page } = ctx;
    const before = await model(page);
    await goTo(page, 3, 1);
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Meta+Enter');
    const split = await model(page);
    expect(split.chapters[3].scenes).toHaveLength(before.chapters[3].scenes.length + 1);
    await page.keyboard.press('Meta+z');
    expect(await model(page)).toEqual(before);
  });

  test('bold continues while typing and "--" becomes an em dash', async () => {
    const { page } = ctx;
    await goTo(page, 0, 1);
    await page.keyboard.press('Meta+b');
    await page.keyboard.type('Loud');
    await page.keyboard.press('Meta+b');
    await page.keyboard.type(' quiet -- then');
    const first = (await model(page)).chapters[0].scenes[1].blocks[0];
    expect(first.content.slice(0, 2)).toEqual([{ text: 'Loud', bold: true }, { text: ' quiet — thenThe woman uneasily pivoted and waddled away, disappearing behind an end cap of plastic pots.' }]);
  });

  test('typewriter keeps the caret line centered as lines advance', async () => {
    const { page, app } = ctx;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1000, 700));
    await goTo(page, 3, 1);
    await page.keyboard.press('Meta+Shift+T');
    await page.waitForTimeout(100);
    const offsets: number[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Enter');
      await page.keyboard.type('line');
      await page.waitForTimeout(250); // let the line-advance motion finish
      offsets.push(await page.evaluate(() => {
        const sc = document.querySelector('.bt-scroller')!.getBoundingClientRect();
        const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
        return Math.round((r.top + r.bottom) / 2 - (sc.top + sc.height / 2));
      }));
    }
    for (const o of offsets) expect(Math.abs(o)).toBeLessThanOrEqual(2);
  });
});
