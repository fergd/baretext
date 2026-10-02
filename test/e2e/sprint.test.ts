import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, model } from './launch.ts';
import { serialize } from '../../packages/format/src/index.ts';

const para = 'Words that fill the scene so that it takes up real vertical space on the page. '.repeat(3);
const FILE = '# Book\n\n# Chapter 1\n\n## Scene 1.1\n\n' + Array.from({ length: 8 }, () => para).join('\n\n') + '\n\n## Scene 1.2\n\n' + para + '\n';

const setup = (page: Page) => page.locator('.bt-sprint-setup');
const mode = (page: Page) => page.$eval('.bt-app', (e) => (e as HTMLElement).dataset.mode);
const sprint = (page: Page) => page.evaluate(() => (window as any).__baretext.sprint());
const record = (userData: string, id: string) => {
  try { return JSON.parse(readFileSync(path.join(userData, 'Sprints', `${id}.json`), 'utf8')); } catch { return null; }
};
// Two chapters and a parked scene, for placing sprints.
const FILE2 = (() => {
  const m = { title: 'Book', chapters: [
    { id: 'aaa1', title: 'One', scenes: [{ id: 'sss1', name: null, link: null, blocks: [{ type: 'paragraph' as const, content: [{ text: 'One.' }] }] }] },
    { id: 'aaa2', title: 'Two', scenes: [{ id: 'sss2', name: null, link: null, blocks: [{ type: 'paragraph' as const, content: [{ text: 'Two.' }] }] }] },
  ], coldStorage: [] };
  return serialize(m);
})();
const checked = (page: Page, group: string) => page.$eval(`.bt-sprint [data-group="${group}"][aria-checked="true"]`, (e) => (e as HTMLElement).dataset.value);

test('⌘⇧S opens setup; Esc cancels and stays in Manuscript, the caret where it was', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    const caret = await page.evaluate(() => (window as any).__baretext.selection().head);
    await page.keyboard.press('Meta+Shift+S');
    await expect(setup(page)).toHaveAttribute('data-open', 'true');
    // Defaults: a 15-minute sprint, goal suggested from the length, one round.
    expect(await checked(page, 'kind')).toBe('time');
    expect(await checked(page, 'length')).toBe('15');
    expect(await page.inputValue('.bt-sprint-goal')).toBe('');
    expect(await page.getAttribute('.bt-sprint-goal', 'placeholder')).toBe('300');
    expect(await checked(page, 'rounds')).toBe('1');
    await expect(page.locator('[data-group="breakMinutes"]').first()).toBeDisabled(); // no breaks in a single sprint
    await expect(page.locator('.bt-sprint-summary')).toHaveText(/^Ends /);

    await page.keyboard.press('Escape');
    await expect(setup(page)).toHaveAttribute('data-open', 'false');
    expect(await mode(page)).toBe('manuscript');
    expect(await page.evaluate(() => (window as any).__baretext.selection().head)).toBe(caret);
    expect(await page.evaluate(() => (window as any).__baretext.hasFocus())).toBe(true);
  } finally {
    await app.close();
  }
});

test('choosing a session: presets, a custom length, rounds and breaks; the goal follows the length until typed', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+Shift+S');
    // Arrow keys move through the presets.
    await page.keyboard.press('ArrowRight');
    expect(await checked(page, 'length')).toBe('20');
    expect(await page.getAttribute('.bt-sprint-goal', 'placeholder')).toBe('400');
    // A custom length takes over from the presets.
    await page.click('.bt-sprint-custom');
    await page.keyboard.type('40');
    await expect(page.locator('.bt-sprint-custom')).toHaveAttribute('data-active', 'true');
    expect(await page.$$eval('.bt-sprint-presets [aria-checked="true"]', (e) => e.length)).toBe(0);
    expect(await page.getAttribute('.bt-sprint-goal', 'placeholder')).toBe('800');
    // …and a custom value that matches a preset is that preset.
    await page.fill('.bt-sprint-custom', '25');
    expect(await checked(page, 'length')).toBe('25');
    await page.fill('.bt-sprint-custom', '40');

    await page.click('[data-group="rounds"][data-value="3"]');
    await expect(page.locator('[data-group="breakMinutes"]').first()).toBeEnabled();
    await page.click('[data-group="breakMinutes"][data-value="10"]');
    await expect(page.locator('.bt-sprint-summary')).toHaveText(/^3 × 40 min · ends /);
    await page.fill('.bt-sprint-goal', '1000');

    // Words: the target is the length; there is no separate goal.
    await page.click('[data-group="kind"][data-value="words"]');
    expect(await checked(page, 'length')).toBe('500');
    await expect(page.locator('[data-row="goal"]')).toBeHidden();
    await expect(page.locator('.bt-sprint-unit')).toHaveText('Words');
    await expect(page.locator('.bt-sprint-summary')).toHaveText('3 × 500 words');
    await page.click('[data-group="kind"][data-value="time"]');
    expect(await page.inputValue('.bt-sprint-custom')).toBe('40'); // the time choice was kept
  } finally {
    await app.close();
  }
});

test('Enter starts: a blank sprint page over an untouched manuscript, with typewriter on and no structure', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+Backslash'); // the outline open beforehand
    await expect(page.locator('.bt-app')).toHaveAttribute('data-outline', 'pinned');
    const before = await model(page);
    const caret = await page.evaluate(() => (window as any).__baretext.selection());
    const scroll = await page.$eval('.bt-workspace > .bt-scroller', (e) => e.scrollTop);

    await page.keyboard.press('Meta+Shift+S');
    await page.keyboard.press('Enter');
    expect(await mode(page)).toBe('sprinter');
    const s = await sprint(page);
    expect(s.open).toBe(true);
    expect(s.blocks).toEqual([]);
    expect(s.focused).toBe(true);
    await page.waitForTimeout(100); // the blank page's first save
    expect(await page.$$eval('.bt-toast[data-kind="error"][data-visible="true"]', (e) => e.length)).toBe(0);
    await expect(page.locator('.bt-sprint-page')).toHaveAttribute('data-typewriter', 'true');
    await expect(page.locator('.bt-app')).toHaveAttribute('data-outline', 'hidden');
    await expect.poll(() => page.$eval('.bt-spine-inner', (e) => getComputedStyle(e).visibility)).toBe('hidden');

    await page.keyboard.type('A warm-up. ');
    await page.keyboard.press('Meta+B');
    await page.keyboard.type('Bold');
    await expect(page.locator('[data-ref="words"]')).toHaveText('3 words');
    // No navigation; the manuscript, its caret and scroll never moved.
    await page.keyboard.press('Meta+Shift+O');
    await page.keyboard.press('Meta+Backslash');
    expect(await page.evaluate(() => (window as any).__baretext.palette().open)).toBe(false);
    expect(await model(page)).toEqual(before);
    expect(await page.evaluate(() => (window as any).__baretext.selection())).toEqual(caret);
    expect(await page.$eval('.bt-workspace > .bt-scroller', (e) => e.scrollTop)).toBe(scroll);
    expect((await sprint(page)).blocks).toEqual([{ type: 'paragraph', content: [{ text: 'A warm-up. ' }, { text: 'Bold', bold: true }] }]);
  } finally {
    await app.close();
  }
});

test('ending asks where the writing goes; nothing is chosen for you; Keep writing goes back', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+Shift+S');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Something worth keeping.');
    await page.keyboard.press('Meta+Shift+D');
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'true');
    await expect(page.locator('.bt-keep-words')).toHaveText('3 words');
    expect(await page.$$eval('.bt-keep [aria-checked="true"]', (e) => e.length)).toBe(0);
    await expect(page.locator('.bt-keep [data-action="done"]')).toBeDisabled();
    await page.keyboard.press('Enter'); // nothing chosen: nothing happens
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'true');

    await page.keyboard.press('Escape'); // Keep writing
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'false');
    expect(await mode(page)).toBe('sprinter');
    expect((await sprint(page)).focused).toBe(true);
    await page.keyboard.type(' More.');
    expect((await sprint(page)).words).toBe(4);
  } finally {
    await app.close();
  }
});

for (const [choice, label] of [['chapter', 'end of a chapter'], ['end', 'end of the book'], ['cold', 'Cold Storage']] as const) {
  test(`placing the sprint at the ${label}: one new scene, one undo; the sprint is recorded as placed`, async () => {
    const { app, page, userData } = await launch({ file: { name: 'S.md', content: FILE2 } });
    try {
      const before = await model(page);
      await page.keyboard.press('Meta+Shift+S');
      await page.keyboard.press('Enter');
      await page.keyboard.type('First line.');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Second line.');
      const id = (await sprint(page)).record.id;
      await page.keyboard.press('Meta+Shift+D');
      await page.click(`.bt-keep-radio[data-value="${choice}"]`);
      if (choice === 'chapter') await page.selectOption('.bt-keep-chapter-select', '0');
      await page.keyboard.press('Enter');
      await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'false');
      expect(await mode(page)).toBe('manuscript');

      const after = await model(page);
      const added = { name: null, link: null, blocks: [{ type: 'paragraph', content: [{ text: 'First line.' }] }, { type: 'paragraph', content: [{ text: 'Second line.' }] }] };
      const target = choice === 'chapter' ? after.chapters[0].scenes : choice === 'end' ? after.chapters.at(-1).scenes : after.coldStorage;
      expect(target.length).toBe((choice === 'chapter' ? before.chapters[0].scenes : choice === 'end' ? before.chapters.at(-1).scenes : before.coldStorage).length + 1);
      // Parked, it is named for what it was; in the story, it is just a scene.
      expect(target.at(-1)).toMatchObject(choice === 'cold' ? { ...added, name: expect.stringMatching(/^Sprint · 15 min · /) } : added);
      await expect.poll(() => record(userData, id)?.status).toBe('placed');

      await page.keyboard.press('Meta+Z');
      expect(await model(page)).toEqual(before);
    } finally {
      await app.close();
    }
  });
}

test('keeping it in Sprints, or discarding it (which asks twice), leaves the book alone', async () => {
  const { app, page, userData } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    const before = await model(page);
    for (const choice of ['sprints', 'discard'] as const) {
      await page.keyboard.press('Meta+Shift+S');
      await page.keyboard.press('Enter');
      await page.keyboard.type(`A ${choice} sprint.`);
      const id = (await sprint(page)).record.id;
      await page.keyboard.press('Meta+Shift+D');
      await page.click(`.bt-keep-radio[data-value="${choice}"]`);
      await page.click('.bt-keep [data-action="done"]');
      if (choice === 'discard') {
        await expect(page.locator('.bt-keep [data-action="done"]')).toHaveText(/Discard for good/);
        expect(await mode(page)).toBe('sprinter'); // armed, not yet discarded
        await page.click('.bt-keep [data-action="done"]');
      }
      await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'false');
      expect(await mode(page)).toBe('manuscript');
      await expect.poll(() => record(userData, id)?.status).toBe(choice === 'sprints' ? 'kept' : 'discarded');
      expect(readFileSync(path.join(userData, 'Sprints', `${id}.md`), 'utf8')).toContain(`A ${choice} sprint.`); // the writing is kept either way (discarded: for 30 days)
    }
    expect(await model(page)).toEqual(before);
  } finally {
    await app.close();
  }
});

test('ending a sprint with nothing written just leaves', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await page.keyboard.press('Meta+Shift+S');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Meta+Shift+D');
    await expect.poll(() => mode(page)).toBe('manuscript');
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'false');
    expect(await page.$$eval('.bt-toast[data-kind="error"][data-visible="true"]', (e) => e.length)).toBe(0);
  } finally {
    await app.close();
  }
});

test('quitting mid-sprint loses nothing: the next launch opens in Manuscript and asks about it', async () => {
  const first = await launch({ file: { name: 'S.md', content: FILE } });
  const before = await model(first.page);
  try {
    await first.page.keyboard.press('Meta+Shift+S');
    await first.page.keyboard.press('Enter');
    await first.page.keyboard.type('Written just before the quit.');
  } finally {
    await first.app.close(); // no waiting for the save: quitting flushes it
  }
  const again = await launch({ reuse: first });
  try {
    await expect(again.page.locator('.bt-keep')).toHaveAttribute('data-open', 'true');
    await expect(again.page.locator('.bt-keep-words')).toHaveText('5 words');
    expect(await model(again.page)).toEqual(before);
    await again.page.keyboard.press('Escape'); // keep writing where it left off
    expect(await mode(again.page)).toBe('sprinter');
    expect((await sprint(again.page)).blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Written just before the quit.' }] }]);
  } finally {
    await again.app.close();
  }
});

test('the choices are remembered, across launches too; ⌘⇧D from Manuscript opens setup', async () => {
  const first = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await first.page.keyboard.press('Meta+Shift+D');
    await expect(setup(first.page)).toHaveAttribute('data-open', 'true');
    await first.page.click('[data-group="kind"][data-value="words"]');
    await first.page.click('[data-group="length"][data-value="1000"]');
    await first.page.click('[data-group="rounds"][data-value="2"]');
    await first.page.click('[data-action="start"]');
    expect(await mode(first.page)).toBe('sprinter');
    await first.page.keyboard.press('Meta+Shift+D'); // nothing written: just leaves
    await expect.poll(() => JSON.parse(readFileSync(path.join(first.userData, 'settings.json'), 'utf8')).sprint?.words).toBe(1000);
  } finally {
    await first.app.close();
  }
  const again = await launch({ reuse: first });
  try {
    expect(await mode(again.page)).toBe('manuscript'); // every launch starts in Manuscript
    await again.page.keyboard.press('Meta+Shift+S');
    expect(await checked(again.page, 'kind')).toBe('words');
    expect(await checked(again.page, 'length')).toBe('1000');
    expect(await checked(again.page, 'rounds')).toBe('2');
  } finally {
    await again.app.close();
  }
});

test('the View menu says which way the mode item goes', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    const labels = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find((i) => i.label === 'View')!.submenu!.items.map((i) => i.label));
    expect(await labels()).toContain('Switch to Sprinter…');
    await page.keyboard.press('Meta+Shift+S');
    await page.keyboard.press('Enter');
    await expect.poll(labels).toContain('End Sprint…');
    expect(await labels()).not.toContain('Switch to Sprinter…');
    await page.keyboard.press('Meta+Shift+D');
    await expect.poll(labels).toContain('Switch to Sprinter…');
  } finally {
    await app.close();
  }
});

const startSprint = async (page: Page, choose?: (page: Page) => Promise<void>) => {
  await page.keyboard.press('Meta+Shift+S');
  if (choose) await choose(page);
  await page.click('.bt-sprint-setup [data-action="start"]');
};
const finishNow = (page: Page) => page.evaluate(() => (window as any).__baretext.sprintFinishNow());
const line = (page: Page) => page.locator('.bt-sprint-line');

test('a sprint is focus mode on typewriter mode, with the timer line along the bottom edge', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await startSprint(page);
    await expect(page.locator('.bt-app')).toHaveAttribute('data-focus', 'true');
    // An even page to the window's edges: no vignette darkening the empty bars' corners.
    await expect.poll(() => page.$$eval('.bt-vignette', (els) => els.map((e) => getComputedStyle(e).opacity))).toEqual(['0', '0']);
    const pageColor = await page.$eval('.bt-sprint-page', (e) => getComputedStyle(e).backgroundColor);
    await expect.poll(() => page.$$eval(':is(.bt-chrome, .bt-status)', (els) => els.map((e) => getComputedStyle(e).backgroundColor))).toEqual([pageColor, pageColor]);
    await expect(page.locator('.bt-toast')).not.toHaveText(/leave focus/); // no focus-mode hint in a sprint
    await expect(line(page)).toHaveAttribute('data-phase', 'sprint');
    await expect.poll(() => line(page).evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    const box = (await line(page).boundingBox())!;
    const win = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    expect(box.y + box.height).toBe(win.h);
    expect(box.width).toBe(win.w);
    // One compositor animation for the whole sprint (15 minutes).
    expect(await page.$eval('.bt-sprint-line-bar', (e) => e.getAnimations().filter((a) => !(a instanceof CSSTransition)).map((a) => (a.effect as KeyframeEffect).getTiming().duration))).toEqual([15 * 60_000]);

    // Hide (⌘⇧H) and show; pause and resume from the palette.
    await page.keyboard.press('Meta+Shift+H');
    await expect.poll(() => line(page).evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
    await page.keyboard.press('Meta+Shift+H');
    await expect.poll(() => line(page).evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    await page.keyboard.press('Meta+K');
    await page.keyboard.type('pause timer');
    await page.keyboard.press('Enter');
    expect((await sprint(page)).paused).toBe(true);
    expect(await page.$eval('.bt-sprint-line-bar', (e) => e.getAnimations().find((a) => !(a instanceof CSSTransition))!.playState)).toBe('paused');

    // Leaving restores the window as it was.
    await page.keyboard.type('Words.');
    await page.keyboard.press('Meta+Shift+D');
    await page.click('.bt-keep-radio[data-value="discard"]');
    await page.click('.bt-keep [data-action="done"]');
    await page.click('.bt-keep [data-action="done"]');
    await expect.poll(() => mode(page)).toBe('manuscript');
    await expect(page.locator('.bt-app')).toHaveAttribute('data-focus', 'false');
    await expect(line(page)).toHaveAttribute('data-phase', 'idle');
  } finally {
    await app.close();
  }
});

test('when the time is up the line glows and the sprint asks where its writing goes', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await startSprint(page);
    await page.keyboard.type('Against the clock.');
    await finishNow(page);
    await expect(line(page)).toHaveAttribute('data-phase', 'done');
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'true');
  } finally {
    await app.close();
  }
});

test('rounds: a break between them (the line drains), a pause on the page, then the next round', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await startSprint(page, async (p) => { await p.click('[data-group="rounds"][data-value="2"]'); });
    await page.keyboard.type('Round one.');
    await finishNow(page);
    expect((await sprint(page)).phase).toBe('break');
    expect((await sprint(page)).blocks.map((b: any) => b.type)).toEqual(['paragraph', 'section_break']);
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'false');
    await finishNow(page);
    expect((await sprint(page)).phase).toBe('sprint');
    expect((await sprint(page)).round).toBe(2);
    await page.keyboard.type('Round two.');
    await finishNow(page);
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'true');
  } finally {
    await app.close();
  }
});

test('a words sprint: the line fills with the words, and reaching the target ends it', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await startSprint(page, async (p) => {
      await p.click('[data-group="kind"][data-value="words"]');
      await p.click('.bt-sprint-custom');
      await p.keyboard.type('10');
    });
    const scale = () => page.$eval('.bt-sprint-line-bar', (e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).a);
    await page.keyboard.type('one two three four five ');
    await expect.poll(scale).toBeCloseTo(0.5, 1);
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'false');
    await page.keyboard.type('six seven eight nine ten');
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'true');
    await expect(line(page)).toHaveAttribute('data-phase', 'done');
  } finally {
    await app.close();
  }
});

test('during a sprint, closing the palette returns the caret to the sprint page, never the hidden manuscript', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    const before = await model(page);
    await startSprint(page);
    for (const close of ['Escape', 'run'] as const) {
      await page.keyboard.press('Meta+K');
      if (close === 'Escape') await page.keyboard.press('Escape');
      else { await page.keyboard.type('hide timer'); await page.keyboard.press('Enter'); }
      await page.keyboard.type(`after ${close} `);
    }
    expect(await model(page)).toEqual(before);
    expect((await sprint(page)).blocks).toEqual([{ type: 'paragraph', content: [{ text: 'after Escape after run ' }] }]);
    // And underneath, the manuscript takes no typing while the sprint is open…
    expect(await page.$eval('[data-ref="page"] .ProseMirror', (e) => e.getAttribute('contenteditable'))).toBe('false');
    await page.keyboard.press('Meta+Shift+D');
    await page.click('.bt-keep-radio[data-value="sprints"]');
    await page.keyboard.press('Enter');
    await expect.poll(() => mode(page)).toBe('manuscript');
    // …and takes it again after.
    expect(await page.$eval('[data-ref="page"] .ProseMirror', (e) => e.getAttribute('contenteditable'))).toBe('true');
  } finally {
    await app.close();
  }
});

test('while the end panel is open the timer waits; Keep writing resumes it', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await startSprint(page, async (p) => { await p.click('[data-group="rounds"][data-value="2"]'); });
    await page.keyboard.type('Deciding.');
    await page.keyboard.press('Meta+Shift+D');
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'true');
    expect((await sprint(page)).paused).toBe(true);
    await page.keyboard.press('Escape');
    expect((await sprint(page)).paused).toBe(false);
    expect((await sprint(page)).phase).toBe('sprint');

    // A timer the writer paused stays paused through the panel.
    await page.keyboard.press('Meta+K');
    await page.keyboard.type('pause timer');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Meta+Shift+D');
    await page.keyboard.press('Escape');
    expect((await sprint(page)).paused).toBe(true);
  } finally {
    await app.close();
  }
});

// ── the Sprints library ──

/** Write a sprint and keep it in Sprints. */
const keepASprint = async (page: Page, text: string) => {
  await startSprint(page);
  await page.keyboard.type(text);
  await page.keyboard.press('Meta+Shift+D');
  await page.click('.bt-keep-radio[data-value="sprints"]');
  await page.keyboard.press('Enter');
  await expect.poll(() => mode(page)).toBe('manuscript');
};
const openLibrary = async (page: Page) => {
  await page.keyboard.press('Meta+K');
  await page.keyboard.type('Sprints…');
  await page.keyboard.press('Enter');
  await expect(page.locator('.bt-sprints')).toHaveAttribute('data-open', 'true');
};
const rows = (page: Page) => page.$$eval('.bt-sprints [role="option"] .bt-sprints-opening', (els) => els.map((e) => e.textContent));

test('the library lists kept sprints, newest first, and reads each in full', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await openLibrary(page);
    await expect(page.locator('.bt-sprints .bt-history-empty')).toHaveText('No sprints kept yet.');
    // The close button sits at the header's right edge.
    const head = (await page.locator('.bt-sprints .bt-history-head').boundingBox())!;
    const close = (await page.locator('.bt-sprints .bt-history-close').boundingBox())!;
    expect(head.x + head.width - (close.x + close.width)).toBeLessThanOrEqual(16);
    await page.keyboard.press('Escape');
    await expect(page.locator('.bt-sprints')).toHaveAttribute('data-open', 'false');

    await keepASprint(page, 'The first warm-up.');
    await startSprint(page);
    await page.keyboard.type('The second ');
    await page.keyboard.press('Meta+I');
    await page.keyboard.type('warm-up');
    await page.keyboard.press('Meta+I');
    await page.keyboard.type('.');
    await page.keyboard.press('Meta+Shift+D');
    await page.click('.bt-keep-radio[data-value="sprints"]');
    await page.keyboard.press('Enter');
    await expect.poll(() => mode(page)).toBe('manuscript');
    await openLibrary(page);
    await expect.poll(() => rows(page)).toEqual(['The second warm-up.', 'The first warm-up.']);
    await expect(page.locator('.bt-sprints .bt-history-preview-text')).toHaveText('The second warm-up.');
    await expect(page.locator('.bt-sprints .bt-history-preview-text em')).toHaveText('warm-up'); // read as written
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.bt-sprints .bt-history-preview-text')).toHaveText('The first warm-up.');
    await expect(page.locator('.bt-sprints .bt-history-vs')).toHaveText(/· 15 min$/);
  } finally {
    await app.close();
  }
});

test('from the library into the book: the same chooser (book choices only); Back returns to the library', async () => {
  const { app, page, userData } = await launch({ file: { name: 'S.md', content: FILE2 } });
  try {
    await keepASprint(page, 'Kept, then used.');
    const before = await model(page);
    await openLibrary(page);
    await expect(page.locator('.bt-sprints [data-action="place"]')).toBeEnabled();
    await page.keyboard.press('Enter'); // Add to book…
    await expect(page.locator('.bt-sprints')).toHaveAttribute('data-open', 'false');
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'true');
    await expect(page.locator('#bt-keep-title')).toHaveText('Add to book');
    expect(await page.$$eval('.bt-keep-option:not([hidden])', (els) => els.map((e) => (e as HTMLElement).dataset.value))).toEqual(['chapter', 'end', 'cold']);

    await page.keyboard.press('Escape'); // Back
    await expect(page.locator('.bt-sprints')).toHaveAttribute('data-open', 'true');
    await expect.poll(() => rows(page)).toEqual(['Kept, then used.']);

    await page.click('.bt-sprints [data-action="place"]');
    await page.click('.bt-keep-radio[data-value="end"]');
    await page.keyboard.press('Enter');
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'false');
    const after = await model(page);
    expect(after.chapters.at(-1).scenes.length).toBe(before.chapters.at(-1).scenes.length + 1);
    expect(after.chapters.at(-1).scenes.at(-1).blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Kept, then used.' }] }]);
    expect(await page.evaluate(() => (window as any).__baretext.hasFocus())).toBe(true);

    // It has left the library.
    const files = readdirSync(path.join(userData, 'Sprints')).filter((f) => f.endsWith('.json'));
    await expect.poll(() => files.map((f) => JSON.parse(readFileSync(path.join(userData, 'Sprints', f), 'utf8')).status)).toEqual(['placed']);
    await openLibrary(page);
    await expect(page.locator('.bt-sprints .bt-history-empty')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('discarding from the library asks twice; clicking elsewhere cancels it', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await keepASprint(page, 'Keep me.');
    await keepASprint(page, 'Let me go.');
    await openLibrary(page);
    const discard = page.locator('.bt-sprints [data-action="discard"]');
    await discard.click();
    await expect(discard).toHaveText('Discard for good');
    await page.click('.bt-sprints .bt-history-preview-text'); // elsewhere: cancelled
    await expect(discard).toHaveText('Discard');
    expect(await rows(page)).toHaveLength(2);

    await page.locator('.bt-sprints .bt-history-list').focus();
    await page.keyboard.press('Delete');
    await expect(discard).toHaveText('Discard for good');
    await page.keyboard.press('Delete');
    await expect.poll(() => rows(page)).toEqual(['Keep me.']);
    await expect(page.locator('.bt-sprints .bt-history-preview-text')).toHaveText('Keep me.');
  } finally {
    await app.close();
  }
});

test('the library is not there during a sprint', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await startSprint(page);
    await page.keyboard.press('Meta+K');
    await page.keyboard.type('Sprints');
    expect(await page.$$eval('.bt-palette [role="option"]', (els) => els.map((e) => e.textContent).filter((t) => t?.includes('Sprints…')))).toEqual([]);
    await page.keyboard.press('Escape');
    const item = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find((i) => i.label === 'View')!.submenu!.items.find((i) => i.label === 'Sprints…')!.enabled);
    expect(item).toBe(false);
  } finally {
    await app.close();
  }
});

test('the launch check for an unfinished sprint never takes over a sprint already under way', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE } });
  try {
    await startSprint(page);
    await page.keyboard.type('Started at once.');
    const id = (await sprint(page)).record.id;
    await page.evaluate(() => (window as any).__baretext.sprintFlush());
    // The check (normally at launch) runs late, after this sprint began.
    await page.evaluate(() => (window as any).__baretext.recoverSprint());
    const s = await sprint(page);
    expect(s.open).toBe(true);
    expect(s.record.id).toBe(id);
    expect(s.record.status).toBe('active');
    expect(s.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Started at once.' }] }]);
    await expect(page.locator('.bt-keep')).toHaveAttribute('data-open', 'false');
  } finally {
    await app.close();
  }
});

// ── any of the writer's manuscripts ──

/** A Baretext manuscript file outside the app's folders. */
const bookFile = (title: string, chapters: string[], name = `${title}.md`) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bt-book-'));
  const file = path.join(dir, name);
  writeFileSync(file, serialize({ title, coldStorage: [], chapters: chapters.map((t, i) => ({ id: `ch${i}x`, title: t, scenes: [{ id: `sc${i}x`, name: null, link: null, blocks: [{ type: 'paragraph' as const, content: [{ text: `${t} text.` }] }] }] })) }));
  return file;
};
const bookOptions = (page: Page) => page.$$eval('.bt-keep-book-select option', (os) => os.map((o) => o.textContent));
const chapterOptions = (page: Page) => page.$$eval('.bt-keep-chapter-select option', (os) => os.map((o) => o.textContent));

test('a sprint can go into any of the writer’s manuscripts: that book opens, and the scene lands there', async () => {
  const other = bookFile('The Other Book', ['Arrival', 'Departure']);
  const otherBefore = readFileSync(other, 'utf8');
  const { app, page, userData } = await launch({ file: { name: 'S.md', content: FILE2 }, settings: { recent: [other] } });
  try {
    const first = await page.evaluate(() => (window as any).__baretext.filePath());
    await startSprint(page);
    await page.keyboard.type('Meant for the other book.');
    const id = (await sprint(page)).record.id;
    await page.keyboard.press('Meta+Shift+D');
    // The open book first, then the recent ones, by title; then Other….
    await expect.poll(() => bookOptions(page)).toEqual(['Book', 'The Other Book', 'Other…']);
    expect(await chapterOptions(page)).toEqual(['1 · One', '2 · Two']);

    await page.selectOption('.bt-keep-book-select', other);
    await expect.poll(() => chapterOptions(page)).toEqual(['1 · Arrival', '2 · Departure']);
    await expect(page.locator('[data-detail="end"]')).toHaveText('2 · Departure');
    await page.selectOption('.bt-keep-chapter-select', '0');
    await page.click('.bt-keep [data-action="done"]');

    await expect.poll(() => page.evaluate(() => (window as any).__baretext.filePath())).toBe(other);
    await expect.poll(() => mode(page)).toBe('manuscript');
    const m = await model(page);
    expect(m.title).toBe('The Other Book');
    expect(m.chapters[0].scenes.at(-1).blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Meant for the other book.' }] }]);
    await expect.poll(() => record(userData, id)?.status).toBe('placed');
    // It saves like any edit; ⌘Z takes it back out.
    await page.evaluate(() => (window as any).__baretext.saveNow());
    expect(readFileSync(other, 'utf8')).toContain('Meant for the other book.');
    await page.keyboard.press('Meta+Z');
    expect((await model(page)).chapters[0].scenes).toHaveLength(1);
    // The first book was left as it was.
    expect(readFileSync(first, 'utf8')).not.toContain('Meant for the other book.');
    expect(otherBefore).not.toContain('Meant for the other book.');
  } finally {
    await app.close();
  }
});

test('books with the same title are told apart by file name; Sprints and Discard need no book', async () => {
  const twin = bookFile('Book', ['Elsewhere'], 'Book draft 2.md');
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE2 }, settings: { recent: [twin] } });
  try {
    await startSprint(page);
    await page.keyboard.type('Twins.');
    await page.keyboard.press('Meta+Shift+D');
    await expect.poll(() => bookOptions(page)).toEqual(['Book — S.md', 'Book — Book draft 2.md', 'Other…']);
    // The book picker runs to the same right edge as the chapter picker (measured together: the panel may still be scaling in).
    const [bookRight, chapterRight] = await page.evaluate(() => ['.bt-keep-book-select', '.bt-keep-chapter-select'].map((q) => document.querySelector(q)!.getBoundingClientRect().right));
    expect(bookRight).toBeCloseTo(chapterRight!, 1);
    await page.click('.bt-keep-radio[data-value="sprints"]');
    await expect(page.locator('.bt-keep-book')).toHaveAttribute('data-inactive', 'true');
    await page.click('.bt-keep-radio[data-value="cold"]');
    await expect(page.locator('.bt-keep-book')).toHaveAttribute('data-inactive', 'false');
  } finally {
    await app.close();
  }
});

test('a book finishing loading never takes the keyboard from an open panel', async () => {
  const { app, page } = await launch({ file: { name: 'S.md', content: FILE2 } });
  try {
    const before = await model(page);
    await page.keyboard.press('Meta+Shift+S');
    await expect(page.locator('.bt-sprint-setup')).toHaveAttribute('data-open', 'true');
    // A document arrives (as when one is opened) while setup is open.
    const doc = await page.evaluate(() => ({ filePath: (window as any).__baretext.filePath(), manuscript: (window as any).__baretext.model(), caret: null }));
    await app.evaluate(({ BrowserWindow }, d) => BrowserWindow.getAllWindows()[0]!.webContents.send('doc:opened', d), doc);
    await page.waitForTimeout(100); // past the load's deferred focus
    expect(await page.evaluate(() => !!document.activeElement?.closest('.bt-sprint-setup'))).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => mode(page)).toBe('sprinter');
    expect(await model(page)).toEqual(before);
  } finally {
    await app.close();
  }
});
