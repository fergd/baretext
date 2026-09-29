import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parse } from '../../packages/format/src/index.ts';
import { sampleFile } from '../fixtures/sample.ts';
import { launch, model } from './launch.ts';

test('opens the last file hidden, edits, and autosaves a verified file', async () => {
  const { app, page, saveDir } = await launch({ file: { name: 'Novel.md', content: sampleFile() } });
  try {
    const m = await model(page);
    expect(m.title).toBe('Testing the Spirits');
    expect(m.chapters).toHaveLength(5);

    // Go to 4.2 through the navigation controller and type at its first line.
    const sceneId = m.chapters[3].scenes[1].id;
    expect(await page.evaluate((id) => (window as any).__baretext.navigate(id), sceneId)).toBe(true);
    await page.keyboard.type('Hello ');
    await page.waitForFunction(() => (window as any).__baretext.isSaved(), null, { timeout: 5000 });

    const onDisk: any = parse(readFileSync(`${saveDir}/Novel.md`, 'utf8')).manuscript;
    expect(onDisk.chapters[3].scenes[1].name).toBe('It Begins');
    const first = onDisk.chapters[3].scenes[1].blocks[0];
    expect(first.type === 'paragraph' && first.content[0].text.startsWith('Hello They spray')).toBe(true);
    expect(onDisk.coldStorage[0].name).toBe('Cut scene');
  } finally {
    await app.close();
  }
});
