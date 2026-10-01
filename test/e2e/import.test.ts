import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { launch, model } from './launch.ts';

const LEGACY = [
  '<!-- BOOK TITLE: Old Book -->', '', '# ', '', '<!-- Side Door -->', '',
  'Line one.', 'Line *two*.', '---', '<!-- Coffee -->', 'Coffee line.',
].join('\n');

test('opening a previous-app file imports a formatted copy and never touches the original', async () => {
  const { app, page, saveDir } = await launch({ file: { name: 'Old.md', content: LEGACY } });
  try {
    const m = await model(page);
    expect(m.title).toBe('Old Book');
    expect(m.chapters[0].scenes.map((s: any) => s.name)).toEqual(['Side Door', 'Coffee']);
    expect(m.chapters[0].scenes[0].blocks).toHaveLength(2);
    expect(await page.evaluate(() => (window as any).__baretext.filePath())).toBe(path.join(saveDir, 'Old (Baretext).md'));

    await page.keyboard.type('edit ');
    await page.waitForFunction(() => (window as any).__baretext.isSaved());
    expect(readFileSync(path.join(saveDir, 'Old.md'), 'utf8')).toBe(LEGACY);
    expect(readFileSync(path.join(saveDir, 'Old (Baretext).md'), 'utf8')).toContain('## Side Door');
    expect(readdirSync(saveDir).sort()).toEqual(['Old (Baretext).md', 'Old.md']);
  } finally {
    await app.close();
  }
});
