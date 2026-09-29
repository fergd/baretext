import { expect, test, type Page } from '@playwright/test';
import { launch, model } from './launch.ts';

const FILE = '# One\n\n## Scene\n\nFirst paragraph.\nSecond paragraph.\n\n* * *\n\nAfter an imported pause.\n';

const blockTypes = async (page: Page) => (await model(page)).chapters[0].scenes.map((s: any) => s.blocks.map((b: any) => b.type));

test('⌘⇧↵ and Format → Insert Pause add a pause; ⌘↵ still splits the scene', async () => {
  const { app, page } = await launch({ file: { name: 'P.md', content: FILE } });
  try {
    // Imported `* * *` is a pause inside the one scene, drawn as the quiet marker.
    expect(await blockTypes(page)).toEqual([['paragraph', 'paragraph', 'section_break', 'paragraph']]);
    await expect(page.locator('.bt-section-break')).toHaveCount(1);

    // Caret at the end of the first paragraph, then ⌘⇧↵.
    const sceneId = (await model(page)).chapters[0].scenes[0].id;
    // Caret placed through the model (native caret keys are unreliable in hidden windows).
    expect(await page.evaluate(() => (window as any).__baretext.caretAfter('First paragraph.'))).toBe(true);
    await page.keyboard.press('Meta+Shift+Enter');
    expect(await blockTypes(page)).toEqual([['paragraph', 'section_break', 'paragraph', 'section_break', 'paragraph']]);
    await page.keyboard.type('Z');
    expect((await model(page)).chapters[0].scenes[0].blocks[2].content[0].text).toBe('ZSecond paragraph.');

    // The menu item does the same at the caret. At the end of the scene's
    // last line it adds the pause and a fresh line to keep writing on.
    await page.keyboard.press('Backspace');
    await page.evaluate((id) => (window as any).__baretext.caretToSceneEnd(id), sceneId);
    await app.evaluate(({ Menu }) => {
      const format = Menu.getApplicationMenu()!.items.find((i) => i.label === 'Format')!;
      format.submenu!.items.find((i) => i.label === 'Insert Pause')!.click();
    });
    await expect.poll(() => blockTypes(page)).toEqual([
      ['paragraph', 'section_break', 'paragraph', 'section_break', 'paragraph', 'section_break', 'paragraph'],
    ]);
    await expect(page.locator('.bt-section-break')).toHaveCount(3);
    await page.keyboard.type('New section.');
    expect((await model(page)).chapters[0].scenes[0].blocks.at(-1).content[0].text).toBe('New section.');

    // ⌘↵ is unchanged: a full scene break.
    await page.keyboard.press('Meta+Enter');
    expect((await model(page)).chapters[0].scenes).toHaveLength(2);
  } finally {
    await app.close();
  }
});

test('numbers: unnamed scene 1.2 at scene-title size; pauses 1.1.1, 1.1.2 at body size, renumbered live', async () => {
  const src = '# One\n\nOpening.\n\n* * *\n\nMiddle.\n\n---\n\nSecond scene.\n';
  const { app, page } = await launch({ file: { name: 'N.md', content: src } });
  try {
    const pauses = () => page.$$eval('.bt-section-break', (els) => els.map((e) => e.getAttribute('data-number')));
    expect(await pauses()).toEqual(['1.1.1']);
    const boundary = await page.$eval('.bt-scene-boundary .bt-num', (e) => ({ text: e.textContent, size: getComputedStyle(e).fontSize }));
    expect(boundary).toEqual({ text: '1.2', size: '28px' });
    const pauseNum = await page.$eval('.bt-section-break', (e) => ({
      text: getComputedStyle(e, '::before').content, size: getComputedStyle(e, '::before').fontSize,
    }));
    expect(pauseNum).toEqual({ text: '"1.1.1"', size: '15px' });

    // A new pause before the first renumbers both.
    await page.evaluate(() => (window as any).__baretext.caretAfter('Open'));
    await page.keyboard.press('Meta+Shift+Enter'); // splits "Open|ing." with a pause
    expect(await pauses()).toEqual(['1.1.1', '1.1.2']);
    const blocks = (await model(page)).chapters[0].scenes[0].blocks;
    expect(blocks.map((b: any) => b.type)).toEqual(['paragraph', 'section_break', 'paragraph', 'section_break', 'paragraph']);
    await page.keyboard.press('Backspace'); // caret is at the start of "ing.", right after the new pause
    expect(await pauses()).toEqual(['1.1.1']);
  } finally {
    await app.close();
  }
});
