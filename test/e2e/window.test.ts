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
