import { expect, test } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { launch } from './launch.ts';

const para = 'A long paragraph of the novel, written over many mornings, that fills the file. ';
const BIG = '# One\n\n' + Array.from({ length: 80 }, () => para).join('\n') + '\n';

// A sudden gutting of the file is refused (spec §10.4) — but a writer who
// meant it is never stuck: they can undo, or confirm with a two-step
// "Save anyway" (spec §0.8: arm, then confirm; no native dialog).
test('a refused large deletion explains itself and offers Undo or a two-step Save anyway', async () => {
  const { app, page } = await launch({ file: { name: 'Big.md', content: BIG } });
  try {
    const filePath = await page.evaluate(() => (window as any).__baretext.filePath());
    const before = statSync(filePath).size;
    await page.evaluate(() => (window as any).__baretext.selectAll());
    await page.keyboard.press('Backspace');
    expect(await page.evaluate(() => (window as any).__baretext.saveNow())).toBe(false);
    expect(statSync(filePath).size).toBe(before); // refused: the file is untouched

    const notice = page.locator('[data-ref="notice"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('most of the manuscript');
    const confirm = notice.getByRole('button', { name: 'Save anyway' });
    await confirm.click(); // arms
    expect(statSync(filePath).size).toBe(before);
    await expect(notice.getByRole('button', { name: 'Confirm: save' })).toBeVisible();
    await notice.getByRole('button', { name: 'Confirm: save' }).click();
    await expect.poll(() => statSync(filePath).size).toBeLessThan(before / 10);
    await expect(notice).toBeHidden();
    expect(await page.evaluate(() => (window as any).__baretext.isSaved())).toBe(true);
    // Later saves go through normally again (the confirmation covered this deletion only).
    await page.keyboard.type('New beginning.');
    expect(await page.evaluate(() => (window as any).__baretext.saveNow())).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toContain('New beginning.');
  } finally {
    await app.close();
  }
});

test('Undo from the notice brings the text back, and it saves normally', async () => {
  const { app, page } = await launch({ file: { name: 'Big.md', content: BIG } });
  try {
    await page.evaluate(() => (window as any).__baretext.selectAll());
    await page.keyboard.press('Backspace');
    expect(await page.evaluate(() => (window as any).__baretext.saveNow())).toBe(false);
    const notice = page.locator('[data-ref="notice"]');
    await notice.getByRole('button', { name: 'Undo' }).click();
    await expect(notice).toBeHidden();
    expect(JSON.stringify(await page.evaluate(() => (window as any).__baretext.model()))).toContain('many mornings');
    expect(await page.evaluate(() => (window as any).__baretext.saveNow())).toBe(true);
  } finally {
    await app.close();
  }
});

test('a save that fails (the folder became read-only) stays in view with Try again, which saves once possible', async () => {
  const { app, page, saveDir } = await launch({ file: { name: 'R.md', content: '# One\n\nStart.\n' } });
  const { chmodSync } = await import('node:fs');
  try {
    await page.evaluate(() => (window as any).__baretext.caretAfter('Start.'));
    chmodSync(saveDir, 0o555);
    await page.keyboard.type(' More.');
    expect(await page.evaluate(() => (window as any).__baretext.saveNow())).toBe(false);
    const notice = page.locator('[data-ref="notice"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Your text is safe in the window');
    await page.waitForTimeout(9000); // unlike a toast, it does not fade away
    await expect(notice).toBeVisible();

    chmodSync(saveDir, 0o755);
    await notice.getByRole('button', { name: 'Try again' }).click();
    await expect(notice).toBeHidden();
    const filePath = await page.evaluate(() => (window as any).__baretext.filePath());
    expect(readFileSync(filePath, 'utf8')).toContain('Start. More.');
  } finally {
    chmodSync(saveDir, 0o755);
    await app.close();
  }
});

// The last manuscript reopens at launch; if it can't, the writer is told
// why (never a silent new document that looks like a lost book).
test('launch: a moved or unreadable last manuscript is explained, and the file is never touched', async () => {
  const gone = await launch({ settings: { lastFile: '/nowhere/Lost Novel.md' } });
  try {
    await expect(gone.page.locator('[data-ref="toast"]')).toContainText('Lost Novel.md');
    await expect(gone.page.locator('[data-ref="toast"]')).toContainText('moved or renamed');
  } finally {
    await gone.app.close();
  }

  const { chmodSync, writeFileSync, readFileSync: read, mkdtempSync } = await import('node:fs');
  const dir = mkdtempSync(`${(await import('node:os')).tmpdir()}/bt-locked-`);
  const locked = `${dir}/Locked.md`;
  writeFileSync(locked, '# One\n\nPrivate.\n');
  chmodSync(locked, 0o000);
  const denied = await launch({ settings: { lastFile: locked } });
  try {
    await expect(denied.page.locator('[data-ref="toast"]')).toContainText('Locked.md');
    await expect(denied.page.locator('[data-ref="toast"]')).toContainText('could not be opened');
  } finally {
    await denied.app.close();
    chmodSync(locked, 0o644);
    expect(read(locked, 'utf8')).toBe('# One\n\nPrivate.\n');
  }
});
