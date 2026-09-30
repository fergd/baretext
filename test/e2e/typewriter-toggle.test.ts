import { expect, test, type Page } from '@playwright/test';
import { launch } from './launch.ts';

const FILE = '# One\n\n## Scene\n\n' + Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of the scene, long enough to read comfortably.`).join('\n') + '\n';
const bt = (page: Page, fn: string) => page.evaluate((fn) => (window as any).__baretext[fn](), fn);

for (const how of ['the status switch', '⌘⇧T'] as const) {
  test(`turning typewriter off with ${how} moves nothing and keeps the caret`, async () => {
    const { app, page } = await launch({ file: { name: 'T.md', content: FILE } });
    try {
      await page.evaluate(() => (window as any).__baretext.caretAfter('Line 40 of'));
      await page.keyboard.press('Meta+Shift+t');
      await page.waitForTimeout(400); // centered
      const sel = await bt(page, 'selection');
      const top = await bt(page, 'caretTop');

      if (how === '⌘⇧T') await page.keyboard.press('Meta+Shift+t');
      else await page.click('[data-ref="typewriter"]');
      await page.waitForTimeout(100);

      expect(await page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.typewriter)).toBe('false');
      expect(Math.abs((await bt(page, 'caretTop')) - top)).toBeLessThanOrEqual(1); // the line stays put
      expect(await bt(page, 'selection')).toEqual(sel);
      expect(await bt(page, 'hasFocus')).toBe(true); // caret still showing
    } finally {
      await app.close();
    }
  });
}

test('turning typewriter off brings the lights back with a fade, not a snap', async () => {
  const { app, page } = await launch({ file: { name: 'T.md', content: FILE } });
  try {
    const near = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.bt-scroller')!).getPropertyValue('--tw-mask-near')));
    await page.keyboard.press('Meta+Shift+t');
    await expect.poll(near).toBeCloseTo(0.4, 2);
    await page.keyboard.press('Meta+Shift+t');
    await page.waitForTimeout(100);
    const mid = await near();
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(1);
    // Once faded, the mask is gone entirely.
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.bt-scroller')!).webkitMaskImage)).toBe('none');
  } finally {
    await app.close();
  }
});
