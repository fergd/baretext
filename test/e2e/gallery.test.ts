// The component gallery, frame by frame: every component × state × theme
// against a saved picture. (The gallery holds everything still itself:
// frozen clock, no transitions, the timer line paused where it is.) A visual change fails here until it is looked at
// and accepted (`npx playwright test gallery --update-snapshots`).
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const THEMES = ['dracula', 'dark', 'light', 'grove', 'contrast'] as const;

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(here, '../../build/main/main.cjs')],
    env: { ...process.env, BARETEXT_HIDDEN: '1', BARETEXT_GALLERY: '1', BARETEXT_USER_DATA: mkdtempSync(path.join(os.tmpdir(), 'bt-gallery-')) },
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1400, 900));
});

test.afterAll(async () => {
  await app?.close();
});

for (const theme of THEMES) {
  test(`every component, in ${theme}`, async () => {
    await page.click(`.g-themes [data-value="${theme}"]`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const frames = await page.$$eval('[data-frame]', (els) => els.map((e) => ({ name: (e as HTMLElement).dataset.frame!, finish: 'finish' in (e as HTMLElement).dataset })));
    expect(frames.length).toBeGreaterThanOrEqual(20);
    for (const { name: frame, finish } of frames) {
      // A state with a last step (the keyboard, the pointer) takes it just before its picture.
      if (finish) await page.evaluate((name) => (window as unknown as { finishFrame(n: string): Promise<void> }).finishFrame(name), frame);
      await expect.soft(page.locator(`[data-frame="${frame}"]`)).toHaveScreenshot(`${frame}.png`, { animations: 'allow', caret: 'hide' });
    }
  });
}
