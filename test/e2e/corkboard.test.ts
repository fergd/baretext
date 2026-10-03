// The corkboard (DECISIONS §24): the board, the view chips, opening and
// leaving it, the keyboard, opening a scene; the card actions (§25); drag
// to reorder.
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
    await expect(page.locator('[data-ref="crumb"]')).toHaveText(''); // (the chip says where)
    await expect(page.locator('.bt-status .bt-cork-summary')).toBeVisible();
    await expect(page.locator('[data-ref="words"]')).toBeHidden();
    await expect(page.locator('.bt-cork-summary')).toHaveText('2 chapters · 5 scenes · 2,171 words');
    // The keyboard is on the card of the scene being written.
    expect(await focusedCard(page)).toBe('s3x');
    // What acts on the page steps aside.
    for (const ref of ['sidebar', 'notes-button', 'typewriter', 'focus']) await expect(page.locator(`[data-ref="${ref}"]`)).toBeHidden();
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

    // On the title too: its first click starts a rename, the second opens instead (the name untouched).
    await page.keyboard.press('Meta+Shift+C');
    await page.dblclick('.bt-cork-card[data-id="s3x"] .bt-cork-card-title');
    expect(await viewOf(page)).toBe('manuscript');
    expect(await currentScene(page)).toBe('s3x');
    await page.keyboard.press('Meta+Shift+C');
    expect(await titleOf(page, 's3x')).toBe('Letters');
    await expect(page.locator('.bt-cork-rename')).toHaveCount(0);
    await page.keyboard.press('Escape');

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
    await page.evaluate(() => { (window as any).__baretext.navigate('s5x'); (window as any).__baretext.caretToSceneEnd('s5x'); });
    await page.keyboard.type(' A few more words here.');
    expect(JSON.stringify(await model(page))).toContain('A few more words'); // (really written)
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
    await page.click('.bt-cork-controls [data-layout="columns"]');
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

// ── phase 2: what can be done to a card ──

const titleOf = (page: Page, id: string) => page.$eval(`.bt-cork-card[data-id="${id}"] .bt-cork-card-title`, (e) => e.textContent);

test('a card’s ⋯ opens its menu (the toolbar has no card actions); asked to confirm a delete, the card says how', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK }, env: { BARETEXT_MENU_PICK: 'delete' } });
  try {
    await page.keyboard.press('Meta+Shift+C');
    // The top bar holds the board's view controls (no card actions); the status bar, its totals.
    expect(await page.$$eval('.bt-cork-controls button', (bs) => bs.map((b) => b.getAttribute('aria-label') ?? b.textContent))).toEqual(['Rows', 'Columns', 'Arc']);
    await page.hover('.bt-cork-card[data-id="s5x"]');
    await page.click('.bt-cork-card[data-id="s5x"] [data-action="menu"]');
    expect(await focusedCard(page)).toBe('s5x');
    await expect(page.locator('.bt-cork-card[data-id="s5x"]')).toHaveAttribute('data-arming', 'true');
    await expect(page.locator('.bt-cork-card[data-id="s5x"] .bt-cork-armed')).toHaveText('Delete? ⌫ again');
    await page.keyboard.press('Backspace');
    await expect(page.locator('.bt-cork-card[data-id="s5x"]')).toHaveCount(0);
    // However a card gets the keyboard (here directly, as Tab or assistive tech would), its keys act on it.
    await page.locator('.bt-cork-card[data-id="s2x"]').focus();
    await page.keyboard.press('Backspace');
    await expect(page.locator('.bt-cork-card[data-id="s2x"]')).toHaveAttribute('data-arming', 'true');
  } finally {
    await app.close();
  }
});

test('rename in place (a click on the title, R or F2): ↵ keeps it, Esc leaves it, blank unnames — and the writer’s place is kept', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await page.evaluate(() => (window as any).__baretext.navigate('s4x'));
    await page.waitForTimeout(400);
    const where = await page.evaluate(() => { const b = (window as any).__baretext; const h = b.selection().head; return { text: b.textBetween(h, h + 20) }; });
    const line = await page.evaluate(() => (window as any).__baretext.caretTop());
    await page.keyboard.press('Meta+Shift+C');
    await page.locator('.bt-cork-card[data-id="s3x"]').focus();
    await page.keyboard.press('r');
    await expect(page.locator('.bt-cork-rename')).toBeFocused();
    await page.keyboard.press('Meta+A');
    await page.keyboard.type('Letters, unopened');
    await page.keyboard.press('Enter');
    expect(await titleOf(page, 's3x')).toBe('Letters, unopened');
    expect(await focusedCard(page)).toBe('s3x');

    await page.keyboard.press('F2');
    await page.keyboard.type(' and burned');
    await page.keyboard.press('Escape'); // leaves it as it was; the board stays open
    expect(await titleOf(page, 's3x')).toBe('Letters, unopened');
    expect(await viewOf(page)).toBe('corkboard');

    // Clicking away keeps the name, and the keyboard stays where the click put it (not pulled back to the card).
    await page.keyboard.press('r');
    await page.keyboard.press('End');
    await page.keyboard.type(' kept');
    await page.click('.bt-cork-arc-toggle');
    expect(await titleOf(page, 's3x')).toBe('Letters, unopened kept');
    await expect(page.locator('.bt-cork-arc-toggle')).toBeFocused();
    await page.click('.bt-cork-arc-toggle'); // (the arc away again)

    await page.click('.bt-cork-card[data-id="s3x"] .bt-cork-card-title');
    await expect(page.locator('.bt-cork-rename')).toBeFocused();
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    expect(await titleOf(page, 's3x')).toBe('Unnamed scene');

    await page.keyboard.press('Escape');
    // The same place in the book (renaming the scene before it moved the numbers, not the place).
    expect(await currentScene(page)).toBe('s4x');
    expect(await page.evaluate(() => { const b = (window as any).__baretext; const h = b.selection().head; return b.textBetween(h, h + 20); }))
      .toBe(where.text);
    // …and its line where it was on screen (the scroll took up the change above it).
    expect(Math.abs(await page.evaluate(() => (window as any).__baretext.caretTop()) - line)).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
  }
});

test('a new scene (the tile, or N) lands at the chapter’s end, ready to be named; the page keeps its place', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    const where = await caret(page);
    await page.keyboard.press('Meta+Shift+C');
    await page.click('.bt-cork-add[data-add-scene="c1x"]');
    await expect(page.locator('.bt-cork-rename')).toBeFocused();
    await page.keyboard.type('The storm');
    await page.keyboard.press('Enter');
    const chapterOne = async () => (await model(page)).chapters[0].scenes.map((s: any) => s.name);
    expect(await chapterOne()).toEqual([null, 'The log', 'Letters', 'The storm']);
    expect(await page.$eval('.bt-cork-card:focus .bt-cork-card-number', (e) => e.textContent)).toBe('1.4');

    await page.keyboard.press('n');
    await page.keyboard.press('Escape'); // left unnamed
    expect(await chapterOne()).toEqual([null, 'The log', 'Letters', 'The storm', null]);
    expect(await caret(page)).toEqual(where);
  } finally {
    await app.close();
  }
});

test('delete asks twice (⌫ ⌫), the keyboard moves on, and ⌘Z brings it back', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await page.keyboard.press('Meta+Shift+C');
    await page.locator('.bt-cork-card[data-id="s2x"]').focus();
    await page.keyboard.press('Backspace');
    await expect(page.locator('.bt-cork-card[data-id="s2x"]')).toHaveAttribute('data-arming', 'true');
    await expect(page.locator('.bt-cork-card[data-id="s2x"] .bt-cork-armed')).toBeVisible();
    await page.keyboard.press('ArrowRight'); // any other key: not deleted
    await expect(page.locator('.bt-cork-card[data-id="s2x"]')).not.toHaveAttribute('data-arming', 'true');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect(page.locator('.bt-cork-card[data-id="s2x"]')).toHaveCount(0);
    expect(await focusedCard(page)).toBe('s3x');

    await page.keyboard.press('Meta+Z');
    await expect(page.locator('.bt-cork-card[data-id="s2x"]')).toHaveCount(1);
    expect(await viewOf(page)).toBe('corkboard');
  } finally {
    await app.close();
  }
});

test('copy (C) puts the scene on the clipboard with its title, as rich and plain text', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await page.keyboard.press('Meta+Shift+C');
    await page.locator('.bt-cork-card[data-id="s2x"]').focus();
    await page.keyboard.press('c');
    await expect(page.locator('.bt-toast')).toHaveText('Copied 1.2 “The log”.');
    const text = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(text).toBe('The log\n\nWind, sea, ships.');
    const types = await app.evaluate(async ({ clipboard }) => (await clipboard.read()).flatMap((item) => item.types));
    expect(types).toContain('text/html');
  } finally {
    await app.close();
  }
});

test('right-click a card for the same actions as a menu', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK }, env: { BARETEXT_MENU_PICK: 'rename' } });
  try {
    await page.keyboard.press('Meta+Shift+C');
    await page.click('.bt-cork-card[data-id="s4x"] .bt-cork-card-opening', { button: 'right' });
    await expect(page.locator('.bt-cork-rename')).toBeFocused();
    expect(await focusedCard(page)).toBe('s4x');
  } finally {
    await app.close();
  }
});

// ── phase 3: drag to reorder ──

const order = (page: Page) => page.$$eval('.bt-cork-chapter', (ss) => ss.map((s) => `${(s as HTMLElement).dataset.id}: ${[...s.querySelectorAll<HTMLElement>('.bt-cork-card')].map((c) => c.dataset.id).join(' ')}`));
const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;
/** A real pointer drag: press on `from` (its centre), move in steps to `to`, then release (or `release: false`). */
async function drag(page: Page, from: string, to: (b: { x: number; y: number; width: number; height: number }) => { x: number; y: number }, target: string, release = true) {
  await page.waitForFunction(() => document.getAnimations().length === 0); // the last drop has settled
  const a = await box(page, from);
  await page.mouse.move(a.x + a.width / 2, a.y + Math.min(a.height / 2, 12));
  await page.mouse.down();
  const end = to(await box(page, target));
  await page.mouse.move(end.x, end.y, { steps: 12 });
  if (release) await page.mouse.up();
}
const leftOf = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 4, y: b.y + b.height / 2 });
const topOf = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 4 });
const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const below = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height - 4 });

test('drag a card to another place: within its chapter, into another, to a chapter’s end — undoable, the writer’s place kept', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await page.evaluate(() => (window as any).__baretext.navigate('s3x'));
    await page.waitForTimeout(400);
    const at = await page.evaluate(() => { const b = (window as any).__baretext; const h = b.selection().head; return b.textBetween(h, h + 30); });
    await page.keyboard.press('Meta+Shift+C');

    await drag(page, '.bt-cork-card[data-id="s3x"] .bt-cork-card-title', leftOf, '.bt-cork-card[data-id="s1x"]');
    expect(await order(page)).toEqual(['c1x: s3x s1x s2x', 'c2x: s4x s5x']);
    expect(await focusedCard(page)).toBe('s3x'); // the moved card has the keyboard
    await expect(page.locator('.bt-cork-rename')).toHaveCount(0); // (the press began on its title: no rename)

    await drag(page, '.bt-cork-card[data-id="s1x"]', leftOf, '.bt-cork-card[data-id="s5x"]');
    expect(await order(page)).toEqual(['c1x: s3x s2x', 'c2x: s4x s1x s5x']);
    await drag(page, '.bt-cork-card[data-id="s2x"]', centre, '.bt-cork-add[data-add-scene="c2x"]');
    expect(await order(page)).toEqual(['c1x: s3x', 'c2x: s4x s1x s5x s2x']);
    await expect(page.locator('.bt-cork-card[data-id="s2x"] .bt-cork-card-number')).toHaveText('2.4');

    await page.keyboard.press('Meta+Z'); // (the board redraws on the next frame)
    await expect.poll(() => order(page)).toEqual(['c1x: s3x s2x', 'c2x: s4x s1x s5x']);

    // The page: the caret went with its scene, at the same words.
    await page.keyboard.press('Escape');
    expect(await currentScene(page)).toBe('s3x');
    expect(await page.evaluate(() => { const b = (window as any).__baretext; const h = b.selection().head; return b.textBetween(h, h + 30); })).toBe(at);
  } finally {
    await app.close();
  }
});

test('a chapter’s only card stays; dropping where it started, or Esc, changes nothing', async () => {
  const one = serialize({
    title: 'T', coldStorage: [],
    chapters: [
      { id: 'c1x', title: 'One', scenes: [{ id: 's1x', name: 'Alone', link: null, blocks: [p('Only.')] }] },
      { id: 'c2x', title: 'Two', scenes: [{ id: 's2x', name: 'A', link: null, blocks: [p('A.')] }, { id: 's3x', name: 'B', link: null, blocks: [p('B.')] }] },
    ],
  });
  const { app, page } = await launch({ file: { name: 'T.md', content: one } });
  try {
    await page.keyboard.press('Meta+Shift+C');
    const was = await order(page);
    await drag(page, '.bt-cork-card[data-id="s1x"]', leftOf, '.bt-cork-card[data-id="s3x"]');
    expect(await order(page)).toEqual(was);
    await drag(page, '.bt-cork-card[data-id="s2x"]', centre, '.bt-cork-card[data-id="s2x"]');
    expect(await order(page)).toEqual(was);

    await drag(page, '.bt-cork-card[data-id="s3x"]', leftOf, '.bt-cork-card[data-id="s2x"]', false);
    await expect(page.locator('.bt-cork-drop')).toHaveAttribute('data-visible', 'true');
    await page.keyboard.press('Escape'); // cancels the drag; the board stays
    await page.mouse.up();
    expect(await order(page)).toEqual(was);
    expect(await viewOf(page)).toBe('corkboard');
    await expect(page.locator('.bt-cork-ghost')).toHaveCount(0, { timeout: 2000 });
    await page.keyboard.press('Meta+Z'); // nothing was changed, so nothing comes undone
    await page.waitForTimeout(100);
    expect(await order(page)).toEqual(was);
  } finally {
    await app.close();
  }
});

test('drag a chapter by its header, in rows and in columns', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await page.keyboard.press('Meta+Shift+C');
    await drag(page, '.bt-cork-chapter[data-id="c1x"] .bt-cork-chapter-title', below, '.bt-cork-chapter[data-id="c2x"]');
    expect(await order(page)).toEqual(['c2x: s4x s5x', 'c1x: s1x s2x s3x']);
    await expect(page.locator('.bt-cork-chapter[data-id="c1x"] .bt-cork-chapter-number')).toHaveText('2');

    await page.click('[role="radio"][data-layout="columns"]');
    await drag(page, '.bt-cork-chapter[data-id="c1x"] .bt-cork-chapter-title', leftOf, '.bt-cork-chapter[data-id="c2x"]');
    expect(await order(page)).toEqual(['c1x: s1x s2x s3x', 'c2x: s4x s5x']);
    // In columns a card moves down its column.
    await drag(page, '.bt-cork-card[data-id="s3x"]', topOf, '.bt-cork-card[data-id="s1x"]');
    expect(await order(page)).toEqual(['c1x: s3x s1x s2x', 'c2x: s4x s5x']);

    await page.keyboard.press('Meta+Z');
    await page.keyboard.press('Meta+Z');
    await expect.poll(() => order(page)).toEqual(['c2x: s4x s5x', 'c1x: s1x s2x s3x']);
  } finally {
    await app.close();
  }
});

// ── story beats (DECISIONS §27) ──

test('Story beat (B, ⋯, or right-click): a beat chip on the card, saved by scene; one scene per beat; undoable', async () => {
  const marked = BOOK.replace('baretext: 1', 'structure: three-act\nbaretext: 1');
  const { app, page } = await launch({ file: { name: 'L.md', content: marked }, env: { BARETEXT_MENU_PICK: 'beat:midpoint' } });
  try {
    await page.keyboard.press('Meta+Shift+C');
    const chip = (id: string) => page.locator(`.bt-cork-card[data-id="${id}"] .bt-cork-card-beat`);
    await page.locator('.bt-cork-card[data-id="s2x"]').focus();
    await page.keyboard.press('b');
    await expect(chip('s2x')).toHaveText('Midpoint');
    expect(await page.evaluate(() => (window as any).__baretext.model().chapters[0].scenes[1].beat)).toBe('midpoint');

    // The same beat on another card moves it there (right-click: the "Story beat" submenu).
    await page.click('.bt-cork-card[data-id="s4x"] .bt-cork-card-opening', { button: 'right' });
    await expect(chip('s4x')).toHaveText('Midpoint');
    await expect(page.locator('.bt-cork-card-beat')).toHaveCount(1);

    await page.keyboard.press('Meta+Z');
    await expect(chip('s2x')).toHaveText('Midpoint');
    await expect(page.locator('.bt-cork-card-beat')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('Story beat without a structure offers to choose one: Book Settings, then back to the card', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK }, env: { BARETEXT_MENU_PICK: 'choose-structure' } });
  try {
    await page.keyboard.press('Meta+Shift+C');
    await page.locator('.bt-cork-card[data-id="s4x"]').focus();
    await page.keyboard.press('b');
    const panel = page.locator('.bt-book');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    expect(await viewOf(page)).toBe('corkboard');
    expect(await focusedCard(page)).toBe('s4x'); // the keyboard back on the board, not the hidden page
  } finally {
    await app.close();
  }
});

test('the Arc: the whole book’s curve beside the board, each marked scene joined to where its beat usually falls; remembered', async () => {
  const marked = BOOK.replace('baretext: 1', 'structure: three-act\nbaretext: 1');
  const first = await launch({ file: { name: 'L.md', content: marked }, env: { BARETEXT_MENU_PICK: 'beat:midpoint' } });
  try {
    const { page } = first;
    await page.keyboard.press('Meta+Shift+C');
    await page.click('[role="radio"][data-layout="columns"]');
    await page.locator('.bt-cork-card[data-id="s4x"]').focus();
    await page.keyboard.press('b');
    await expect(page.locator('.bt-cork-arc')).toBeHidden(); // (off until asked for)
    await page.click('.bt-cork-arc-toggle');
    await expect(page.locator('.bt-cork-arc-toggle')).toHaveAttribute('aria-pressed', 'true');
    const arc = page.locator('.bt-cork-arc');
    await expect(arc).toBeVisible();
    await expect(arc.locator('.bt-arc-curve')).toHaveCount(1);
    await expect(arc.locator('.bt-arc-ideal')).toHaveCount(6); // three acts: six beats
    await page.waitForFunction(() => document.getAnimations().length === 0); // (it slides in)
    // The whole book at a glance: the marked scene (2.1, late in the book) sits late along the strip, past where its beat usually falls.
    const mark = arc.locator('.bt-arc-mark[data-scene="s4x"]');
    await expect(mark).toHaveCount(1);
    const strip = (await arc.boundingBox())!;
    const at = (await mark.boundingBox())!;
    expect((at.x + at.width / 2 - strip.x) / strip.width).toBeGreaterThan(0.7);
    // The band: the part of the book on screen (all of this short one).
    await expect(arc.locator('.bt-arc-band')).toHaveAttribute('visibility', 'visible');
    await expect(mark.locator('title')).toHaveText(/^Midpoint: 2\.1 — at \d+% \(usually about 50%\)$/);
    // A point is a way to its place: the marked one to its scene; a hollow one to the scene where its beat usually falls.
    await page.locator('.bt-cork-card[data-id="s1x"]').focus();
    await mark.click();
    expect(await focusedCard(page)).toBe('s4x');
    await arc.locator('.bt-arc-ideal[data-beat="inciting-incident"]').click(); // (12%: in 1.1)
    expect(await focusedCard(page)).toBe('s1x');
  } finally {
    await first.app.close();
  }
  // Shown last time: shown again.
  const again = await launch({ reuse: { userData: first.userData, saveDir: first.saveDir } });
  try {
    await again.page.keyboard.press('Meta+Shift+C');
    await expect(again.page.locator('.bt-cork-arc')).toBeVisible();
    await expect(again.page.locator('.bt-cork-arc .bt-arc-mark')).toHaveCount(1);
  } finally {
    await again.app.close();
  }
});

test('the Arc without a structure offers to choose one; in Rows it runs down the left of the chapters', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await page.keyboard.press('Meta+Shift+C');
    await page.click('.bt-cork-arc-toggle');
    const arc = page.locator('.bt-cork-arc');
    await expect(arc).toHaveAttribute('data-empty', 'true');
    await expect(arc.locator('.bt-arc-curve:not(.bt-arc-example)')).toHaveCount(0); // (no arc yet: only a faint example of one)
    await expect(arc.locator('.bt-arc-example')).toHaveCount(1);
    await expect(arc.locator('.bt-arc-band')).not.toHaveAttribute('visibility', 'visible');
    await page.waitForFunction(() => document.getAnimations().length === 0); // (it slides in)
    const box = (await arc.boundingBox())!;
    const chapter = (await page.locator('.bt-cork-chapter[data-id="c1x"]').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(chapter.x);
    expect(box.height).toBeGreaterThan(box.width);
    await arc.locator('.bt-cork-arc-choose').click();
    await expect(page.locator('.bt-book')).toBeVisible();
    await page.locator('.bt-book [data-field="structure"]').selectOption('freytag');
    await page.keyboard.press('Enter');
    await expect(arc.locator('.bt-arc-ideal')).toHaveCount(6); // Freytag: six beats, drawn at once
  } finally {
    await app.close();
  }
});

// ── copying text (DECISIONS §28) ──

const SHORT = serialize({
  title: 'T', coldStorage: [],
  chapters: [
    { id: 'c1x', title: 'Arrival', scenes: [
      { id: 's1x', name: null, link: null, blocks: [p('The boat left.')] },
      { id: 's2x', name: null, link: null, blocks: [p('By October.')] },
      { id: 's3x', name: 'The log', link: null, blocks: [p('Wind, sea.')] },
    ] },
    { id: 'c2x', title: '', scenes: [{ id: 's4x', name: null, link: null, blocks: [p('Later.')] }] },
  ],
});
const CHAPTER_ONE = 'Chapter 1: Arrival\n\nThe boat left.\n\n* * *\n\nBy October.\n\nThe log\n\nWind, sea.';

test('Copy chapter: right-click its header on the board — its title, then its scenes, as text', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: SHORT }, env: { BARETEXT_MENU_PICK: 'copy-chapter' } });
  try {
    await page.keyboard.press('Meta+Shift+C');
    await page.click('.bt-cork-chapter[data-id="c1x"] .bt-cork-chapter-title', { button: 'right' });
    await expect(page.locator('.bt-toast')).toHaveText('Copied chapter 1 “Arrival”.');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(CHAPTER_ONE);
    expect(await app.evaluate(async ({ clipboard }) => (await clipboard.read()).flatMap((item) => item.types))).toContain('text/html'); // (and rich text, for word processors)
  } finally {
    await app.close();
  }
});

test('Copy scene / Copy chapter from the Edit menu: where the writer is; and from the outline (right-click)', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: SHORT }, env: { BARETEXT_MENU_PICK: 'copy' } });
  try {
    await page.evaluate(() => (window as any).__baretext.navigate('s4x'));
    const menu = (label: string) => app.evaluate(({ Menu }, l) => Menu.getApplicationMenu()!.items.find((i) => i.label === 'Edit')!.submenu!.items.find((i) => i.label === l)!.click(), label);
    await menu('Copy Chapter');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Chapter 2\n\nLater.');
    await menu('Copy Scene');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Scene 2.1\n\nLater.');

    await page.keyboard.press('Meta+\\'); // the outline
    await page.click('.bt-outline-row[data-id="c1x"]', { button: 'right' });
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(CHAPTER_ONE);
  } finally {
    await app.close();
  }
});

// ── scene groups (DECISIONS §28) ──

const groups = (page: Page) => page.$$eval('.bt-cork-chapter', (ss) => ss.map((s) => [...s.querySelectorAll<HTMLElement>('.bt-cork-grid > *')].map((u) => (u.classList.contains('bt-cork-group')
  ? `[${[...u.querySelectorAll<HTMLElement>('.bt-cork-card')].map((c) => c.dataset.id).join(' ')}]`
  : u.dataset.id ?? '+')).join(' ')).join(' | '));

test('groups by dragging: a card on a card forms one; into its frame joins; out leaves; the group drags as one — each undoable', async () => {
  const { app, page } = await launch({ file: { name: 'L.md', content: BOOK } });
  try {
    await page.keyboard.press('Meta+Shift+C');
    expect(await groups(page)).toBe('s1x s2x s3x + | s4x s5x +');
    await drag(page, '.bt-cork-card[data-id="s3x"]', centre, '.bt-cork-card[data-id="s1x"]');
    expect(await groups(page)).toBe('[s1x s3x] s2x + | s4x s5x +');
    await drag(page, '.bt-cork-card[data-id="s4x"]', (b) => ({ x: b.x + b.width - 8, y: b.y + b.height - 4 }), '.bt-cork-group');
    expect(await groups(page)).toBe('[s1x s3x s4x] s2x + | s5x +');
    await drag(page, '.bt-cork-card[data-id="s1x"]', leftOf, '.bt-cork-card[data-id="s5x"]');
    expect(await groups(page)).toBe('[s3x s4x] s2x + | s1x s5x +');
    await drag(page, '.bt-cork-group .bt-cork-group-name', leftOf, '.bt-cork-card[data-id="s5x"]');
    expect(await groups(page)).toBe('s2x + | s1x [s3x s4x] s5x +');
    await page.keyboard.press('Meta+Z');
    await expect.poll(() => groups(page)).toBe('[s3x s4x] s2x + | s1x s5x +');
  } finally {
    await app.close();
  }
});

test('a group is named in place, copied and ungrouped from its menu; from the keyboard a card groups with the next', async () => {
  const marked = BOOK; // (no groups yet)
  const first = await launch({ file: { name: 'L.md', content: marked }, env: { BARETEXT_MENU_PICK: 'group-next' } });
  try {
    const { page } = first;
    await page.keyboard.press('Meta+Shift+C');
    await page.locator('.bt-cork-card[data-id="s1x"]').focus();
    await page.keyboard.press('ContextMenu');
    await expect.poll(() => groups(page)).toBe('[s1x s2x] s3x + | s4x s5x +');
    await page.click('.bt-cork-group .bt-cork-group-name');
    await page.keyboard.type('Arrival, twice');
    await page.keyboard.press('Enter');
    await expect(page.locator('.bt-cork-group .bt-cork-group-name')).toHaveText('Arrival, twice');
    expect(await page.evaluate(() => (window as any).__baretext.model().groups)).toEqual({ [await page.$eval('.bt-cork-group', (g) => (g as HTMLElement).dataset.group!)]: 'Arrival, twice' });
  } finally {
    await first.app.close();
  }
  const again = await launch({ reuse: { userData: first.userData, saveDir: first.saveDir }, env: { BARETEXT_MENU_PICK: 'copy' } });
  try {
    const { app, page } = again;
    await page.keyboard.press('Meta+Shift+C');
    await expect(page.locator('.bt-cork-group .bt-cork-group-name')).toHaveText('Arrival, twice'); // (saved, and read back)
    await page.click('.bt-cork-group [data-action="group-menu"]');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/^Arrival, twice\n\nThe boat left her on the jetty\./);
  } finally {
    await again.app.close();
  }
});
