import { expect, test } from '@playwright/test';
import { launch, model } from './launch.ts';

const FILE = '# One\n\n## Garden\n\nThey planted basil. The beans fed the soil.\n\n## Market\n\nA second scene.\n\n# Two\n\n## Rain\n\nIt rained.\n';

test('⌥⌘↵ splits the chapter at the caret like ⌘↵ splits a scene: the caret is in the new chapter’s name; ⌘Z restores it exactly', async () => {
  const { app, page } = await launch({ file: { name: 'C.md', content: FILE } });
  try {
    const before = await model(page);
    await page.evaluate(() => (window as any).__baretext.caretAfter('They planted basil. '));
    await page.keyboard.press('Alt+Meta+Enter');
    const shape = (m: any) => m.chapters.map((c: any) => [c.title, c.scenes.map((s: any) => s.name ?? s.blocks.map((b: any) => b.content.map((r: any) => r.text).join('')).join(' / '))]);
    expect(shape(await model(page))).toEqual([
      ['One', ['Garden']],
      ['', ['The beans fed the soil.', 'Market']],
      ['Two', ['Rain']],
    ]);

    // Name it, and carry on writing.
    await page.keyboard.type('Interlude');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Then ');
    const m = await model(page);
    expect(m.chapters[1].title).toBe('Interlude');
    expect(m.chapters[1].scenes[0].blocks[0].content.map((r: any) => r.text).join('')).toBe('Then The beans fed the soil.');

    // Undo: typing first, then the split in one step.
    for (let i = 0; i < 10 && JSON.stringify(await model(page)) !== JSON.stringify(before); i++) await page.keyboard.press('Meta+z');
    expect(await model(page)).toEqual(before);
  } finally {
    await app.close();
  }
});
