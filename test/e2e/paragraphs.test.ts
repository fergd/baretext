import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { launch } from './launch.ts';

// One line per paragraph, no blank lines between them (the previous app's convention).
const FILE = '# One\n\nFirst paragraph.\nSecond paragraph.\nThird paragraph.\n';

/** Gap between consecutive paragraphs, and each paragraph's first-line indent. */
const measure = (page: Page) => page.evaluate(() => {
  const ps = [...document.querySelectorAll<HTMLElement>('.ProseMirror p')];
  const r = ps.map((p) => p.getBoundingClientRect());
  return {
    count: ps.length,
    gaps: r.slice(1).map((b, i) => Math.round(b.top - r[i]!.bottom)),
    indents: ps.map((p) => parseFloat(getComputedStyle(p).textIndent)),
  };
});

const clickSpacing = (app: ElectronApplication, label: string) => app.evaluate(({ Menu }, label) => {
  const format = Menu.getApplicationMenu()!.items.find((i) => i.label === 'Format')!;
  const spacing = format.submenu!.items.find((i) => i.label === 'Paragraph Spacing')!;
  spacing.submenu!.items.find((i) => i.label === label)!.click();
}, label);

test('each line is a paragraph, and paragraph spacing is a persisted setting', async () => {
  const { app, page, userData } = await launch({ file: { name: 'Lines.md', content: FILE } });
  try {
    expect(await measure(page)).toEqual({ count: 3, gaps: [24, 24], indents: [0, 0, 0] });

    await clickSpacing(app, 'Half Line');
    await expect.poll(() => measure(page)).toEqual({ count: 3, gaps: [12, 12], indents: [0, 0, 0] });

    await clickSpacing(app, 'None (Indent First Lines)');
    // Book style: no gap, and the first paragraph after the heading is not indented.
    await expect.poll(() => measure(page)).toEqual({ count: 3, gaps: [0, 0], indents: [0, 24, 24] });

    await expect.poll(() => JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8')).paragraphSpacing).toBe('none');
  } finally {
    await app.close();
  }
});

test('the saved paragraph spacing applies at launch', async () => {
  const { app, page } = await launch({ file: { name: 'Lines.md', content: FILE }, settings: { paragraphSpacing: 'half' } });
  try {
    expect((await measure(page)).gaps).toEqual([12, 12]);
  } finally {
    await app.close();
  }
});
