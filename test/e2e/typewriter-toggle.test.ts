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
    const near = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-ref="scroller"]')!).getPropertyValue('--tw-mask-near')));
    await page.keyboard.press('Meta+Shift+t');
    await expect.poll(near).toBeCloseTo(0.4, 2);
    await page.keyboard.press('Meta+Shift+t');
    await page.waitForTimeout(100);
    const mid = await near();
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(1);
    // Once faded, the mask is gone entirely.
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('[data-ref="scroller"]')!).webkitMaskImage)).toBe('none');
  } finally {
    await app.close();
  }
});

test('turning typewriter off fades back in (lines and guides), not a snap', async () => {
  const { app, page } = await launch({ file: { name: 'T.md', content: '# One\n\n' + Array.from({ length: 40 }, (_, i) => `Line ${i} of the draft, long enough to wrap across the column a little.`).join('\n\n') + '\n' } });
  try {
    await page.evaluate(() => (window as any).__baretext.caretAfter('Line 20'));
    await page.keyboard.press('Meta+Shift+t');
    await page.waitForTimeout(800);
    const samples = await page.evaluate(async () => {
      const sc = document.querySelector('[data-ref="scroller"]') as HTMLElement;
      const guide = document.querySelector('.bt-tw-guide') as HTMLElement;
      const read = () => ({ near: parseFloat(getComputedStyle(sc).getPropertyValue('--tw-mask-near')), guide: parseFloat(getComputedStyle(guide).opacity), shown: getComputedStyle(guide).display !== 'none' });
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', code: 'KeyT', metaKey: true, shiftKey: true }));
      const out: Array<ReturnType<typeof read> & { t: number }> = [];
      for (let i = 0; i < 16; i++) { await new Promise((r) => setTimeout(r, 40)); out.push({ t: performance.now() - t0, ...read() }); }
      return out;
    });
    const at = (ms: number) => samples.find((s) => s.t >= ms)!;
    // Still visibly fading a fifth of a second in…
    expect(at(80).near).toBeLessThan(0.75);
    expect(at(80).shown && at(80).guide > 0 && at(80).guide < 0.25).toBe(true);
    // …and done well within half a second.
    expect(samples.at(-1)!.near).toBe(1);
    expect(samples.at(-1)!.shown).toBe(false);
  } finally {
    await app.close();
  }
});
