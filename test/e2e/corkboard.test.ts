// The corkboard (DECISIONS §24), phase 1: the board, the view chips,
// opening and leaving it, the keyboard, opening a scene.
import { expect, test, type Page } from '@playwright/test';
import { serialize } from '../../packages/format/src/index.ts';
import { launch, model } from './launch.ts';

const prose = (n: number) => Array.from({ length: n }, (_, i) => `Sentence ${i + 1} of the scene runs on with ordinary words.`).join(' ');
const p = (text: string) => ({ type: 'paragraph' as const, content: [{ text }] });
const BOOK = serialize({
  title: 'The Lighthouse Keeper',
  coldStorage: [],
  chapters: [
    { id: 'c1x', title: 'Arrival', scenes: [
      { id: 's1x', name: null, link: null, blocks: [p('The boat left her on the jetty.'), ...Array.from({ length: 12 }, () => p(prose(6)))] },
      { id: 's2x', name: 'The log', link: null, blocks: [p('Wind, sea, ships.')] },
      { id: 's3x', name: 'Letters', link: null, blocks: Array.from({ length: 12 }, () => p(prose(6))) },
    ] },
    { id: 'c2x', title: 'Weather', scenes: [
      { id: 's4x', name: 'October', link: null, blocks: Array.from({ length: 12 }, () => p(prose(6))) },
      { id: 's5x', name: null, link: null, blocks: [p('Short.')] },
    ] },
  ],
});

const viewOf = (page: Page) => page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.view ?? 'manuscript');
const focusedCard = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.bt-cork-card')?.dataset.id ?? null);
const caret = (page: Page) => page.evaluate(() => (window as any).__baretext.selection());
const scrollTop = (page: Page) => page.$eval('[data-ref="scroller"]', (e) => e.scrollTop);
const currentScene = (page: Page) => page.evaluate(() => (window as any).__baretext.currentScene());

test('⌘⇧C shows the board in place of the page; Esc returns to the page exactly as it was', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await page.evaluate(() => (window as any).__baretext.navigate('s3x'));
    await page.waitForTimeout(500);
    const [where, top] = [await caret(page), await scrollTop(page)];

    await page.keyboard.press('Meta+Shift+C');
    expect(await viewOf(page)).toBe('corkboard');
    await expect(page.locator('.bt-corkboard')).toHaveAttribute('data-open', 'true');
    await expect(page.locator('.bt-view-tab[data-view="corkboard"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-ref="crumb"]')).toHaveText('Corkboard');
    await expect(page.locator('.bt-cork-summary')).toHaveText('2 chapters · 5 scenes · 2,171 words');
    // The keyboard is on the card of the scene being written.
    expect(await focusedCard(page)).toBe('s3x');
    // What acts on the page steps aside.
    for (const ref of ['sidebar', 'notes-button', 'typewriter', 'focus']) {
      expect(await page.$eval(`[data-ref="${ref}"]`, (e) => getComputedStyle(e).visibility)).toBe('hidden');
    }
    // The cards: number, title (or "Unnamed scene"), opening lines, words or Draft.
    const cards = await page.$$eval('.bt-cork-card', (cs) => cs.map((c) => ({
      number: c.querySelector('.bt-cork-card-number')!.textContent,
      title: c.querySelector('.bt-cork-card-title')!.textContent,
      opening: c.querySelector('.bt-cork-card-opening')!.textContent!.slice(0, 30),
      foot: c.querySelector('.bt-cork-card-words')!.textContent,
    })));
    expect(cards.map((c) => `${c.number} ${c.title} | ${c.foot}`)).toEqual([
      '1.1 Unnamed scene | 727 words', '1.2 The log | Draft', '1.3 Letters | 720 words', '2.1 October | 720 words', '2.2 Unnamed scene | Draft',
    ]);
    expect(cards[0]!.opening).toBe('The boat left her on the jetty');

    await page.keyboard.press('Escape');
    expect(await viewOf(page)).toBe('manuscript');
    expect(await caret(page)).toEqual(where);
    expect(await scrollTop(page)).toBe(top);
    expect(await page.evaluate(() => (window as any).__baretext.hasFocus())).toBe(true);
  } finally {
    await app.close();
  }
});

test('a click on a card only gives it the keyboard; ↵, double-click or Open opens the scene', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    const where = await caret(page);
    await page.keyboard.press('Meta+Shift+C');
    await page.click('.bt-cork-card[data-id="s4x"] .bt-cork-card-opening');
    expect(await focusedCard(page)).toBe('s4x');
    expect(await viewOf(page)).toBe('corkboard'); // nowhere
    expect(await caret(page)).toEqual(where);

    await page.keyboard.press('Enter');
    expect(await viewOf(page)).toBe('manuscript');
    expect(await currentScene(page)).toBe('s4x');

    await page.keyboard.press('Meta+Shift+C');
    await page.dblclick('.bt-cork-card[data-id="s2x"] .bt-cork-card-opening');
    expect(await currentScene(page)).toBe('s2x');

    await page.keyboard.press('Meta+Shift+C');
    await page.hover('.bt-cork-card[data-id="s5x"]');
    await page.click('.bt-cork-card[data-id="s5x"] [data-action="open"]');
    expect(await viewOf(page)).toBe('manuscript');
    expect(await currentScene(page)).toBe('s5x');
  } finally {
    await app.close();
  }
});

test('arrow keys move between cards as they sit on the board', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 800));
    await page.keyboard.press('Meta+Shift+C');
    expect(await focusedCard(page)).toBe('s1x');
    // Three cards fit a row at this width: 1.1 1.2 1.3 / 2.1 2.2. Down from 1.3 is the
    // nearest card below (2.2); up from 2.2 is the card right above it (1.2).
    const steps: [string, string][] = [['ArrowRight', 's2x'], ['ArrowRight', 's3x'], ['ArrowDown', 's5x'], ['ArrowUp', 's2x'], ['ArrowLeft', 's1x'], ['End', 's5x'], ['Home', 's1x']];
    for (const [key, card] of steps) {
      await page.keyboard.press(key);
      expect(await focusedCard(page), key).toBe(card);
    }
  } finally {
    await app.close();
  }
});

test('the view chips switch views (←/→ too); page commands from the board go back to the page', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await page.click('.bt-view-tab[data-view="corkboard"]');
    expect(await viewOf(page)).toBe('corkboard');
    await page.focus('.bt-view-tab[data-view="corkboard"]');
    await page.keyboard.press('ArrowLeft');
    expect(await viewOf(page)).toBe('manuscript');
    await expect(page.locator('.bt-view-tab[data-view="manuscript"]')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Meta+Shift+C');
    await page.keyboard.press('Meta+F');
    expect(await viewOf(page)).toBe('manuscript');
    await expect(page.locator('.bt-find')).toHaveAttribute('data-open', 'true');
  } finally {
    await app.close();
  }
});

test('undo from the board changes the book and the board, and the keyboard stays on the board', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await page.evaluate(() => (window as any).__baretext.navigate('s5x'));
    await page.keyboard.type(' A few more words here.');
    await page.keyboard.press('Meta+Shift+C');
    const foot = page.locator('.bt-cork-card[data-id="s5x"] .bt-cork-card-words');
    await expect(foot).toHaveText('Draft'); // 6 words
    await page.keyboard.press('Meta+Z');
    await expect.poll(async () => JSON.stringify(await model(page))).not.toContain('A few more words');
    expect(await viewOf(page)).toBe('corkboard');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.bt-corkboard'))).toBe(true);
  } finally {
    await app.close();
  }
});

test('there is no corkboard in Sprinter', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await page.keyboard.press('Meta+Shift+S');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Meta+Shift+C');
    expect(await viewOf(page)).toBe('manuscript');
    expect(await page.$eval('.bt-view-tabs', (e) => getComputedStyle(e).visibility)).toBe('hidden');
    const item = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find((i) => i.label === 'View')!.submenu!.items.find((i) => i.label === 'Corkboard')!.enabled);
    expect(item).toBe(false);
  } finally {
    await app.close();
  }
});

test('the board’s toolbar switches rows and columns (remembered); in columns the arrows follow the columns', async () => {
  const first = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    const { page } = first;
    await page.keyboard.press('Meta+Shift+C');
    await expect(page.locator('.bt-corkboard')).toHaveAttribute('data-layout', 'rows');
    await page.click('.bt-cork-bar [data-layout="columns"]');
    await expect(page.locator('.bt-corkboard')).toHaveAttribute('data-layout', 'columns');
    // Each chapter a column: chapter 2's cards sit beside chapter 1's.
    const [a, b] = await page.$$eval('.bt-cork-chapter', (cs) => cs.map((c) => c.getBoundingClientRect().left));
    expect(b!).toBeGreaterThan(a!);
    // Down the column (and on into the next chapter), across to the next column.
    await page.locator('.bt-cork-card[data-id="s1x"]').focus();
    const steps: [string, string][] = [['ArrowDown', 's2x'], ['ArrowRight', 's5x'], ['ArrowUp', 's4x'], ['ArrowLeft', 's1x'], ['ArrowDown', 's2x'], ['ArrowDown', 's3x'], ['ArrowDown', 's4x']];
    for (const [key, card] of steps) {
      await page.keyboard.press(key);
      expect(await focusedCard(page), key).toBe(card);
    }
    // A click on a card still only gives it the keyboard.
    await page.click('.bt-cork-card[data-id="s5x"] .bt-cork-card-opening');
    expect(await focusedCard(page)).toBe('s5x');
    expect(await viewOf(page)).toBe('corkboard');
  } finally {
    await first.app.close();
  }
  const again = await launch({ reuse: first });
  try {
    await again.page.keyboard.press('Meta+Shift+C');
    await expect(again.page.locator('.bt-corkboard')).toHaveAttribute('data-layout', 'columns');
  } finally {
    await again.app.close();
  }
});
