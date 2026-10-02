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
    const box = (await page.locator('[data-ref="scroller"]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 600);
    await expect.poll(() => currentTick(page)).not.toBe('1.1 Scene 1.1');
    const reading = await currentTick(page);
    expect(await crumb(page)).toContain(reading!.split(' ').slice(1).join(' '));
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
    // (Measure only once the page is still: launch scrolling and the fade must not move the word.)
    await page.waitForFunction(() => document.getAnimations().length === 0);
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

test('the scene label springs in at the tick, glides between ticks, and is fully gone after leaving', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    const tip = page.locator('.bt-spine-tip');
    const tipY = () => tip.evaluate((e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).m42);
    const tipScale = () => tip.evaluate((e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).a);
    const hover = async (label: string) => {
      const b = (await page.locator(`.bt-tick[aria-label="${label}"]`).boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    };
    expect(await tip.evaluate((e) => getComputedStyle(e).visibility)).toBe('hidden');

    await hover('1.1 Scene 1.1');
    await page.waitForTimeout(30);
    expect(await tip.textContent()).toBe('1.1Scene 1.1');
    const growing = await tipScale();
    expect(growing).toBeLessThan(1); // grows from the tick, not a blink
    await expect.poll(tipScale).toBeCloseTo(1, 2);
    const first = await tipY();

    await hover('1.3 Scene 1.3');
    const target = await page.locator('.bt-tick[aria-label="1.3 Scene 1.3"]').evaluate((t) => {
      const host = t.closest('.bt-spine')!.parentElement!.getBoundingClientRect();
      const r = t.getBoundingClientRect();
      return Math.round(r.top - host.top + r.height / 2 - 12);
    });
    await page.waitForTimeout(40);
    const mid = await tipY();
    expect(mid).toBeGreaterThan(first); // gliding…
    expect(mid).toBeLessThan(target);   // …not jumping
    expect(await tip.textContent()).toBe('1.3Scene 1.3');
    await expect.poll(tipY).toBeCloseTo(target, 0);

    // Leaving: it fades out, then drops out of rendering (no glass layer while writing).
    await page.mouse.move(600, 300);
    await expect.poll(() => tip.evaluate((e) => getComputedStyle(e).visibility)).toBe('hidden');
    expect(await tip.evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
  } finally {
    await app.close();
  }
});

test('the hovered tick grows a little wider and takes the accent color, smoothly, and settles back', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    const tick = page.locator('.bt-tick[aria-label="2.2 Scene 2.2"]');
    const mark = () => tick.evaluate((e) => {
      const s = getComputedStyle(e, '::before');
      return { scale: new DOMMatrixReadOnly(s.transform === 'none' ? undefined : s.transform).a, color: s.backgroundColor };
    });
    const accent = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.background = 'var(--color-accent)';
      document.querySelector('.bt-spine')!.append(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return c;
    });
    const rest = await mark();
    expect(rest.scale).toBe(1);
    expect(rest.color).not.toBe(accent);

    const b = (await tick.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(40);
    const mid = await mark();
    expect(mid.scale).toBeGreaterThan(1);  // growing…
    expect(mid.scale).toBeLessThan(1.3);   // …not snapped
    await expect.poll(async () => (await mark()).color).toBe(accent);
    await expect.poll(async () => (await mark()).scale).toBeCloseTo(16 / 12, 2); // 12px → 16px

    await page.mouse.move(600, 300);
    await expect.poll(async () => (await mark()).scale).toBe(1);
    expect((await mark()).color).toBe(rest.color);
  } finally {
    await app.close();
  }
});
