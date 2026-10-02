// Performance gate: a 150,000-word manuscript must open fast and type with
// imperceptible latency (typewriter on and off).
import { expect, test } from '@playwright/test';
import { serialize, type Manuscript } from '../../packages/format/src/index.ts';
import { launch, setAppearance } from '../e2e/launch.ts';

const WORDS = 'the quick brown fox jumps over a lazy dog while evening light fades slowly across quiet fields and distant hills'.split(' ');

function novel(targetWords: number): Manuscript {
  let words = 0;
  let id = 0;
  const chapters = [];
  while (words < targetWords) {
    const scenes = [];
    for (let s = 0; s < 5; s++) {
      const blocks = [];
      for (let p = 0; p < 20; p++) {
        const len = 40 + ((id * 7 + p * 13) % 30);
        const text = Array.from({ length: len }, (_, i) => WORDS[(i + p + s) % WORDS.length]).join(' ') + '.';
        blocks.push({ type: 'paragraph' as const, content: [{ text }] });
        words += len;
      }
      scenes.push({ id: `s${id++}`, name: s === 0 ? null : `Scene ${s + 1}`, link: null, blocks });
    }
    chapters.push({ id: `c${id++}`, title: `Chapter ${chapters.length + 1}`, scenes });
  }
  return { title: 'Big Book', chapters, coldStorage: [] };
}

async function measureTyping(page: import('@playwright/test').Page, keys: string[]) {
  await page.evaluate(() => {
    (window as any).__lat = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEventTiming[]) {
        if (e.name === 'keydown' || e.name === 'keypress' || e.name === 'input' || e.name === 'beforeinput') (window as any).__lat.push({ name: e.name, d: e.duration, p: e.processingEnd - e.processingStart });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
    (window as any).__proc = [];
  });
  // Script-side processing time per keystroke (dispatch → DOM updated → layout).
  await page.evaluate(() => {
    const page = document.querySelector('.ProseMirror')!;
    let t0 = 0;
    let key = '';
    if ((window as any).__benchInstalled) return;
    (window as any).__benchInstalled = true;
    window.addEventListener('keydown', (e) => { t0 = performance.now(); key = e.key; }, true);
    new MutationObserver(() => {
      if (!t0) return;
      const start = t0; t0 = 0;
      requestAnimationFrame(() => {
        document.querySelector('.bt-page')!.getBoundingClientRect();
        const ms = performance.now() - start;
        (window as any).__proc.push(ms);
        if (ms > 12) console.log(`slow key ${JSON.stringify(key)}: ${ms.toFixed(1)} ms`);
      });
    }).observe(page, { subtree: true, characterData: true, childList: true });
  });
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const proc: number[] = (window as any).__proc.sort((a: number, b: number) => a - b);
    const slow = (window as any).__lat as Array<{ name: string; d: number; p: number }>;
    return {
      samples: proc.length,
      p50: proc[Math.floor(proc.length * 0.5)],
      p95: proc[Math.floor(proc.length * 0.95)],
      max: proc[proc.length - 1],
      slowEvents: slow.length,
      worstEvent: slow.reduce((m, e) => Math.max(m, e.d), 0),
    };
  });
}

test('150k-word manuscript: open time and typing latency', async () => {
  const m = novel(150_000);
  const text = serialize(m);
  const t0 = Date.now();
  const { app, page } = await launch({ file: { name: 'Big.md', content: text } });
  page.on('console', (msg) => { if (msg.text().startsWith('slow key')) console.log('  ' + msg.text()); });
  const openMs = Date.now() - t0;
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 800));
    const info = await page.evaluate(() => {
      const model = (window as any).__baretext.model();
      let words = 0;
      for (const c of model.chapters) for (const s of c.scenes) for (const b of s.blocks) if (b.type === 'paragraph') for (const r of b.content) words += r.text.split(/\s+/).filter(Boolean).length;
      return { words, chapters: model.chapters.length, domNodes: document.querySelectorAll('*').length, bytes: 0 };
    });
    console.log(`manuscript: ${info.words} words, ${info.chapters} chapters, ${info.domNodes} DOM elements, file ${(text.length / 1024).toFixed(0)} KB`);
    console.log(`launch → editable (hidden, includes Electron startup): ${openMs} ms`);

    // Type in the middle of the book.
    const middle = m.chapters[Math.floor(m.chapters.length / 2)]!.scenes[2]!.id;
    await page.evaluate((id) => (window as any).__baretext.navigate(id), middle);
    const keys = [...'The platen advances, line by line, as she writes '.split('').map((c) => (c === ' ' ? 'Space' : c)), 'Enter', ...'another line'.split('').map((c) => (c === ' ' ? 'Space' : c))];

    const plain = await measureTyping(page, keys);
    console.log('typing, typewriter off:', plain);

    await page.keyboard.press('Meta+Shift+T');
    await page.waitForTimeout(300);
    const tw = await measureTyping(page, keys);
    console.log('typing, typewriter on:', tw);

    // The outline open beside the page (its counts refresh as you type).
    await page.keyboard.press('Meta+Shift+T');
    await page.keyboard.press('Meta+Backslash');
    await page.waitForTimeout(600);
    const outline = await measureTyping(page, keys);
    console.log('typing, outline open:', outline);

    // The heaviest page: serif, extra large, wide.
    await setAppearance(page, ['serif', 'xlarge', 'wide']);
    await page.waitForTimeout(300);
    const serif = await measureTyping(page, keys);
    console.log('typing, outline open + serif / extra large / wide:', serif);

    // Notes: 20 cards in the margin, re-placed as the text moves.
    await page.keyboard.press('Meta+Backslash'); // outline away: room for cards
    await setAppearance(page, ['mono', 'medium', 'narrow']);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1400, 800));
    for (let i = 0; i < 20; i++) {
      await page.evaluate((n) => {
        const b = (window as any).__baretext;
        b.selectText(['quick brown', 'lazy dog', 'evening light', 'quiet fields'][n % 4]);
      }, i);
      await page.keyboard.press('Meta+Shift+m');
      await page.keyboard.type(`Note ${i}`);
      await page.keyboard.press('Enter'); // saved
    }
    await page.evaluate((id) => (window as any).__baretext.navigate(id), middle);
    await page.waitForTimeout(300);
    const withNotes = await measureTyping(page, keys);
    console.log(`typing, 20 notes (${await page.locator('.bt-note-card').count()} cards):`, withNotes);
    expect(withNotes.p95).toBeLessThan(16);

    // Focus mode: the vignette and the dissolving edges over the page.
    await page.keyboard.press('Meta+.');
    await page.waitForTimeout(800);
    const focus = await measureTyping(page, keys);
    console.log('typing, focus mode (vignette + edge fade):', focus);
    expect(focus.p95).toBeLessThan(16);
    await page.keyboard.press('Meta+.');

    // Save must still verify and complete quickly.
    const s0 = Date.now();
    expect(await page.evaluate(() => (window as any).__baretext.saveNow())).toBe(true);
    console.log(`save (serialize + verify + atomic write): ${Date.now() - s0} ms`);

    expect(info.words).toBeGreaterThanOrEqual(150_000);
    expect(plain.p95).toBeLessThan(16);
    expect(tw.p95).toBeLessThan(16);
    expect(outline.p95).toBeLessThan(16);
    expect(serif.p95).toBeLessThan(16);
  } finally {
    await app.close();
  }
});
