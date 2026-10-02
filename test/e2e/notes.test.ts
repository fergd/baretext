import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { launch, model } from './launch.ts';

const FILE = '# One\n\n## Garden\n\nThey spray the insecticides. Plant basil, or marigolds. The beans fed the soil.\n\nThe woman pivoted and waddled away.\n\n## Market\n\nA second scene, quieter.\n';

const notes = (page: Page) => page.evaluate(() => (window as any).__baretext.notes());
const notesFile = (manuscript: string) => manuscript.replace(/\.md$/, '.notes.json');
async function addNote(page: Page, passage: string, body: string) {
  await page.evaluate((t) => (window as any).__baretext.selectText(t), passage);
  await page.keyboard.press('Meta+Shift+m');
  await page.keyboard.type(body);
  await page.keyboard.press('Enter'); // saved; the caret goes back to the manuscript
}

test('⇧⌘M adds a note to the passage: a card beside it, saved beside the manuscript (never in it), there again after relaunch', async () => {
  const { app, page, userData, saveDir } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    const file = await page.evaluate(() => (window as any).__baretext.filePath());
    await addNote(page, 'Plant basil', 'Right for this climate?');
    const card = page.locator('.bt-note-card');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.bt-note-text')).toHaveText('Right for this climate?');
    await expect(page.locator('.bt-note-anchor')).toHaveText('Plant basil');
    // Level with its passage.
    const [c, a] = await Promise.all([card.boundingBox(), page.locator('.bt-note-anchor').boundingBox()]);
    expect(Math.abs(c!.y - a!.y)).toBeLessThanOrEqual(4);
    await expect.poll(() => existsSync(notesFile(file))).toBe(true);
    await expect.poll(() => JSON.parse(readFileSync(notesFile(file), 'utf8')).notes[0]?.body).toBe('Right for this climate?');
    expect(JSON.parse(readFileSync(notesFile(file), 'utf8')).notes[0].anchor).toMatchObject({ quote: 'Plant basil' });
    await page.evaluate(() => (window as any).__baretext.saveNow());
    expect(readFileSync(file, 'utf8')).not.toContain('Right for this climate');
    await app.close();

    const again = await launch({ reuse: { userData, saveDir } });
    try {
      await again.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
      await expect(again.page.locator('.bt-note-anchor')).toHaveText('Plant basil');
      await expect(again.page.locator('.bt-note-card .bt-note-text')).toHaveText('Right for this climate?');
    } finally {
      await again.app.close();
    }
  } finally {
    await app.close().catch(() => {});
  }
});

test('the anchor follows edits; a deleted passage says so, and ⌘Z brings it back', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    await addNote(page, 'The beans fed the soil', 'Three sisters.');
    await page.evaluate(() => (window as any).__baretext.caretAfter('They spray'));
    await page.keyboard.type(' (every spring)');
    await expect(page.locator('.bt-note-anchor')).toHaveText('The beans fed the soil');

    await page.evaluate(() => (window as any).__baretext.selectRange('The beans', 'soil')); // the whole anchored passage
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Meta+Shift+n'); // the panel
    await expect(page.locator('.bt-notes-card[data-lost="true"] .bt-notes-where')).toHaveText('Passage deleted');
    await expect(page.locator('.bt-note-card')).toHaveCount(0);
    await page.evaluate(() => (window as any).__baretext.caretAfter('waddled'));
    await page.keyboard.press('Meta+z');
    await expect(page.locator('.bt-note-anchor')).toHaveText('The beans fed the soil');
    await expect(page.locator('.bt-notes-card[data-lost="true"]')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the panel: general notes, resolve (hidden, reopenable), delete in two steps; an empty note is let go', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    await addNote(page, 'Plant basil', 'Basil?');
    await page.click('[data-ref="notes-button"]');
    await page.click('.bt-notes-new');
    await page.keyboard.type('The middle sags.');
    await page.keyboard.press('Enter');
    await expect(page.locator('.bt-notes-section').first()).toHaveText('General');
    await expect(page.locator('[data-ref="notes-badge"]')).toHaveText('2');

    // Resolve the passage note: gone from margin and list, back with "Show resolved".
    const anchored = page.locator('.bt-notes-card', { has: page.locator('blockquote', { hasText: 'Plant basil' }) });
    await anchored.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.locator('.bt-note-card')).toHaveCount(0);
    await expect(page.locator('[data-ref="notes-badge"]')).toHaveText('1');
    await page.click('.bt-notes-toggle');
    await anchored.getByRole('button', { name: 'Reopen' }).click();
    await expect(page.locator('.bt-note-card')).toHaveCount(1);

    // Delete takes two steps (resolved notes).
    const general = page.locator('.bt-notes-card:not(:has(blockquote))');
    await general.getByRole('button', { name: 'Resolve' }).click();
    await general.getByRole('button', { name: 'Delete' }).click();
    expect((await notes(page)).all).toHaveLength(2);
    await general.getByRole('button', { name: 'Confirm: delete' }).click();
    expect((await notes(page)).all.map((n: any) => n.body)).toEqual(['Basil?']);

    // A note started and left empty goes, with its anchor.
    await page.evaluate(() => (window as any).__baretext.selectText('marigolds'));
    await page.keyboard.press('Meta+Shift+m');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await notes(page)).all.length).toBe(1);
    expect((await notes(page)).anchors).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test('clicking a noted passage brings its note forward; in a narrow window, markers open notes in the panel', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    await addNote(page, 'Plant basil', 'Basil?');
    await addNote(page, 'waddled away', 'Who is she?');
    await page.locator('.bt-note-anchor', { hasText: 'Plant basil' }).click();
    await expect(page.locator('.bt-note-card[data-active="true"] .bt-note-text')).toHaveText('Basil?');
    expect(await page.evaluate(() => (window as any).__baretext.hasFocus())).toBe(true); // the caret stays in the text

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(900, 800));
    await expect.poll(async () => (await notes(page)).compact).toBe(true);
    await page.locator('.bt-note-card').last().locator('.bt-note-marker').click();
    await expect(page.locator('.bt-notes-panel')).toHaveAttribute('data-open', 'true');
    await expect(page.locator('.bt-app')).toHaveAttribute('data-notes', 'open'); // the page makes room for it
    await expect(page.locator('.bt-notes-card .bt-note-text', { hasText: 'Who is she?' })).toBeInViewport();
  } finally {
    await app.close();
  }
});

test('the outline counts open notes per scene', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE }, settings: { outline: 'pinned' } });
  try {
    await addNote(page, 'Plant basil', 'One.');
    await addNote(page, 'marigolds', 'Two.');
    await addNote(page, 'quieter', 'Three.');
    await expect(page.locator('.bt-outline-row[aria-label^="1.1 "] .bt-outline-notes')).toHaveText('2');
    await expect(page.locator('.bt-outline-row[aria-label^="1.2 "] .bt-outline-notes')).toHaveText('1');
    expect(JSON.stringify(await model(page))).not.toContain('One.');
  } finally {
    await app.close();
  }
});

test('a note travels with its scene into Cold Storage; its card shows only while that scene is open', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE }, settings: { outline: 'pinned' } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1500, 800));
    await addNote(page, 'quieter', 'Cut this?');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const r = page.locator('.bt-outline-row[aria-label^="1.2 "]');
    await r.hover();
    await r.locator('[data-action="park"]').click();
    await expect(page.locator('.bt-note-card')).toHaveCount(0); // not on the manuscript page
    await page.locator('.bt-outline-parked').click();
    await expect(page.locator('.bt-note-card .bt-note-text')).toHaveText('Cut this?');
    await page.keyboard.press('Escape');
    await expect(page.locator('.bt-note-card')).toHaveCount(0);
    await page.keyboard.press('Meta+Shift+n');
    await expect(page.locator('.bt-notes-where')).toHaveText('Cold Storage · Market');
  } finally {
    await app.close();
  }
});

test('resolving a note removes its highlight (the passage reads plain again)', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    await addNote(page, 'Plant basil', 'Done with this.');
    const wash = () => page.locator('.bt-note-anchor').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await wash()).not.toBe('rgba(0, 0, 0, 0)');
    await page.locator('.bt-note-card').hover();
    await page.locator('.bt-note-card').getByRole('button', { name: 'Resolve' }).click();
    await expect.poll(wash).toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('.bt-note-card')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('margin notes float in manuscript mode; the panel, typewriter and focus mode put them away, and a passage then opens its note in the panel', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    await addNote(page, 'Plant basil', 'Basil?');
    const cards = page.locator('.bt-note-card');
    await expect(cards).toBeVisible();
    for (const [on, off] of [['Meta+Shift+n', 'Meta+Shift+n'], ['Meta+Shift+t', 'Meta+Shift+t'], ['Meta+.', 'Meta+.']]) {
      await page.keyboard.press(on!);
      await expect(cards).toBeHidden();
      await page.keyboard.press(off!);
      await expect(cards).toBeVisible();
    }
    await page.keyboard.press('Meta+Shift+t'); // typewriter: no cards
    await page.locator('.bt-note-anchor').click();
    await expect(page.locator('.bt-notes-panel')).toHaveAttribute('data-open', 'true');
    await expect(page.locator('.bt-notes-card .bt-note-text')).toHaveText('Basil?');
    expect(await page.evaluate(() => (window as any).__baretext.hasFocus())).toBe(true); // the caret stays in the text
  } finally {
    await app.close();
  }
});

test("writing a note: Resolve only once it's saved; ↵ saves, ⇧↵ adds a line; the card's shadow is the page's color, not black", async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    await page.evaluate(() => (window as any).__baretext.selectText('Plant basil'));
    await page.keyboard.press('Meta+Shift+m');
    const card = page.locator('.bt-note-card');
    const resolve = card.locator('.bt-note-resolve');
    const save = card.getByRole('button', { name: 'Save' });
    await expect(resolve).toBeHidden();
    await expect(save).toBeDisabled();
    await page.keyboard.type('Basil?');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Or thyme.');
    await expect(resolve).toBeHidden(); // still writing
    await expect(save).toBeEnabled();
    expect((await notes(page)).all[0].body).toBe(''); // nothing saved yet
    await page.keyboard.press('Enter');
    await expect(card.locator('.bt-note-text')).toHaveText('Basil?\nOr thyme.');
    await expect(card.getByRole('button', { name: 'Save' })).toHaveCount(0);
    expect((await notes(page)).all[0].body).toBe('Basil?\nOr thyme.');
    expect(await page.evaluate(() => (window as any).__baretext.hasFocus())).toBe(true); // back to the manuscript
    await card.hover();
    await expect(resolve).toBeVisible();
    const shadow = await card.evaluate((e) => getComputedStyle(e).boxShadow);
    expect(shadow).not.toMatch(/rgba?\(0, 0, 0/); // tinted from the page, never plain black
  } finally {
    await app.close();
  }
});

test('editing a saved note: click its text; Esc keeps the saved text, Save (or clicking away) keeps the new', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    await addNote(page, 'Plant basil', 'Basil?');
    const card = page.locator('.bt-note-card');
    const text = card.locator('.bt-note-text');
    const body = async () => (await notes(page)).all[0].body;

    await text.click();
    await expect(card.locator('.bt-note-resolve')).toBeHidden();
    await page.keyboard.type(' Mint?');
    await page.keyboard.press('Escape');
    await expect(text).toHaveText('Basil?');
    expect(await body()).toBe('Basil?');

    await text.click();
    await page.keyboard.type(' Mint?');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(text).toHaveText('Basil? Mint?');
    expect(await body()).toBe('Basil? Mint?');

    await text.click();
    await page.keyboard.type(' Sage.');
    await page.evaluate(() => (window as any).__baretext.caretAfter('waddled')); // clicking away keeps the draft
    await expect(text).toHaveText('Basil? Mint? Sage.');
    expect(await body()).toBe('Basil? Mint? Sage.');

    // Emptied and saved: the old text stays (a note is never saved blank).
    await text.click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await expect(text).toHaveText('Basil? Mint? Sage.');
    expect((await notes(page)).all).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test('Cancel with the mouse: a new note goes, an edit keeps the saved text (the page never takes the click)', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    const card = page.locator('.bt-note-card');
    await page.evaluate(() => (window as any).__baretext.selectText('Plant basil'));
    await page.keyboard.press('Meta+Shift+m');
    await page.keyboard.type('Never mind.');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(card).toHaveCount(0);
    expect((await notes(page)).all).toHaveLength(0);
    expect((await notes(page)).anchors).toHaveLength(0);

    await addNote(page, 'Plant basil', 'Basil?');
    await card.locator('.bt-note-text').click();
    await page.keyboard.type(' Mint?');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(card.locator('.bt-note-text')).toHaveText('Basil?');
    expect((await notes(page)).all[0].body).toBe('Basil?');

    // Clicking inside the text box keeps the caret there.
    await card.locator('.bt-note-text').click();
    await card.locator('textarea').click();
    await expect(card.locator('textarea')).toBeFocused();
  } finally {
    await app.close();
  }
});

test('every margin card casts the same shadow, active or not (one light source)', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    await addNote(page, 'Plant basil', 'One.');
    await addNote(page, 'waddled away', 'Two.');
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const looks = await page.locator('.bt-note-card').evaluateAll((cards) => cards.map((c) => {
      const s = getComputedStyle(c);
      return { active: (c as HTMLElement).dataset.active, shadow: s.boxShadow, opacity: s.opacity };
    }));
    expect(looks.map((l) => l.active).sort()).toEqual(['false', 'true']);
    expect(looks[0]!.shadow).toBe(looks[1]!.shadow);
    expect(looks.map((l) => l.opacity)).toEqual(['1', '1']); // dimming fades the text, never the shadow
  } finally {
    await app.close();
  }
});

test('the notes panel moves as the outline does: slides in from the right, cards cascade, slides away on close; reduced motion skips it', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    await addNote(page, 'Plant basil', 'One.');
    await addNote(page, 'marigolds', 'Two.');
    await addNote(page, 'waddled away', 'Three.');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const moving = () => page.evaluate(() => {
      const targets = document.getAnimations().map((a) => (a.effect as KeyframeEffect).target as HTMLElement);
      return {
        column: targets.some((e) => e?.classList.contains('bt-notes-panel')),
        page: targets.some((e) => e?.classList.contains('bt-page')),
        cards: targets.filter((e) => e?.classList.contains('bt-notes-card')).length,
      };
    });
    const panel = page.locator('.bt-notes-panel');
    await page.click('[data-ref="notes-button"]');
    await page.waitForFunction(() => document.getAnimations().some((a) => ((a.effect as KeyframeEffect).target as HTMLElement).classList.contains('bt-notes-panel'))); // after the floating notes fade
    expect(await moving()).toEqual({ column: true, page: true, cards: 3 });
    // Like a magnet: the page leads and the column is pulled in behind it —
    // at once (no pause), on a curve that starts gently and settles with the page.
    const motion = await page.evaluate(() => Object.fromEntries(document.getAnimations().flatMap((a) => {
      const el = (a.effect as KeyframeEffect).target as HTMLElement;
      const key = el.classList.contains('bt-page') ? 'page' : el.classList.contains('bt-notes-panel') ? 'column' : null;
      const t = a.effect!.getComputedTiming();
      return key ? [[key, { delay: t.delay, end: t.endTime, easing: t.easing }]] : [];
    })));
    expect(motion.column!.delay).toBe(0);
    expect(motion.column!.end).toBe(motion.page!.end);
    expect(motion.column!.easing).not.toBe(motion.page!.easing);
    await page.waitForFunction(() => document.getAnimations().length === 0);

    // Closing: the column stays painted until it has slid away.
    await page.click('[data-ref="notes-button"]');
    await expect(panel).toHaveAttribute('data-open', 'false');
    await expect(panel).toBeVisible();
    await expect(panel).toBeHidden();

    // Focus mode takes the open panel away with the same motion.
    await page.click('[data-ref="notes-button"]');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await page.keyboard.press('Meta+.');
    expect((await moving()).column).toBe(true);
    await expect(panel).toBeHidden();
    await page.keyboard.press('Meta+.');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await page.click('[data-ref="notes-button"]');
    await page.waitForFunction(() => document.getAnimations().length === 0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('[data-ref="notes-button"]');
    expect(await moving()).toEqual({ column: false, page: false, cards: 0 });
    await expect(panel).toBeVisible();
  } finally {
    await app.close();
  }
});

test('floating notes hand off to the panel: they fade out, then it slides in; it slides out, then they fade back in', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    await addNote(page, 'Plant basil', 'One.');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const timing = () => page.evaluate(() => Object.fromEntries(document.getAnimations().flatMap((a) => {
      const el = (a.effect as KeyframeEffect).target as HTMLElement;
      const key = el.classList.contains('bt-margin-notes') ? 'margin' : el.classList.contains('bt-notes-panel') ? 'panel' : null;
      const t = a.effect!.getComputedTiming();
      return key ? [[key, { delay: t.delay as number, end: (t.delay as number) + (t.duration as number) }]] : [];
    })));

    await page.click('[data-ref="notes-button"]');
    const opening = await timing();
    expect(Object.keys(opening)).toEqual(['margin']); // first the cards fade, where they are
    await expect(page.locator('.bt-note-card .bt-note-text')).toBeVisible(); // as cards, not markers
    await page.waitForFunction(() => document.getAnimations().some((a) => ((a.effect as KeyframeEffect).target as HTMLElement).classList.contains('bt-notes-panel')));
    expect(await page.locator('.bt-margin-notes').evaluate((e) => e.getAnimations().every((a) => a.playState === 'finished'))).toBe(true); // then the panel slides in
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await expect(page.locator('.bt-note-card')).toBeHidden();
    await expect(page.locator('.bt-notes-panel')).toHaveAttribute('data-open', 'true');

    await page.click('[data-ref="notes-button"]');
    const closing = await timing();
    expect(closing.panel!.delay).toBe(0); // the panel goes at once
    expect(closing.margin!.delay).toBeGreaterThan(0);
    expect(closing.margin!.delay).toBeLessThan(closing.panel!.end); // overlapping the slide's settle: one motion
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await expect(page.locator('.bt-note-card')).toBeVisible();
    expect(await page.locator('.bt-margin-notes').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
  } finally {
    await app.close();
  }
});

test('a noted passage is washed in the note color, seamless and square (underlines are for spelling); the active note more; focus mode and resolving clear it', async () => {
  const { app, page } = await launch({ file: { name: 'N.md', content: FILE } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 800));
    const para = page.locator('.ProseMirror p').first();
    const height = await para.evaluate((e) => e.getBoundingClientRect().height);
    await addNote(page, 'Plant basil', 'One.');
    await addNote(page, 'waddled away', 'Two.'); // now the active one
    const look = (text: string) => page.locator('.bt-note-anchor', { hasText: text }).evaluate((e) => {
      const s = getComputedStyle(e);
      return { line: s.textDecorationLine, background: s.backgroundColor, radius: s.borderRadius };
    });
    await page.waitForFunction(() => document.getAnimations().length === 0); // the wash eases in
    const rest = await look('Plant basil');
    const active = await look('waddled away');
    expect(rest).toMatchObject({ line: 'none', radius: '0px' });
    expect(rest.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(active.background).not.toBe(rest.background);
    expect(await para.evaluate((e) => e.getBoundingClientRect().height)).toBe(height);

    await page.keyboard.press('Meta+.'); // focus mode: the words alone
    await expect.poll(async () => (await look('waddled away')).background).toBe('rgba(0, 0, 0, 0)');
    expect((await look('Plant basil')).background).toBe('rgba(0, 0, 0, 0)');
    await page.keyboard.press('Meta+.');
    await expect.poll(async () => (await look('Plant basil')).background).toBe(rest.background);

    await page.locator('.bt-note-card', { hasText: 'One.' }).hover();
    await page.locator('.bt-note-card', { hasText: 'One.' }).getByRole('button', { name: 'Resolve' }).click();
    await expect.poll(async () => (await look('Plant basil')).background).toBe('rgba(0, 0, 0, 0)');
  } finally {
    await app.close();
  }
});
