import { expect, test, type Page } from '@playwright/test';
import { launch, model } from './launch.ts';

// Input-method composition (Japanese, Chinese, accented characters…),
// driven through the same browser events a real IME produces.
const FILE = '# One\n\n## Harbor\n\nFirst line.\nSecond line.\n\n## Light\n\nOther scene.\n';
const blocks = async (page: Page) => (await model(page)).chapters[0].scenes.map((s: any) => [s.name, ...s.blocks.map((b: any) => b.content.map((r: any) => r.text).join(''))]);

async function compose(page: Page, steps: string[], commit: string) {
  const cdp = await page.context().newCDPSession(page);
  for (const text of steps) await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  await cdp.send('Input.insertText', { text: commit });
  await cdp.detach();
}

test('composing in a paragraph inserts the final text once', async () => {
  const { app, page } = await launch({ file: { name: 'I.md', content: FILE } });
  try {
    await page.evaluate(() => (window as any).__baretext.caretAfter('First'));
    await compose(page, ['n', 'に', 'にほ', 'にほん'], '日本');
    expect(await blocks(page)).toEqual([['Harbor', 'First日本 line.', 'Second line.'], ['Light', 'Other scene.']]);
  } finally {
    await app.close();
  }
});

test('composing over a selection that crosses scenes keeps both scenes', async () => {
  const { app, page } = await launch({ file: { name: 'I.md', content: FILE } });
  try {
    // A selection from the first scene into the second, set through the model.
    await page.evaluate(() => (window as any).__baretext.selectRange('Second', 'Other'));
    await compose(page, ['k', 'か'], 'か');
    // The selected text goes (including the second scene's name, which was
    // inside the selection); both scene containers stay (spec §4.4).
    const m = await blocks(page);
    expect(m).toEqual([['Harbor', 'First line.', 'か'], ['', ' scene.']]);
  } finally {
    await app.close();
  }
});

test('composing in a chapter title stays in the title', async () => {
  const { app, page } = await launch({ file: { name: 'I.md', content: FILE } });
  try {
    await page.evaluate(() => (window as any).__baretext.caretAfter('One'));
    await compose(page, ['é'], 'é');
    expect((await model(page)).chapters[0].title).toBe('Oneé');
    expect((await model(page)).chapters[0].scenes).toHaveLength(2);
  } finally {
    await app.close();
  }
});

test('Esc during composition cancels the composition, never focus mode; the toolbar stays away', async () => {
  const { app, page } = await launch({ file: { name: 'I.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+.');
    await page.evaluate(() => (window as any).__baretext.selectText('First'));
    await page.waitForTimeout(500);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
    expect((await page.evaluate(() => (window as any).__baretext.toolbar())).visible).toBe(false);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 229 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 229 });
    expect(await page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.focus)).toBe('true');
    await cdp.send('Input.insertText', { text: '' });
    await cdp.detach();
  } finally {
    await app.close();
  }
});
