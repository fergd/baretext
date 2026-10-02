import { expect, test } from '@playwright/test';
import { launch } from './launch.ts';

test('the window reopens at the size and position it was left', async () => {
  const first = await launch({ file: { name: 'W.md', content: '# One\n\nText.\n' } });
  const target = await first.app.evaluate(({ BrowserWindow, screen }) => {
    const a = screen.getPrimaryDisplay().workArea;
    const b = { x: a.x + 40, y: a.y + 30, width: Math.min(1300, a.width - 80), height: Math.min(820, a.height - 60) };
    BrowserWindow.getAllWindows()[0]!.setBounds(b);
    return b;
  });
  await first.page.waitForTimeout(600); // the debounced save
  await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close()); // quit as a user would
  await first.app.waitForEvent('close');

  const second = await launch({ reuse: { userData: first.userData, saveDir: first.saveDir } });
  try {
    const bounds = await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds());
    expect(bounds).toEqual(target);
  } finally {
    await second.app.close();
  }
});

test('the title bar text is optically centered on the bar (level with the traffic lights)', async () => {
  const { app, page } = await launch({ file: { name: 'W.md', content: '---\ntitle: Bookie Bookerface\n---\n# One\n\nText.\n' } });
  try {
    const capCenter = await page.evaluate(() => {
      const title = document.querySelector('[data-ref="title"]') as HTMLElement;
      const chrome = document.querySelector('.bt-chrome') as HTMLElement;
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      title.append(probe);
      const baseline = probe.getBoundingClientRect().bottom - chrome.getBoundingClientRect().top;
      probe.remove();
      const cs = getComputedStyle(title);
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
      return { center: baseline - ctx.measureText('B').actualBoundingBoxAscent / 2, bar: chrome.getBoundingClientRect().height };
    });
    expect(Math.abs(capCenter.center - capCenter.bar / 2)).toBeLessThanOrEqual(0.25);
  } finally {
    await app.close();
  }
});

test('the breadcrumb keeps the writer’s own capitalization; only the book title is in capitals', async () => {
  const src = '---\ntitle: Testing the Spirits\n---\n# Everything Is Great\n\n## The Stage Side Door\n\nText.\n';
  const { app, page } = await launch({ file: { name: 'W.md', content: src } });
  try {
    await expect(page.locator('[data-ref="crumb"]')).toHaveText('Chapter 1 · Everything Is Great · The Stage Side Door');
    expect(await page.$eval('[data-ref="crumb"]', (e) => getComputedStyle(e).textTransform)).toBe('none');
    expect(await page.$eval('[data-ref="title"]', (e) => getComputedStyle(e).textTransform)).toBe('uppercase');
  } finally {
    await app.close();
  }
});

test('status bar: Typewriter is a switch; Focus is a button that enters focus mode, with a hint on how to leave', async () => {
  const { app, page } = await launch({ file: { name: 'W.md', content: '# One\n\nText.\n' } });
  try {
    const tw = page.getByRole('switch', { name: 'Typewriter' });
    const focus = page.getByRole('button', { name: 'Focus' });
    await expect(tw).toHaveAttribute('aria-checked', 'false');
    expect(await focus.getAttribute('aria-checked')).toBeNull(); // an action, not a state
    await expect(tw.locator('.bt-switch')).toBeVisible();

    await tw.click();
    await expect(tw).toHaveAttribute('aria-checked', 'true');
    expect(await page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.typewriter)).toBe('true');
    // The knob slides to the right when on.
    const knobX = (sel: string) => page.$eval(sel, (e) => e.getBoundingClientRect().left);
    await page.keyboard.press('Meta+Shift+t'); // the shortcut keeps the switch in step
    await expect(tw).toHaveAttribute('aria-checked', 'false');
    const off = await knobX('[data-ref="typewriter"] .bt-switch-knob');
    await tw.click();
    await page.waitForTimeout(300);
    expect(await knobX('[data-ref="typewriter"] .bt-switch-knob')).toBeGreaterThan(off);

    const toast = page.locator('[data-ref="toast"]');
    await focus.click();
    expect(await page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.focus)).toBe('true');
    await expect(toast).toHaveText('Esc or ⌘. to leave focus');
    await expect(toast).toHaveAttribute('data-visible', 'true');
    await expect(toast).toHaveAttribute('data-visible', 'false', { timeout: 5000 }); // it fades by itself
    await page.keyboard.press('Escape');
    expect(await page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.focus)).toBe('false');
    await expect(focus).toBeVisible();

    // Leaving at once takes the hint with it.
    await page.keyboard.press('Meta+.');
    await expect(toast).toHaveAttribute('data-visible', 'true');
    await page.keyboard.press('Meta+.');
    await expect(toast).toHaveAttribute('data-visible', 'false');
  } finally {
    await app.close();
  }
});

test('the app never shifts in its window: nothing can scroll it, even content that overflows and asks to be shown', async () => {
  const { app, page } = await launch({ file: { name: 'W.md', content: '# One\n\nText.\n' } });
  try {
    const layout = () => page.evaluate(() => ({
      chrome: Math.round(document.querySelector('.bt-chrome')!.getBoundingClientRect().top),
      status: Math.round(document.querySelector('.bt-status')!.getBoundingClientRect().bottom),
      height: innerHeight,
    }));
    const before = await layout();
    expect(before.chrome).toBe(0);
    expect(before.status).toBe(before.height);
    await page.evaluate(() => {
      // Something sticks out below the window (in the body, or in the page's middle row) and is scrolled to.
      const below = Object.assign(document.createElement('div'), { tabIndex: -1 });
      below.style.cssText = 'position:absolute;top:150vh;height:10px;width:10px';
      document.body.append(below);
      below.scrollIntoView();
      below.focus();
      const tall = document.createElement('div');
      tall.style.cssText = 'height:300vh';
      document.querySelector('.bt-workspace')!.append(tall);
      tall.scrollIntoView({ block: 'end' });
      for (const el of [document.documentElement, document.body, document.querySelector('.bt-app')!]) el.scrollTop = 500;
    });
    expect(await layout()).toEqual(before);
  } finally {
    await app.close();
  }
});
