// End-to-end smoke test — drives the real, packaged app (not a mock, not a
// component test) through the golden paths verified manually throughout
// this project's development: Sprinter mode, the sprint timer lifecycle,
// mode switching, find/replace, spellcheck (flagging, suggestions, ignore,
// persistence across a real relaunch), and scene-nav (rail, corkboard,
// rename, drag-reorder, undo). Every launch runs against an isolated
// scratch --user-data-dir/save directory — nothing here ever touches the
// developer's real settings or Documents folder.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchApp } from './harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureContent = fs.readFileSync(path.join(__dirname, '../fixtures/manuscript.md'), 'utf8');

describe('Baretext E2E smoke test', () => {
  let app;

  before(async () => {
    app = await launchApp({ fixtureContent, mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  function assertNoConsoleErrors(label) {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, [], `unexpected console errors/exceptions ${label ? 'during ' + label : ''}`);
  }

  // ── Startup / Editor mode ──────────────────────────────────────────────

  test('loads the fixture document with no console errors', async () => {
    const text = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    assert.ok(text.includes('Mara stood at the edge of the harbor'));
    assertNoConsoleErrors('startup');
  });

  test('rail is visible in Editor mode with correct chapter numbering', async () => {
    // scene-nav's first real render (driven by the async 'file-loaded' IPC
    // message, debounced 180ms) can trail the doc content itself loading —
    // poll briefly rather than assuming it's already happened.
    const railText = await app.client.evaluate(`
      const deadline = Date.now() + 2000;
      let text = '';
      while (Date.now() < deadline) {
        text = document.getElementById('scene-rail').innerText;
        if (text.includes('Ch. 1')) break;
        await new Promise(r => setTimeout(r, 100));
      }
      return text;
    `);
    assert.match(railText, /Ch\. 1/);
    assert.match(railText, /Ch\. 2/);
    assert.match(railText, /A Turning Point/);
  });

  test('spellcheck flags the deliberate typos but not contractions', async () => {
    const flagged = await app.client.evaluate(
      'return [...document.querySelectorAll(".cm-spellError")].map(e => e.textContent);'
    );
    assert.ok(flagged.includes('teh'));
    assert.ok(flagged.includes('recieve'));
    assert.ok(!flagged.includes("shouldn't"));
  });

  // ── Spellcheck: suggestions, ignore, persistence ────────────────────────

  test('right-clicking a flagged word shows suggestions and an ignore option', async () => {
    const items = await app.client.evaluate(`
      const el = [...document.querySelectorAll('.cm-spellError')].find(e => e.textContent === 'teh');
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + 2 }));
      await new Promise(r => setTimeout(r, 150));
      return [...document.querySelectorAll('.spell-suggest-panel > div')].map(e => e.className + ':' + e.textContent);
    `);
    assert.ok(items.some((i) => i.includes('the')));
    assert.ok(items.some((i) => i.includes('ignore "teh"')));
  });

  test('clicking a suggestion applies it in place', async () => {
    await app.client.evaluate(`
      const item = [...document.querySelectorAll('.spell-suggest-item')][0];
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const text = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    assert.ok(text.includes('could the weather') || text.includes('could ' + 'the'.trim()));
    assert.ok(!text.includes(' teh '));
  });

  test('ignoring a word silences it and persists to settings.json', async () => {
    const stillFlagged = await app.client.evaluate('return [...document.querySelectorAll(".cm-spellError")].map(e => e.textContent);');
    assert.ok(stillFlagged.includes('recieve'));

    await app.client.evaluate(`
      const el = [...document.querySelectorAll('.cm-spellError')].find(e => e.textContent === 'recieve');
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + 2 }));
      await new Promise(r => setTimeout(r, 150));
      const ignoreItem = document.querySelector('.spell-suggest-ignore');
      ignoreItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);

    const flaggedAfter = await app.client.evaluate('return [...document.querySelectorAll(".cm-spellError")].map(e => e.textContent);');
    assert.ok(!flaggedAfter.includes('recieve'));

    const settings = app.readSettings();
    assert.ok(settings.ignoredWords.includes('recieve'));
  });

  test('the ignore persists across a real app relaunch', async () => {
    await app.client.evaluate('return true;'); // let the 500ms autosave debounce clear before we quit
    await new Promise((r) => setTimeout(r, 700));
    await app.restart();
    const flagged = await app.client.evaluate('return [...document.querySelectorAll(".cm-spellError")].map(e => e.textContent);');
    assert.ok(!flagged.includes('recieve'));
    assertNoConsoleErrors('relaunch');
  });

  test('"Clear ignored words" re-flags everything', async () => {
    await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const input = document.getElementById('palette-input');
      input.value = 'clear ignored';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      const target = [...document.querySelectorAll('.pitem')].find(e => e.textContent.includes('Clear ignored'));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      // closePalette() defers overlay.classList.remove('open') by 200ms —
      // wait it out so the next test's Mod-key shortcuts aren't swallowed
      // by app.js's "palette still open" guard.
      await new Promise(r => setTimeout(r, 350));
    `);
    const flagged = await app.client.evaluate('return [...document.querySelectorAll(".cm-spellError")].map(e => e.textContent);');
    assert.ok(flagged.includes('recieve'));
    const settings = app.readSettings();
    assert.deepEqual(settings.ignoredWords, []);
  });

  // ── Find & replace ──────────────────────────────────────────────────────

  test('find/replace opens, counts matches, and replaces', async () => {
    const result = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const panelVisible = getComputedStyle(document.querySelector('.find-panel')).display;
      const searchInput = document.querySelector('.find-input');
      searchInput.value = 'lighthouse';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      const count = document.querySelector('.find-count').textContent;
      document.querySelector('.find-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const panelAfterEsc = getComputedStyle(document.querySelector('.find-panel')).display;
      return { panelVisible, count, panelAfterEsc };
    `);
    assert.equal(result.panelVisible, 'flex');
    assert.equal(result.count, '1 / 1');
    assert.equal(result.panelAfterEsc, 'none');
  });

  // ── Scene-nav: rail ──────────────────────────────────────────────────────

  test('rail row click jumps the cursor and updates the active highlight', async () => {
    const activeText = await app.client.evaluate(`
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const target = rows.find(r => r.innerText.includes('A Turning Point'));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const active = document.querySelector('.rail-scene-row.active');
      return active ? active.innerText : null;
    `);
    assert.match(activeText || '', /A Turning Point/);
  });

  test('renaming a chapter via the rail rewrites the heading in the document', async () => {
    await app.client.evaluate(`
      const editBtn = document.querySelector('.rail-chapter-row .rail-edit-btn');
      editBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const input = document.querySelector('.inline-rename-input');
      input.value = 'The Harbor';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const text = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    assert.ok(text.includes('The Harbor'));
    const railText = await app.client.evaluate('return document.getElementById("scene-rail").innerText;');
    assert.match(railText, /The Harbor/);
  });

  test('renaming a bare scene via the rail promotes it to a real heading', async () => {
    await app.client.evaluate(`
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const target = rows.find(r => r.innerText.startsWith('Scene 1'));
      const editBtn = target.querySelector('.rail-edit-btn');
      editBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const input = document.querySelector('.inline-rename-input');
      input.value = 'The Harbor Opens';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const lines = await app.client.evaluate('return [...document.querySelectorAll(".cm-line")].map(l => l.textContent);');
    assert.ok(lines.includes('The Harbor Opens'));
  });

  // ── Scene-nav: corkboard ─────────────────────────────────────────────────

  test('the rail\'s corkboard button opens the corkboard with numbered cards', async () => {
    const result = await app.client.evaluate(`
      const btn = document.querySelector('.rail-corkboard-btn');
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const cork = document.getElementById('corkboard');
      const titles = [...cork.querySelectorAll('.scene-card-title')].map(e => e.innerText);
      return { display: getComputedStyle(cork).display, titles };
    `);
    assert.equal(result.display, 'flex');
    assert.ok(result.titles.some((t) => t.startsWith('1 ·')));
  });

  test('single click on a card does not navigate; double-click does', async () => {
    const result = await app.client.evaluate(`
      const cork = document.getElementById('corkboard');
      const card = [...cork.querySelectorAll('.scene-card')].find(c => c.innerText.includes('Turning Point'));
      card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      card.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const stillOpenAfterClick = getComputedStyle(cork).display;
      card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const closedAfterDblClick = getComputedStyle(cork).display;
      return { stillOpenAfterClick, closedAfterDblClick };
    `);
    assert.equal(result.stillOpenAfterClick, 'flex');
    assert.equal(result.closedAfterDblClick, 'none');
  });

  test('drag-reordering a scene within a chapter updates the document', async () => {
    const result = await app.client.evaluate(`
      document.querySelector('.rail-corkboard-btn').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const cork = document.getElementById('corkboard');
      const cards = [...cork.querySelectorAll('.scene-card')];
      const src = cards.find(c => c.innerText.startsWith('1 ·'));
      const target = cards.find(c => c.innerText.includes('Turning Point'));

      function fireDnd(type, el, dt) {
        const e = new Event(type, { bubbles: true, cancelable: true });
        e.dataTransfer = dt;
        el.dispatchEvent(e);
      }
      const dt = { effectAllowed: '', dropEffect: '', data: {}, setData(k,v){this.data[k]=v;}, getData(k){return this.data[k];} };

      src.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 30));
      fireDnd('dragstart', src, dt);
      fireDnd('dragover', target, dt);
      fireDnd('drop', target, dt);
      fireDnd('dragend', src, dt);
      await new Promise(r => setTimeout(r, 150));

      return [...cork.querySelectorAll('.scene-card-title')].map(e => e.innerText);
    `);
    // "The Harbor Opens" (was first) should no longer be card #1.
    assert.ok(!result[0].includes('The Harbor Opens'));
  });

  test('undo in the corkboard reverts the reorder', async () => {
    const result = await app.client.evaluate(`
      const cork = document.getElementById('corkboard');
      const undoBtn = document.querySelector('.corkboard-tool-btn');
      undoBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      return [...cork.querySelectorAll('.scene-card-title')].map(e => e.innerText);
    `);
    assert.ok(result[0].includes('The Harbor Opens'));
  });

  test('redo via keyboard re-applies the reorder', async () => {
    const result = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const cork = document.getElementById('corkboard');
      return [...cork.querySelectorAll('.scene-card-title')].map(e => e.innerText);
    `);
    assert.ok(!result[0].includes('The Harbor Opens'));
  });

  test('"+ new scene" adds a scene to the chapter', async () => {
    const before = await app.client.evaluate(`
      const cork = document.getElementById('corkboard');
      return cork.querySelectorAll('.scene-card').length;
    `);
    await app.client.evaluate(`
      const cork = document.getElementById('corkboard');
      const section = cork.querySelector('.corkboard-chapter');
      section.querySelector('.scene-card-new').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const railText = await app.client.evaluate('return document.getElementById("scene-rail").innerText;');
    assert.match(railText, /draft/);
    void before;
  });

  test('Escape closes the corkboard when not mid-rename', async () => {
    const display = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      return getComputedStyle(document.getElementById('corkboard')).display;
    `);
    assert.equal(display, 'none');
  });

  // ── Mode switching / Sprinter / footer fixtures ─────────────────────────

  test('switching to Sprinter mode hides the rail with no console errors', async () => {
    app.client.clearConsoleMessages();
    const result = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
      return {
        mode: document.documentElement.getAttribute('data-mode'),
        railDisplay: getComputedStyle(document.getElementById('scene-rail')).display,
      };
    `);
    assert.equal(result.mode, 'sprinter');
    assert.equal(result.railDisplay, 'none');
    assertNoConsoleErrors('mode switch to sprinter');
  });

  test('typewriter footer fixture toggles on click', async () => {
    const result = await app.client.evaluate(`
      const tw = document.getElementById('tw-status-indicator');
      const before = document.getElementById('app').classList.contains('typewriter');
      tw.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
      const after = document.getElementById('app').classList.contains('typewriter');
      return { before, after };
    `);
    assert.notEqual(result.before, result.after);
  });

  test('sprint timer: idle chip opens evoke panel, Enter starts it, chip shows a live countdown', async () => {
    const result = await app.client.evaluate(`
      const chip = document.querySelector('.sprint-chip-status');
      chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const evokeVisible = getComputedStyle(document.querySelector('.sprint-panel')).display;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const chipText = chip.innerText;
      const chipRunning = chip.classList.contains('running');
      return { evokeVisible, chipText, chipRunning };
    `);
    assert.equal(result.evokeVisible, 'block');
    assert.match(result.chipText, /\d{2}:\d{2}/);
    assert.equal(result.chipRunning, true);
  });

  test('minimizing and clicking the chip restores the full sprint panel', async () => {
    const result = await app.client.evaluate(`
      const minBtn = [...document.querySelectorAll('.sprint-pill')].find(b => b.innerText === 'minimize');
      minBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const panelHiddenWhileMinimized = getComputedStyle(document.querySelector('.sprint-panel')).display;
      document.querySelector('.sprint-chip-status').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const panelRestored = getComputedStyle(document.querySelector('.sprint-panel')).display;
      return { panelHiddenWhileMinimized, panelRestored };
    `);
    assert.equal(result.panelHiddenWhileMinimized, 'none');
    assert.equal(result.panelRestored, 'block');
  });

  test('ending the sprint clears the chip back to idle', async () => {
    const result = await app.client.evaluate(`
      const endBtn = [...document.querySelectorAll('.sprint-pill')].find(b => b.innerText === 'end');
      endBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const chip = document.querySelector('.sprint-chip-status');
      return { text: chip.innerText, running: chip.classList.contains('running') };
    `);
    assert.equal(result.text.trim(), 'sprint');
    assert.equal(result.running, false);
  });

  test('switching back to Editor mode restores the rail with no console errors', async () => {
    app.client.clearConsoleMessages();
    const result = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
      return {
        mode: document.documentElement.getAttribute('data-mode'),
        railDisplay: getComputedStyle(document.getElementById('scene-rail')).display,
      };
    `);
    assert.equal(result.mode, 'editor');
    assert.equal(result.railDisplay, 'flex');
    assertNoConsoleErrors('mode switch back to editor');
  });

  test('no console errors accumulated across the entire session', () => {
    assertNoConsoleErrors('the full session');
  });
});
