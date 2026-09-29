import { expect, test, type Page } from '@playwright/test';
import { launch, model } from './launch.ts';

// 3 chapters × 3 scenes, each scene long enough to fill a window.
const para = 'Words that fill the scene so that it takes up real vertical space on the page. '.repeat(3);
const FILE = [1, 2, 3].map((c) =>
  `# Chapter ${c}\n\n` + [1, 2, 3].map((s) => `## Scene ${c}.${s}\n\n` + Array.from({ length: 12 }, () => para).join('\n')).join('\n\n'),
).join('\n\n') + '\n';

const indicatorY = (page: Page) => page.$eval('.bt-spine-indicator', (e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).m42);
const currentTick = (page: Page) => page.$eval('.bt-tick[aria-current="true"]', (e) => e.getAttribute('aria-label'));
const crumb = (page: Page) => page.$eval('[data-ref="crumb"]', (e) => e.textContent);

test('the long tick glides to a chosen scene, and the page moves instead of jumping', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    const start = await indicatorY(page);
    expect(await currentTick(page)).toBe('1.1 Scene 1.1');
    await page.click('.bt-tick[aria-label="1.3 Scene 1.3"]');
    expect(await page.evaluate(() => document.getAnimations().some((a) => a.effect && (a.effect as KeyframeEffect).target?.classList.contains('bt-page')))).toBe(true);
    await page.waitForTimeout(60);
    const mid = await indicatorY(page);
    const end = await page.$eval('.bt-tick[aria-label="1.3 Scene 1.3"]', (t) => (t as HTMLElement).offsetTop + (t as HTMLElement).offsetHeight / 2);
    expect(mid).toBeGreaterThan(start);   // on its way…
    expect(mid).toBeLessThan(end);        // …not teleported
    await expect.poll(() => indicatorY(page)).toBeCloseTo(end, 0);
    expect(await currentTick(page)).toBe('1.3 Scene 1.3');
  } finally {
    await app.close();
  }
});

test('scrolling by hand moves the long tick to the scene being read; writing hands it back to the caret', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    const box = (await page.locator('.bt-scroller').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 600);
    await expect.poll(() => currentTick(page)).not.toBe('1.1 Scene 1.1');
    const reading = await currentTick(page);
    expect(await crumb(page)).toContain(reading!.split(' ').slice(1).join(' ').toLowerCase());
    // The caret never moved.
    const first = (await model(page)).chapters[0].scenes[0].id;
    expect(await page.evaluate(() => (window as any).__baretext.currentScene())).toBe(first);

    await page.keyboard.type('x');
    await expect.poll(() => currentTick(page)).toBe('1.1 Scene 1.1');
  } finally {
    await app.close();
  }
});

test('focus mode fades the spine away (no clicks, no hover) and brings it back', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    const spine = page.locator('.bt-spine');
    const tick = page.locator('.bt-tick[aria-label="2.1 Scene 2.1"]');
    const center = async () => { const b = (await tick.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const at = await center();
    const hit = () => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className ?? '', at);
    expect(await hit()).toContain('bt-tick');

    await page.keyboard.press('Meta+.');
    await page.waitForTimeout(40);
    const fading = parseFloat(await spine.evaluate((e) => getComputedStyle(e).opacity));
    expect(fading).toBeGreaterThan(0); // a fade, not a blink
    expect(fading).toBeLessThan(1);
    await expect.poll(() => spine.evaluate((e) => getComputedStyle(e).visibility)).toBe('hidden');
    expect(await hit()).not.toContain('bt-tick'); // clicks pass through to the page
    await page.mouse.click(at.x, at.y);
    expect(await page.evaluate(() => (window as any).__baretext.currentScene())).toBe((await model(page)).chapters[0].scenes[0].id);

    await page.keyboard.press('Meta+.');
    await expect.poll(() => spine.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    expect(await hit()).toContain('bt-tick');
  } finally {
    await app.close();
  }
});

test('Esc leaves focus mode, but only after closing whatever is open (the toolbar first)', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    const focus = () => page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.focus);
    await page.keyboard.press('Meta+.');
    expect(await focus()).toBe('true');

    // Select a word: the toolbar opens. Esc #1 closes it and stays in focus mode.
    const w = await page.evaluate(() => {
      const t = [...document.querySelectorAll('.ProseMirror p')][0]!.firstChild!;
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 5);
      return r.getBoundingClientRect().toJSON();
    });
    await page.mouse.dblclick(w.left + 2, w.top + w.height / 2);
    await expect.poll(() => page.evaluate(() => (window as any).__baretext.toolbar().visible)).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (window as any).__baretext.toolbar().visible)).toBe(false);
    expect(await focus()).toBe('true');

    // Esc #2: nothing else open, so focus mode ends.
    await page.keyboard.press('Escape');
    expect(await focus()).toBe('false');

    // Esc never turns focus mode on.
    await page.keyboard.press('Escape');
    expect(await focus()).toBe('false');
  } finally {
    await app.close();
  }
});
