import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launch, model } from './launch.ts';

const FILE = '# One\n\n## Harbor\n\nThe quick brown fox.\nSecond line.\n\n## Lighthouse\n\nLight text.\n\n# Two\n\n## Low Tide\n\nTide text.\n';

const state = (page: Page) => page.evaluate(() => (window as any).__baretext.palette());
const labels = (page: Page) => page.$$eval('.bt-palette-row', (rows) => rows.map((r) => r.querySelector('.bt-palette-label')!.textContent));
const activeLabel = (page: Page) => page.$eval('.bt-palette-row[aria-selected="true"] .bt-palette-label', (e) => e.textContent);
const editorFocused = (page: Page) => page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'));

test('opens instantly: typing right after ⌘K goes to the palette, never the manuscript', async () => {
  const { app, page } = await launch({ file: { name: 'P.md', content: FILE } });
  try {
    const before = JSON.stringify(await model(page));
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('type'); // no waiting in between
    expect(await page.inputValue('.bt-palette-input')).toBe('type');
    expect(JSON.stringify(await model(page))).toBe(before);
    expect(await activeLabel(page)).toBe('Typewriter mode');
    // Toggles show a switch, not "on"/"off" text.
    await expect(page.locator('.bt-palette-row[aria-selected="true"] .bt-switch')).toBeVisible();
    await expect(page.locator('.bt-palette-row[aria-selected="true"]')).toHaveAttribute('aria-checked', 'false');

    await page.keyboard.press('Enter');
    expect((await state(page)).open).toBe(false);
    expect(await page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.typewriter)).toBe('true');
    expect(await editorFocused(page)).toBe(true);

    // The toggle now shows its state.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('typew');
    await expect(page.locator('.bt-palette-row[aria-selected="true"]')).toHaveAttribute('aria-checked', 'true');
  } finally {
    await app.close();
  }
});

test('targeted: Format commands appear only with a selection, and act on it', async () => {
  const { app, page } = await launch({ file: { name: 'P.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+k');
    expect(await labels(page)).not.toContain('Bold');
    expect((await labels(page)).length).toBeLessThanOrEqual(16);
    await page.keyboard.press('Escape');
    expect((await state(page)).open).toBe(false);

    // Selected through the model (native Shift+Arrow is unreliable in hidden windows).
    await page.evaluate(() => (window as any).__baretext.selectText('quick'));
    const sel = await page.evaluate(() => (window as any).__baretext.selection());
    await page.keyboard.press('Meta+k');
    expect(await labels(page)).toContain('Bold');
    await page.keyboard.type('bold');
    await page.keyboard.press('Enter');
    const runs = (await model(page)).chapters[0].scenes[0].blocks[0].content;
    expect(runs.find((r: any) => r.bold)?.text).toBe('quick');
    expect(await page.evaluate(() => (window as any).__baretext.selection())).toEqual(sel);
  } finally {
    await app.close();
  }
});

test('keys: arrows wrap, ⌘K toggles, Esc closes without leaving focus mode', async () => {
  const { app, page } = await launch({ file: { name: 'P.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+.');
    await page.keyboard.press('Meta+k');
    const first = await activeLabel(page);
    await page.keyboard.press('ArrowUp');
    const last = await activeLabel(page);
    expect(last).not.toBe(first);
    await page.keyboard.press('ArrowDown');
    expect(await activeLabel(page)).toBe(first);
    await page.keyboard.press('Tab'); // focus stays in the palette
    expect(await page.evaluate(() => document.activeElement?.className)).toBe('bt-palette-input');

    await page.keyboard.press('Meta+k');
    expect((await state(page)).open).toBe(false);
    await page.keyboard.press('Meta+k');
    await page.keyboard.press('Escape');
    expect((await state(page)).open).toBe(false);
    expect(await page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.focus)).toBe('true');
  } finally {
    await app.close();
  }
});

test('go to chapter or scene: ⌘⇧O, current scene marked, search by number or name, back with Backspace', async () => {
  const { app, page } = await launch({ file: { name: 'P.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+Shift+o');
    expect((await state(page)).view).toBe('jump');
    expect(await activeLabel(page)).toBe('1.1 Harbor'); // where the caret is
    await expect(page.locator('.bt-palette-row[aria-current="true"] .bt-palette-label')).toHaveText('1.1 Harbor');

    await page.keyboard.type('tide');
    expect(await labels(page)).toEqual(['2.1 Low Tide']);
    await page.keyboard.press('Enter');
    const m = await model(page);
    expect(await page.evaluate(() => (window as any).__baretext.currentScene())).toBe(m.chapters[1].scenes[0].id);
    expect(await editorFocused(page)).toBe(true);

    // From the command list, and back again with Backspace on an empty query.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('go to');
    await page.keyboard.press('Enter');
    expect((await state(page)).view).toBe('jump');
    await page.keyboard.press('Backspace');
    expect((await state(page)).view).toBe('commands');
    // ⌘⇧O from the command list switches views rather than closing.
    await page.keyboard.press('Meta+Shift+o');
    expect((await state(page)).view).toBe('jump');
    await page.keyboard.type('1.2');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as any).__baretext.currentScene())).toBe(m.chapters[0].scenes[1].id);
  } finally {
    await app.close();
  }
});

test('performance on a 120k-word book', async () => {
  const content = readFileSync(new URL('../../samples/lorem-ipsum-120k.md', import.meta.url), 'utf8');
  const { app, page } = await launch({ file: { name: 'L.md', content } });
  try {
    const opens: number[] = [];
    const filters: number[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Meta+Shift+o');
      opens.push((await state(page)).timings.open);
      for (const ch of 'lorem 12') {
        await page.keyboard.type(ch);
        filters.push((await state(page)).timings.filter);
      }
      await page.keyboard.press('Escape');
      await page.keyboard.press('Meta+k');
      opens.push((await state(page)).timings.open);
      await page.keyboard.press('Escape');
    }
    const max = (a: number[]) => Math.max(...a);
    console.log(`palette open max ${max(opens).toFixed(1)} ms, keystroke filter max ${max(filters).toFixed(1)} ms (${(await page.$$('.bt-palette-row')).length} rows)`);
    expect(max(opens)).toBeLessThan(40);
    expect(max(filters)).toBeLessThan(12);
  } finally {
    await app.close();
  }
});

test('paragraph spacing: one command opens its choices, current one ticked', async () => {
  const { app, page } = await launch({ file: { name: 'P.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('half'); // found through the command's keywords
    expect(await activeLabel(page)).toBe('Paragraph spacing…');
    await page.keyboard.press('Enter');
    expect((await state(page)).view).toBe('spacing');
    expect(await labels(page)).toEqual(['Full line', 'Half line', 'None, indent first lines']);
    await expect(page.locator('.bt-palette-row[aria-current="true"] .bt-palette-label')).toHaveText('Full line');
    await page.keyboard.type('half');
    await page.keyboard.press('Enter');
    expect(await page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.paragraphSpacing)).toBe('half');
    expect(await editorFocused(page)).toBe(true);
  } finally {
    await app.close();
  }
});

test('palette controls sit in columns: switches line up, shortcuts line up', async () => {
  const { app, page } = await launch({ file: { name: 'P.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+k');
    const switches = await page.$$eval('.bt-palette-row .bt-switch', (els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(switches.length).toBeGreaterThanOrEqual(2);
    expect(new Set(switches).size).toBe(1);
    const keys = await page.$$eval('.bt-palette-row .bt-palette-keys', (els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
    expect(new Set(keys).size).toBe(1);
  } finally {
    await app.close();
  }
});
