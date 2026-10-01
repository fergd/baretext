import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launch, setAppearance } from './launch.ts';

const para = 'They spray the insecticides. Then pesticides. They do not need them, the people who lived here first knew this. ';
const FILE = '# Maples in Suburbia\n\n## It Begins\n\n' + Array.from({ length: 10 }, () => para.repeat(2)).join('\n') + '\n';

const bt = (page: Page) => ({
  state: () => page.evaluate(() => (window as any).__baretext.appearance()),
  caretTop: () => page.evaluate(() => (window as any).__baretext.caretTop()),
  hasFocus: () => page.evaluate(() => (window as any).__baretext.hasFocus()),
});
const DEFAULTS = { theme: 'dracula', proseFont: 'mono', paragraphSpacing: 'full', proseWidth: 'narrow', fontSize: 'medium' };

test('Settings… (⌘,) opens Appearance; choices show in the sample only; Save applies them all at once and keeps the caret line', async () => {
  const { app, page, userData } = await launch({ file: { name: 'A.md', content: FILE } });
  try {
    const t = bt(page);
    await page.evaluate(() => (window as any).__baretext.caretAfter('first knew'));
    const caret = await t.caretTop();
    // The app menu has Settings… with ⌘,
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items[0]!.submenu!.items.map((i) => i.label))).toContain('Settings…');
    await page.keyboard.press('Meta+Comma');
    expect((await t.state()).open).toBe(true);
    expect((await t.state()).applied).toEqual(DEFAULTS);

    for (const v of ['light', 'serif', 'large', 'half', 'wide']) await page.click(`.bt-appearance [data-value="${v}"]`);
    const choices = { theme: 'light', proseFont: 'serif', paragraphSpacing: 'half', proseWidth: 'wide', fontSize: 'large' };
    expect((await t.state()).choices).toEqual(choices);
    expect((await t.state()).applied).toEqual(DEFAULTS); // the app hasn't changed
    const sample = await page.$eval('.bt-sample', (e) => ({ ...(e as HTMLElement).dataset, font: getComputedStyle(e.querySelector('.bt-sample-column')!).fontFamily, size: getComputedStyle(e.querySelector('.bt-sample-column')!).fontSize }));
    expect(sample).toMatchObject({ theme: 'light', proseFont: 'serif', size: '17px' });
    expect(sample.font).toMatch(/^"IBM Plex Serif"/);
    // The sample shows the writer's own words.
    await expect(page.locator('.bt-sample')).toContainText('They spray the insecticides');

    await page.click('.bt-appearance [data-action="save"]');
    expect((await t.state()).open).toBe(false);
    expect((await t.state()).applied).toEqual(choices);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
    expect(await page.$eval('.ProseMirror', (e) => getComputedStyle(e).fontSize)).toBe('17px');
    expect(await page.$eval('.bt-page', (e) => Math.round(e.getBoundingClientRect().width))).toBe(660);
    expect(await t.caretTop()).toBeCloseTo(caret, 0);
    expect(await t.hasFocus()).toBe(true);
    await expect.poll(() => JSON.parse(readFileSync(`${userData}/settings.json`, 'utf8'))).toMatchObject(choices);
  } finally {
    await app.close();
  }
});

test('Cancel or Esc discards the choices; Esc closes only the panel (not focus mode)', async () => {
  const { app, page } = await launch({ file: { name: 'A.md', content: FILE } });
  try {
    const t = bt(page);
    await page.keyboard.press('Meta+Comma');
    await page.click('.bt-appearance [data-value="grove"]');
    await page.click('.bt-appearance [data-action="cancel"]');
    expect((await t.state()).applied).toEqual(DEFAULTS);
    expect(await t.hasFocus()).toBe(true);

    await page.keyboard.press('Meta+.'); // focus mode on
    await page.keyboard.press('Meta+Comma');
    await page.click('.bt-appearance [data-value="contrast"]');
    await page.keyboard.press('Escape');
    expect((await t.state()).open).toBe(false);
    expect((await t.state()).applied).toEqual(DEFAULTS);
    expect(await page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.focus)).toBe('true');
    // Reopening starts from what is applied, not from the discarded choice.
    await page.keyboard.press('Meta+Comma');
    expect((await t.state()).choices).toEqual(DEFAULTS);
  } finally {
    await app.close();
  }
});

test('keyboard: one tab stop per group, arrows choose within it, ⌘↵ saves; Reset to defaults', async () => {
  const { app, page } = await launch({ file: { name: 'A.md', content: FILE }, settings: { theme: 'grove', fontSize: 'small' } });
  try {
    const t = bt(page);
    await page.keyboard.press('Meta+Comma');
    const focused = () => page.evaluate(() => { const e = document.activeElement as HTMLElement; return `${e.dataset.key}=${e.dataset.value}`; });
    expect(await focused()).toBe('theme=grove'); // starts on the theme in use
    await page.keyboard.press('ArrowRight');
    expect(await focused()).toBe('theme=contrast');
    await page.keyboard.press('Tab');
    expect(await focused()).toBe('proseFont=mono');
    await page.keyboard.press('ArrowLeft'); // wraps
    expect(await focused()).toBe('proseFont=serif');
    await page.keyboard.press('Tab');
    expect(await focused()).toBe('fontSize=small');
    expect((await t.state()).choices).toMatchObject({ theme: 'contrast', proseFont: 'serif', fontSize: 'small' });

    await page.click('.bt-appearance [data-action="reset"]');
    expect((await t.state()).choices).toEqual(DEFAULTS);
    await page.click('.bt-appearance [data-value="xlarge"]');
    await page.keyboard.press('Meta+Enter');
    expect((await t.state()).open).toBe(false);
    expect((await t.state()).applied).toEqual({ ...DEFAULTS, fontSize: 'xlarge' });
    expect(await page.$eval('.ProseMirror', (e) => getComputedStyle(e).lineHeight)).toBe('32px');
  } finally {
    await app.close();
  }
});

test('saved appearance is there at the next launch, theme included, before the first paint', async () => {
  const { app, page, userData, saveDir } = await launch({ file: { name: 'A.md', content: FILE } });
  await setAppearance(page, ['contrast', 'sans', 'wide']);
  await page.waitForTimeout(200);
  await app.close();
  const again = await launch({ reuse: { userData, saveDir } });
  try {
    expect((await bt(again.page).state()).applied).toMatchObject({ theme: 'contrast', proseFont: 'sans', proseWidth: 'wide' });
    // The window itself starts in the theme's color (no flash of another theme).
    const bg = await again.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor());
    expect(bg.toLowerCase()).toBe('#0a0a0a');
  } finally {
    await again.app.close();
  }
});

test('the panel is as tall as its controls need whenever the window allows (no scrolling), and scrolls only when it must', async () => {
  const { app, page } = await launch({ file: { name: 'A.md', content: FILE } });
  try {
    const size = (h: number) => app.evaluate(({ BrowserWindow }, h) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, h), h);
    const controls = () => page.$eval('.bt-appearance-controls', (e) => ({ client: e.clientHeight, scroll: e.scrollHeight }));
    await size(900);
    await page.keyboard.press('Meta+Comma');
    const tall = await controls();
    expect(tall.scroll).toBeLessThanOrEqual(tall.client);
    await size(640);
    await expect.poll(async () => { const c = await controls(); return c.scroll > c.client; }).toBe(true);
    // The sample fills its side: no frame or inset.
    const [preview, sample] = await page.$$eval('.bt-appearance-preview, .bt-sample', (els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    expect(sample).toEqual(preview);
  } finally {
    await app.close();
  }
});

test('while Appearance or History is open, other shortcuts stay out (no find, palette, focus mode or outline behind it)', async () => {
  const { app, page } = await launch({ file: { name: 'A.md', content: FILE } });
  try {
    const state = () => page.evaluate(() => {
      const b = (window as any).__baretext;
      return { find: b.find().open, palette: b.palette().open, focus: document.querySelector<HTMLElement>('.bt-app')!.dataset.focus, outline: b.outline().presence };
    });
    const quiet = { find: false, palette: false, focus: 'false', outline: 'hidden' };
    for (const open of ['Meta+Comma', 'history']) {
      if (open === 'history') await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'history'));
      else await page.keyboard.press(open);
      await page.waitForTimeout(100);
      for (const key of ['Meta+f', 'Meta+k', 'Meta+.', 'Meta+Backslash', 'Meta+Shift+o', 'Meta+Alt+f']) await page.keyboard.press(key);
      expect(await state(), open).toEqual(quiet);
      await page.keyboard.press('Escape');
    }
  } finally {
    await app.close();
  }
});
