import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launch, model } from './launch.ts';

const FILE = '# One\n\nOpening prose.\n\n---\n\nSecond scene prose.\n\n## Harbor\n\nHarbor prose.\n';
const names = async (page: Page) => (await model(page)).chapters[0].scenes.map((s: any) => s.name);

test('click an unnamed scene’s ornament to name it; the name is saved', async () => {
  const { app, page, saveDir } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    expect(await names(page)).toEqual([null, null, 'Harbor']);
    await page.click('.bt-scene-boundary');
    expect(await names(page)).toEqual([null, '', 'Harbor']);
    await page.keyboard.type('Dawn');
    await page.keyboard.press('Enter'); // on to the scene's first line
    await page.keyboard.type('X');
    expect(await names(page)).toEqual([null, 'Dawn', 'Harbor']);
    expect((await model(page)).chapters[0].scenes[1].blocks[0].content[0].text).toBe('XSecond scene prose.');
    await expect(page.locator('.bt-scene-boundary')).toHaveCount(0); // now a named heading
    await expect(page.locator('.bt-scene-heading').first()).toHaveText(/Dawn/);

    await page.evaluate(() => (window as any).__baretext.saveNow());
    const saved = readFileSync(`${saveDir}/N (Baretext).md`, 'utf8');
    expect(saved).toContain('## Dawn');
  } finally {
    await app.close();
  }
});

test('rename from the palette; an empty name goes away (Backspace, or just leaving it)', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await page.evaluate(() => (window as any).__baretext.caretAfter('Harbor prose'));
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('rename');
    await expect(page.locator('.bt-palette-row[aria-selected="true"] .bt-palette-label')).toHaveText('Rename scene');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Lighthouse'); // replaces the selected name
    expect(await names(page)).toEqual([null, null, 'Lighthouse']);

    // Name an unnamed scene from the palette, then Backspace the empty name away.
    await page.evaluate(() => (window as any).__baretext.caretAfter('Opening'));
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('name scene');
    await page.keyboard.press('Enter');
    expect(await names(page)).toEqual(['', null, 'Lighthouse']);
    await page.keyboard.press('Backspace');
    expect(await names(page)).toEqual([null, null, 'Lighthouse']);

    // Click the ornament, then click away without typing: nothing lingers.
    await page.click('.bt-scene-boundary');
    expect(await names(page)).toEqual([null, '', 'Lighthouse']);
    await page.evaluate(() => (window as any).__baretext.caretAfter('Opening'));
    expect(await names(page)).toEqual([null, null, 'Lighthouse']);
    await expect(page.locator('.bt-scene-boundary')).toHaveCount(1);

    // Undo never brings an abandoned empty name back, and never touches prose.
    const prose = JSON.stringify((await model(page)).chapters[0].scenes.map((s: any) => s.blocks));
    await page.keyboard.press('Meta+z');
    expect((await names(page))[1]).toBeNull();
    expect(JSON.stringify((await model(page)).chapters[0].scenes.map((s: any) => s.blocks))).toBe(prose);
  } finally {
    await app.close();
  }
});
