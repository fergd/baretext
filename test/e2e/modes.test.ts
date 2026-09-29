import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launch } from './launch.ts';

// Every launch starts in the default mode: typewriter and focus off,
// whatever an older settings file says, and neither is ever saved.
test('typewriter and focus mode are never restored or saved', async () => {
  const { app, page, userData } = await launch({
    file: { name: 'M.md', content: '# One\n\nText.\n' },
    settings: { typewriter: true, focus: true, paragraphSpacing: 'half' },
  });
  try {
    const state = () => page.$eval('.bt-app', (e) => ({ typewriter: (e as HTMLElement).dataset.typewriter, focus: (e as HTMLElement).dataset.focus }));
    expect(await state()).toEqual({ typewriter: 'false', focus: 'false' });
    // Other preferences are still restored.
    expect(await page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.paragraphSpacing)).toBe('half');

    await page.keyboard.press('Meta+Shift+t');
    await page.keyboard.press('Meta+.');
    expect(await state()).toEqual({ typewriter: 'true', focus: 'true' });
    await page.evaluate(() => (window as any).__baretext.saveNow()); // settings writes settle
    await page.waitForTimeout(200);
    const saved = JSON.parse(readFileSync(`${userData}/settings.json`, 'utf8'));
    expect(saved.typewriter).toBeUndefined();
    expect(saved.focus).toBeUndefined();
  } finally {
    await app.close();
  }
});
