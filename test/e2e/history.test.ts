import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { launch, model } from './launch.ts';

const FILE = '# One\n\n## Harbor\n\nThe original opening line.\nA second line.\n';
const rows = (page: Page) => page.$$eval('.bt-history-row', (rs) => rs.map((r) => r.querySelector('.bt-history-what')!.textContent));
const prose = async (page: Page) => (await model(page)).chapters[0].scenes[0].blocks.map((b: any) => b.content.map((r: any) => r.text).join(''));
const openHistory = async (page: Page) => {
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('history');
  await page.keyboard.press('Enter');
  await expect(page.locator('.bt-history')).toHaveAttribute('data-open', 'true');
  await expect(page.locator('.bt-history-row').first()).toBeVisible();
};

test('opening takes a Daily snapshot, stored outside the manuscript folder', async () => {
  const { app, page, userData, saveDir } = await launch({ file: { name: 'H.md', content: FILE } });
  try {
    await openHistory(page);
    // "Opened" would repeat the Daily snapshot exactly, so only Daily is listed.
    expect(await rows(page)).toEqual(['Daily']);
    expect(readdirSync(`${userData}/Snapshots`)).toHaveLength(1);
    expect(readdirSync(saveDir).filter((f) => !f.endsWith('.md'))).toEqual([]); // nothing beside the manuscript
    await page.keyboard.press('Escape');
    expect((await page.evaluate(() => (window as any).__baretext.history())).open).toBe(false);
  } finally {
    await app.close();
  }
});

test('save a labeled snapshot, write more, preview it, restore it, and undo the restore', async () => {
  const { app, page } = await launch({ file: { name: 'H.md', content: FILE } });
  try {
    // A labeled snapshot of the original.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('save snapshot');
    await page.keyboard.press('Enter');
    await expect(page.locator('.bt-history-label')).toBeFocused();
    await page.keyboard.type('Before rewrite');
    await page.keyboard.press('Enter');
    await expect(page.locator('.bt-history-row').first().locator('.bt-history-what')).toHaveText('Before rewrite');
    await page.keyboard.press('Escape');

    // Rewrite the opening and let it save.
    await page.evaluate(() => (window as any).__baretext.selectText('The original opening line.'));
    await page.keyboard.type('A completely new opening.');
    await page.evaluate(() => (window as any).__baretext.saveNow());
    expect((await prose(page))[0]).toBe('A completely new opening.');

    // Preview the labeled version and restore it.
    await openHistory(page);
    await page.locator('.bt-history-row', { hasText: 'Before rewrite' }).click();
    await expect(page.locator('.bt-history-preview-text')).toContainText('The original opening line.');
    await page.click('[data-action="restore"]');
    await expect(page.locator('.bt-history')).toHaveAttribute('data-open', 'false');
    expect((await prose(page))[0]).toBe('The original opening line.');
    await expect(page.locator('[data-ref="toast"]')).toContainText('⌘Z undoes it');

    // One undo brings the rewrite back; and the rewrite was kept as a snapshot too.
    await page.keyboard.press('Meta+z');
    expect((await prose(page))[0]).toBe('A completely new opening.');
    await openHistory(page);
    expect(await rows(page)).toContain('Before restore');
  } finally {
    await app.close();
  }
});

test('Replace All takes a snapshot first', async () => {
  const { app, page } = await launch({ file: { name: 'H.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+Alt+f');
    await page.keyboard.type('line');
    await page.fill('[data-ref="replace"]', 'row');
    await page.click('[data-action="all"]');
    await page.keyboard.press('Escape');
    await openHistory(page);
    expect((await rows(page))[0]).toBe('Before Replace All');
    await page.locator('.bt-history-row').first().click();
    await expect(page.locator('.bt-history-preview-text')).toContainText('The original opening line.');
  } finally {
    await app.close();
  }
});

test('history of a 120k-word book opens and previews quickly', async () => {
  const content = readFileSync(new URL('../../samples/lorem-ipsum-120k.md', import.meta.url), 'utf8');
  const { app, page } = await launch({ file: { name: 'L.md', content } });
  try {
    await page.waitForTimeout(500); // let the opening snapshots land
    const t0 = Date.now();
    await openHistory(page);
    await expect(page.locator('.bt-hp-p').first()).toBeVisible();
    const ms = Date.now() - t0;
    console.log(`history open + 120k preview: ${ms} ms`);
    expect(ms).toBeLessThan(1500);
  } finally {
    await app.close();
  }
});
