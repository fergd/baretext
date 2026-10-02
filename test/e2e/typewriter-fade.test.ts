import { expect, test, type Page } from '@playwright/test';
import { launch } from './launch.ts';

const FILE = '# One\n\n## Scene\n\n' + Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of the scene, long enough to read.`).join('\n') + '\n';

/** Current opacity of the lines next to the caret's line (1 = no fade). */
const near = (page: Page) => page.evaluate(() =>
  parseFloat(getComputedStyle(document.querySelector('[data-ref="scroller"]')!).getPropertyValue('--tw-mask-near')));

test('scrolling eases the typewriter fade away, and writing eases it back', async () => {
  const { app, page } = await launch({ file: { name: 'T.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+Shift+t'); // typewriter is never restored at launch
    await expect.poll(() => near(page)).toBeCloseTo(0.4, 2);
    const box = (await page.locator('[data-ref="scroller"]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(120);
    const mid = await near(page);
    expect(mid).toBeGreaterThan(0.4); // started easing out…
    expect(mid).toBeLessThan(1);      // …but not a jump
    await expect.poll(() => near(page)).toBe(1);

    await page.keyboard.type('x');
    await page.waitForTimeout(150);
    const back = await near(page);
    expect(back).toBeLessThan(1);
    expect(back).toBeGreaterThan(0.4);
    await expect.poll(() => near(page)).toBeCloseTo(0.4, 2);
  } finally {
    await app.close();
  }
});
