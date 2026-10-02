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

test('focus mode adds a vignette around the manuscript: never over the text or its hanging numbers, gone with focus, none without room', async () => {
  const { app, page } = await launch({ file: { name: 'M.md', content: '# Chapter the first\n\n## A scene\n\nText of the scene, long enough to fill the column from side to side.\n' } });
  try {
    const win = (w: number) => app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setContentSize(w, 800), w);
    await win(1400);
    const sides = () => page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const nums = [...document.querySelectorAll('.bt-num')].map((n) => n.getBoundingClientRect().left);
      const style = getComputedStyle(document.querySelector('.bt-vignette-left')!);
      return { left: box('.bt-vignette-left').right, right: box('.bt-vignette-right').left, width: box('.bt-vignette-left').width,
        textLeft: box('.ProseMirror').left, textRight: box('.ProseMirror').right, firstNum: Math.min(...nums), opacity: style.opacity };
    });
    expect((await sides()).opacity).toBe('0');

    await page.keyboard.press('Meta+.');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const v = await sides();
    expect(Number(v.opacity)).toBeGreaterThan(0);
    expect(v.width).toBeGreaterThan(0);
    expect(v.left).toBeLessThan(v.firstNum); // clear of the hanging numbers…
    expect(v.left).toBeLessThan(v.textLeft); // …and the text
    expect(v.right).toBeGreaterThan(v.textRight);

    await win(800); // no room around the column: no vignette
    await expect.poll(async () => (await sides()).width).toBe(0);
    await win(1400);
    await page.keyboard.press('Meta+.');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    expect((await sides()).opacity).toBe('0');
  } finally {
    await app.close();
  }
});

test('focus mode dissolves the text at the window edges, and the line being written never sits in the fade', async () => {
  const P = 'Plant basil, or marigolds and some thyme. The beans fed the soil, and the woman pivoted and waddled away from the gate.';
  const { app, page } = await launch({ file: { name: 'M.md', content: '# One\n\n## Two\n\n' + Array(30).fill(P).join('\n\n') + '\n' } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 700));
    const mask = () => page.$eval('[data-ref="scroller"]', (e) => getComputedStyle(e).maskImage);
    expect(await mask()).toBe('none');
    await page.keyboard.press('Meta+.');
    expect(await mask()).toContain('linear-gradient');

    // Write at the very end: each new line is scrolled into view clear of the fade.
    await page.evaluate(() => (window as any).__baretext.caretToSceneEnd((window as any).__baretext.currentScene()));
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Enter'); await page.keyboard.type('A new line.'); }
    const { caretBottom, edge, fade } = await page.evaluate(() => {
      const v = (window as any).__baretext;
      const box = document.querySelector('[data-ref="scroller"]')!.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(document.querySelector('.ProseMirror p')!).lineHeight);
      return { caretBottom: v.caretTop() + lh, edge: box.bottom, fade: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--focus-fade')) };
    });
    expect(fade).toBeGreaterThan(0);
    expect(caretBottom).toBeLessThanOrEqual(edge - fade);

    await page.keyboard.press('Meta+.');
    expect(await mask()).toBe('none');
  } finally {
    await app.close();
  }
});
