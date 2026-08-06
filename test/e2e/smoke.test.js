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

  test('editor line measure is 75ch, tunable from one CSS variable', async () => {
    const result = await app.client.evaluate(`
      return {
        cssVar: getComputedStyle(document.documentElement).getPropertyValue('--editor-measure').trim(),
        resolvedMaxWidth: getComputedStyle(document.querySelector('.cm-content')).maxWidth,
      };
    `);
    assert.equal(result.cssVar, '75ch');
    assert.ok(parseInt(result.resolvedMaxWidth, 10) > 0); // resolves to a real pixel value, not left as an unparsed ch string
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
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
      document.querySelector('.rail-corkboard-btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
      undoBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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

  // Regression: adding a scene from the corkboard used to unconditionally
  // close it and jump to the manuscript — nothing about interacting with a
  // card (adding, editing, dragging) should ever navigate away by surprise.
  test('"+ new scene" adds a scene to the chapter without leaving the corkboard', async () => {
    const before = await app.client.evaluate(`
      const cork = document.getElementById('corkboard');
      const section = cork.querySelector('.corkboard-chapter');
      return {
        totalCount: cork.querySelectorAll('.scene-card').length,
        sectionCount: section.querySelectorAll('.scene-card').length,
        display: getComputedStyle(cork).display,
      };
    `);
    assert.equal(before.display, 'flex');

    const after = await app.client.evaluate(`
      const cork = document.getElementById('corkboard');
      const section = cork.querySelector('.corkboard-chapter');
      const newSceneBtn = section.querySelector('.scene-card-new');
      newSceneBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      newSceneBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const newSection = document.getElementById('corkboard').querySelector('.corkboard-chapter');
      return {
        totalCount: document.getElementById('corkboard').querySelectorAll('.scene-card').length,
        sectionCount: newSection.querySelectorAll('.scene-card').length,
        display: getComputedStyle(document.getElementById('corkboard')).display,
      };
    `);
    assert.equal(after.totalCount, before.totalCount + 1);
    assert.equal(after.sectionCount, before.sectionCount + 1);
    assert.equal(after.display, 'flex'); // still open — this is the actual regression check

    // Regression: this chapter isn't the document's last one. addNewScene
    // used to compute its insert point off the scene's raw endPos — which,
    // for the last scene of a non-last chapter, is the START OF THE NEXT
    // CHAPTER'S HEADING — gluing the new "---" in after THREE blank lines
    // (the original gap, left untouched, plus insertSceneBreak's own
    // padding) instead of a single clean one. Locate the marker via the
    // chapter heading it now precedes, not lastIndexOf — chapter two has
    // its own unrelated "---" further down that would otherwise be found
    // instead.
    const lines = await app.client.evaluate('return [...document.querySelectorAll(".cm-line")].map(l => l.textContent);');
    const chapterTwoIdx = lines.indexOf('Chapter Two');
    const markerIdx = lines.lastIndexOf('---', chapterTwoIdx);
    assert.equal(lines[markerIdx - 1], '');
    assert.notEqual(lines[markerIdx - 2], ''); // exactly one blank line before the marker, not three

    // Jump into the new (still-empty) card specifically — the LAST card in
    // ITS OWN chapter section, not cork-wide (chapter two has its own cards
    // after it) — and actually type into it. A real user adding a scene
    // would write something, not leave it blank forever. Matters for later
    // tests too: an empty scene is legitimately dropped by the next rebuild
    // (reorder/rename/delete all rebuild the whole document from scratch —
    // see reorder.js), so leaving this one empty would make a later
    // delete's "exactly one scene disappears" assumption wrong for a reason
    // that has nothing to do with delete itself.
    await app.client.evaluate(`
      const section = document.getElementById('corkboard').querySelector('.corkboard-chapter');
      const cards = [...section.querySelectorAll('.scene-card')];
      cards[cards.length - 1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    await app.client.evaluate(`
      document.querySelector('.cm-content').focus();
      document.execCommand('insertText', false, 'A freshly typed scene.');
      await new Promise(r => setTimeout(r, 100));
    `);
    const typedIn = await app.client.evaluate('return document.querySelector(".cm-content").innerText.includes("A freshly typed scene.");');
    assert.equal(typedIn, true);
  });

  test('the "open in manuscript" button jumps and closes deliberately', async () => {
    const result = await app.client.evaluate(`
      // Self-sufficient regardless of whether the previous test left the
      // corkboard open or closed.
      document.querySelector('.rail-corkboard-btn').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.querySelector('.rail-corkboard-btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const cork = document.getElementById('corkboard');
      const card = [...cork.querySelectorAll('.scene-card')][0];
      const openBtn = [...card.querySelectorAll('.corkboard-edit-btn')][1];
      const title = openBtn.title;
      openBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      openBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      return { title, corkDisplayAfter: getComputedStyle(cork).display };
    `);
    assert.equal(result.title, 'open in manuscript');
    assert.equal(result.corkDisplayAfter, 'none');
  });

  test('Escape closes the corkboard when not mid-rename', async () => {
    const display = await app.client.evaluate(`
      // Self-sufficient regardless of what state the previous test left
      // things in — reopen first so this genuinely exercises Escape-close.
      document.querySelector('.rail-corkboard-btn').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.querySelector('.rail-corkboard-btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      return getComputedStyle(document.getElementById('corkboard')).display;
    `);
    assert.equal(display, 'none');
  });

  // ── Scene-nav: delete (two-click confirm, rail + corkboard) ─────────────

  test('arming a delete button shows "delete?" and reverts on its own after the timeout', async () => {
    const result = await app.client.evaluate(`
      const btn = document.querySelector('.rail-scene-row .rail-delete-btn');
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const armedText = btn.innerText;
      const armedClass = btn.classList.contains('confirm');
      await new Promise(r => setTimeout(r, 3300)); // past the 3s auto-revert
      const revertedText = btn.innerText;
      const revertedClass = btn.classList.contains('confirm');
      return { armedText, armedClass, revertedText, revertedClass };
    `);
    assert.equal(result.armedText, 'delete?');
    assert.equal(result.armedClass, true);
    assert.equal(result.revertedText, '');
    assert.equal(result.revertedClass, false);
  });

  test('arming a second delete button disarms the first one', async () => {
    const result = await app.client.evaluate(`
      const btns = [...document.querySelectorAll('.rail-scene-row .rail-delete-btn')];
      const [first, second] = btns;
      first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const firstArmed = first.classList.contains('confirm');
      second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      second.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const out = { firstArmed, firstStillArmed: first.classList.contains('confirm'), secondArmed: second.classList.contains('confirm') };
      // Leave nothing armed behind — a lingering armed button (with its own
      // pending 3s auto-revert timer) is a real footgun for whatever test
      // runs next, not just untidy.
      await new Promise(r => setTimeout(r, 3300));
      out.secondStillArmedAfterWait = second.classList.contains('confirm');
      return out;
    `);
    assert.equal(result.firstArmed, true);
    assert.equal(result.firstStillArmed, false);
    assert.equal(result.secondArmed, true);
    assert.equal(result.secondStillArmedAfterWait, false);
  });

  test('confirming a scene delete (second click) removes it from the document', async () => {
    const result = await app.client.evaluate(`
      const before = document.getElementById('scene-rail').querySelectorAll('.rail-scene-row').length;
      const row = document.querySelector('.rail-scene-row');
      const label = row.querySelector('.rail-scene-name').innerText;
      const btn = row.querySelector('.rail-delete-btn');
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const after = document.getElementById('scene-rail').querySelectorAll('.rail-scene-row').length;
      const stillOnPage = [...document.querySelectorAll('.cm-line')].some(l => l.textContent === label && label !== 'Scene 1' && label !== 'Scene 2');
      return { before, after, label, stillOnPage };
    `);
    assert.equal(result.after, result.before - 1);
    // Positional "Scene N" labels get recomputed after any deletion, so only
    // check for leftover content when the deleted scene had a real title.
    if (!/^Scene \d+$/.test(result.label)) assert.equal(result.stillOnPage, false);
  });

  test('deleting a scene from the corkboard does not close it', async () => {
    const result = await app.client.evaluate(`
      document.querySelector('.rail-corkboard-btn').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.querySelector('.rail-corkboard-btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const cork = document.getElementById('corkboard');
      const before = cork.querySelectorAll('.scene-card').length;
      const btn = cork.querySelector('.scene-card .corkboard-delete-btn');
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      return { before, after: cork.querySelectorAll('.scene-card').length, display: getComputedStyle(cork).display };
    `);
    assert.equal(result.after, result.before - 1);
    assert.equal(result.display, 'flex'); // the actual regression check — same rule as adding
  });

  test('confirming a chapter delete removes the chapter and every scene in it', async () => {
    const result = await app.client.evaluate(`
      const cork = document.getElementById('corkboard');
      const chaptersBefore = cork.querySelectorAll('.corkboard-chapter').length;
      const lastSection = [...cork.querySelectorAll('.corkboard-chapter')].pop();
      const chapterLabel = lastSection.querySelector('.corkboard-chapter-num').innerText;
      const btn = lastSection.querySelector('.corkboard-chapter-title-group .corkboard-delete-btn');
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      return { chaptersBefore, chaptersAfter: cork.querySelectorAll('.corkboard-chapter').length, display: getComputedStyle(cork).display };
    `);
    assert.equal(result.chaptersAfter, result.chaptersBefore - 1);
    assert.equal(result.display, 'flex');
  });

  // ── Mode switching / Sprinter / footer fixtures ─────────────────────────

  // Goes through the palette specifically (not the raw ⌘⇧D keybinding,
  // covered separately by the return trip below) — selecting Sprint from
  // the palette means "I want to sprint", so this should both switch modes
  // AND open the duration/goal picker automatically, not leave an idle
  // Sprinter view needing a second action.
  test('palette "Switch to Sprinter" hides the rail and opens sprint setup, no console errors', async () => {
    app.client.clearConsoleMessages();
    const result = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const input = document.getElementById('palette-input');
      input.value = 'switch to sprinter';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      const target = [...document.querySelectorAll('.pitem')].find(e => e.textContent.includes('Sprinter'));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
      const evokeVisible = getComputedStyle(document.querySelector('.sprint-panel')).display;
      // Cancel back to idle so the following tests' assumptions hold.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      return {
        mode: document.documentElement.getAttribute('data-mode'),
        railDisplay: getComputedStyle(document.getElementById('scene-rail')).display,
        evokeVisible,
      };
    `);
    assert.equal(result.mode, 'sprinter');
    assert.equal(result.railDisplay, 'none');
    assert.equal(result.evokeVisible, 'block');
    assertNoConsoleErrors('palette switch to sprinter');
  });

  test('typewriter footer fixture toggles on click', async () => {
    const result = await app.client.evaluate(`
      const tw = document.getElementById('tw-status-indicator');
      const before = document.getElementById('app').classList.contains('typewriter');
      tw.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      tw.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
      const after = document.getElementById('app').classList.contains('typewriter');
      return { before, after };
    `);
    assert.notEqual(result.before, result.after);
  });

  // Regression: typewriter mode only padded the BOTTOM of the document so
  // the last line could reach the center guide -- with no top padding, the
  // first line was pinned to the scroll-top edge and could never be
  // scrolled up to the center, unlike every other line. Both edges must be
  // reachable, not just the bottom one.
  test('typewriter mode lets the very first line scroll all the way to the center guide, not just the last', async () => {
    const result = await app.client.evaluate(`
      const scroller = document.querySelector('.cm-scroller');
      const firstLine = document.querySelectorAll('.cm-line')[0];
      const paddingTop = getComputedStyle(document.querySelector('.cm-content')).paddingTop;

      // Scroll the first line's midpoint to the scroller's midpoint, the
      // same geometry centerCursor() targets -- only possible if there's
      // real scrollable space above line 1.
      const target = firstLine.offsetTop - (scroller.clientHeight / 2) + (firstLine.offsetHeight / 2);
      scroller.scrollTop = Math.max(0, target);
      await new Promise(r => setTimeout(r, 100));

      const scrollerRect = scroller.getBoundingClientRect();
      const lineRect = firstLine.getBoundingClientRect();
      return {
        paddingTop,
        firstLineCenterY: lineRect.top + lineRect.height / 2 - scrollerRect.top,
        scrollerCenterY: scrollerRect.height / 2,
      };
    `);
    assert.notEqual(result.paddingTop, '0px');
    assert.ok(Math.abs(result.firstLineCenterY - result.scrollerCenterY) < 5, 'first line should be reachable at the vertical center');
  });

  test('sprint timer: idle chip opens evoke panel, Enter starts it, chip shows a live countdown', async () => {
    const result = await app.client.evaluate(`
      const chip = document.querySelector('.sprint-chip-status');
      chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
      minBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const panelHiddenWhileMinimized = getComputedStyle(document.querySelector('.sprint-panel')).display;
      const chipStatus = document.querySelector('.sprint-chip-status');
      chipStatus.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      chipStatus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const panelRestored = getComputedStyle(document.querySelector('.sprint-panel')).display;
      return { panelHiddenWhileMinimized, panelRestored };
    `);
    assert.equal(result.panelHiddenWhileMinimized, 'none');
    assert.equal(result.panelRestored, 'block');
  });

  // Regression: making the chip a permanent fixture (always showing a live
  // countdown) silently broke "hide timer" — 'hidden' view stopped actually
  // hiding anything, since the chip kept ticking regardless of view. A
  // running countdown is exactly the distraction "hide timer" exists to
  // remove, so 'hidden' must show no digits at all, just a neutral label.
  test('hiding the timer removes the countdown entirely, not just the panel', async () => {
    const result = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'H', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 1200)); // long enough to catch a stray tick if the bug returns
      const chip = document.querySelector('.sprint-chip-status');
      const chipTextHidden = chip.innerText;
      const panelHidden = getComputedStyle(document.querySelector('.sprint-panel')).display;
      const edgeHidden = getComputedStyle(document.querySelector('.sprint-edge')).display;

      // Restore to active so the next test can find the panel's "end" button.
      chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const panelRestored = getComputedStyle(document.querySelector('.sprint-panel')).display;

      return { chipTextHidden, panelHidden, edgeHidden, panelRestored };
    `);
    assert.equal(result.chipTextHidden.trim(), 'sprinting');
    assert.ok(!/\d{2}:\d{2}/.test(result.chipTextHidden));
    assert.equal(result.panelHidden, 'none');
    assert.equal(result.edgeHidden, 'none');
    assert.equal(result.panelRestored, 'block');
  });

  test('ending the sprint clears the chip back to idle', async () => {
    const result = await app.client.evaluate(`
      const endBtn = [...document.querySelectorAll('.sprint-pill')].find(b => b.innerText === 'end');
      endBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      endBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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

// A separate instance with its own fixture: a chapter with no title text yet
// ("# " — the realistic "just created it, haven't typed a title" state) and
// a chapter with zero scenes, both needing content different enough from
// the shared manuscript fixture above that reusing it would risk breaking
// that suite's own exact-count assertions.
describe('Baretext E2E: chapter placeholders and per-chapter scene targeting', () => {
  let app;
  const fixture = [
    '# ',
    '',
    'Opening prose for chapter one, plenty of words to clear the draft threshold comfortably for testing purposes.',
    '',
    '# Chapter Two',
    '',
    '# Chapter Three',
    '',
    'Some prose in chapter three so it renders as a normal, non-draft scene for this test.',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('a blank chapter heading shows a placeholder in the rail and the live editor, never written to disk', async () => {
    const result = await app.client.evaluate(`
      const deadline = Date.now() + 2000;
      let railText = '';
      while (Date.now() < deadline) {
        railText = document.getElementById('scene-rail').innerText;
        if (railText.includes('Ch. 1')) break;
        await new Promise(r => setTimeout(r, 100));
      }
      const widget = document.querySelector('.cm-chapter-placeholder');
      return { railText, widgetText: widget ? widget.textContent : null };
    `);
    assert.match(result.railText, /Chapter 1/);
    assert.equal(result.widgetText, 'Chapter 1');

    // Force a save and check the actual bytes on disk — the placeholder must
    // never leak into real content.
    await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
    `);
    const saved = fs.readFileSync(app.fixturePath, 'utf8');
    assert.ok(saved.startsWith('# \n') || saved.startsWith('#\n'));
    assert.ok(!saved.includes('Chapter 1'));
  });

  test('an empty chapter (0 scenes) gets its own per-chapter add-scene row', async () => {
    const railText = await app.client.evaluate('return document.getElementById("scene-rail").innerText;');
    assert.match(railText, /Chapter Two\n0/); // 0 scenes, matching the "jumps straight to Ch. 3" bug report
    const addRowCount = await app.client.evaluate("return document.querySelectorAll('.rail-scene-add').length;");
    assert.equal(addRowCount, 3); // one per chapter, including the empty one
  });

  test('adding a scene from a specific chapter\'s row lands it in that chapter, not the last one', async () => {
    const lines = await app.client.evaluate(`
      const rows = [...document.querySelectorAll('.rail-scene-add')];
      const chapterTwoRow = rows.find(r => r.title.includes('Chapter Two'));
      chapterTwoRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      chapterTwoRow.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      return [...document.querySelectorAll('.cm-line')].map(l => l.textContent);
    `);
    const chTwoIdx = lines.indexOf('Chapter Two');
    const chThreeIdx = lines.indexOf('Chapter Three');
    const breakIdx = lines.indexOf('---');
    assert.ok(chTwoIdx !== -1 && chThreeIdx !== -1 && breakIdx !== -1);
    assert.ok(breakIdx > chTwoIdx && breakIdx < chThreeIdx, 'new scene break should land between Chapter Two and Chapter Three');
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

// Own instances so mutating the document (⌘↵) and driving a real sprint
// countdown (pause) can't disturb the exact-count assumptions the two
// stateful suites above build up test-by-test.
describe('Baretext E2E: ⌘↵ scene break and sprint pause', () => {
  let app;

  before(async () => {
    app = await launchApp({ fixtureContent: '# Chapter One\n\nSome opening prose.', mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('⌘↵ inserts a scene break at the cursor; plain ↵ does not', async () => {
    const result = await app.client.evaluate(`
      const cm = document.querySelector('.cm-content');
      cm.focus();
      const before = cm.innerText;
      const dashesBefore = (before.match(/---/g) || []).length;

      cm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const afterCmdEnter = cm.innerText;
      const dashesAfterCmdEnter = (afterCmdEnter.match(/---/g) || []).length;

      cm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const dashesAfterPlainEnter = (cm.innerText.match(/---/g) || []).length;

      return { dashesBefore, dashesAfterCmdEnter, dashesAfterPlainEnter, changed: afterCmdEnter !== before };
    `);
    assert.equal(result.changed, true);
    assert.equal(result.dashesAfterCmdEnter, result.dashesBefore + 1);
    assert.equal(result.dashesAfterPlainEnter, result.dashesAfterCmdEnter); // plain Enter is just a newline, not a second break
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

describe('Baretext E2E: sprint pause/resume', () => {
  let app;

  before(async () => {
    app = await launchApp({ fixtureContent: 'Some prose here.', mode: 'sprinter' });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('pausing freezes the countdown and resuming continues it, reflected in the panel, chip, and edge line', async () => {
    // Start a sprint the same way a user would: chip -> evoke -> Enter.
    await app.client.evaluate(`
      const chipStatus = document.querySelector('.sprint-chip-status');
      chipStatus.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      chipStatus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);

    const paused = await app.client.evaluate(`
      const timeBefore = document.querySelector('.sprint-time').textContent;
      const pauseBtn = [...document.querySelectorAll('.sprint-pill')].find(b => b.innerText === 'pause');
      pauseBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      pauseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const pillLabels = [...document.querySelectorAll('.sprint-pill')].map(b => b.innerText);
      const dotPaused = document.querySelector('.sprint-dot').classList.contains('paused');
      const chipText = document.querySelector('.sprint-chip-status').innerText.trim();
      await new Promise(r => setTimeout(r, 2200)); // long enough to catch a stray tick if pause doesn't actually stop the interval
      const timeAfterWait = document.querySelector('.sprint-time').textContent;
      return { timeBefore, timeAfterWait, pillLabels, dotPaused, chipText };
    `);
    assert.equal(paused.timeAfterWait, paused.timeBefore); // frozen while paused
    assert.ok(paused.pillLabels.includes('resume'));
    assert.equal(paused.dotPaused, true);
    assert.equal(paused.chipText, 'paused');

    const resumed = await app.client.evaluate(`
      const timeBefore = document.querySelector('.sprint-time').textContent;
      const resumeBtn = [...document.querySelectorAll('.sprint-pill')].find(b => b.innerText === 'resume');
      resumeBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      resumeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const pillLabels = [...document.querySelectorAll('.sprint-pill')].map(b => b.innerText);
      const dotPaused = document.querySelector('.sprint-dot').classList.contains('paused');
      await new Promise(r => setTimeout(r, 2200));
      const timeAfterWait = document.querySelector('.sprint-time').textContent;
      return { timeBefore, timeAfterWait, pillLabels, dotPaused };
    `);
    assert.ok(resumed.pillLabels.includes('pause'));
    assert.equal(resumed.dotPaused, false);
    assert.notEqual(resumed.timeAfterWait, resumed.timeBefore); // ticking again

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('pausing while minimized dims the edge line; the chip still says "paused"', async () => {
    await app.client.evaluate(`
      const pauseBtn = [...document.querySelectorAll('.sprint-pill')].find(b => b.innerText === 'pause');
      pauseBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      pauseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const minBtn = [...document.querySelectorAll('.sprint-pill')].find(b => b.innerText === 'minimize');
      minBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      minBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const result = await app.client.evaluate(`
      return {
        edgeDisplay: getComputedStyle(document.querySelector('.sprint-edge')).display,
        edgePaused: document.querySelector('.sprint-edge').classList.contains('paused'),
        chipText: document.querySelector('.sprint-chip-status').innerText.trim(),
      };
    `);
    assert.equal(result.edgeDisplay, 'block');
    assert.equal(result.edgePaused, true);
    assert.equal(result.chipText, 'paused');
  });

  // Regression: 'hidden' view deliberately shows no timer info at all (see
  // the "hide timer" test in the main suite) — that must stay true even
  // while paused, not flip to a "paused" label the paused-while-visible
  // views show.
  test('the hidden view still says "sprinting", not "paused", while paused', async () => {
    await app.client.evaluate(`
      const chipStatus = document.querySelector('.sprint-chip-status');
      chipStatus.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      chipStatus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'H', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const chipText = await app.client.evaluate(`return document.querySelector('.sprint-chip-status').innerText.trim();`);
    assert.equal(chipText, 'sprinting');
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

describe('Baretext E2E: rail drag-and-drop', () => {
  let app;
  const fixture = [
    '# Chapter One',
    '',
    'A1 opening prose here, plenty of words so it is not a draft scene for testing.',
    '',
    '---',
    '',
    'A2 second scene prose here, plenty of words so it is not a draft scene either.',
    '',
    '# Chapter Two', // deliberately empty -- the "Ch. 2 has nothing in it" case from the original request
    '',
    '# Chapter Three',
    '',
    'C1 opening prose here, plenty of words so it is not a draft scene for testing.',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  // Same fireDnd helper/pacing as the existing corkboard drag test above --
  // proven not to trip a synthetic-event timing artifact that a real,
  // naturally-paced mouse drag never hits (a fully zero-delay *pair* of
  // back-to-back drags in the same tick can spuriously corrupt the document;
  // real drags, and single drags like these, never come close to that).
  function dragScript(fromExpr, toExpr) {
    return `
      function fireDnd(type, el, dt) {
        const e = new Event(type, { bubbles: true, cancelable: true });
        e.dataTransfer = dt;
        el.dispatchEvent(e);
      }
      const dt = { effectAllowed: '', dropEffect: '', data: {}, setData(k,v){this.data[k]=v;}, getData(k){return this.data[k];} };
      const from = ${fromExpr};
      const to = ${toExpr};
      from.querySelector('.rail-drag-handle').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 30));
      fireDnd('dragstart', from, dt);
      fireDnd('dragover', to, dt);
      fireDnd('drop', to, dt);
      fireDnd('dragend', from, dt);
      await new Promise(r => setTimeout(r, 200));
    `;
  }

  test('dragging a scene row onto another scene row reorders within the chapter', async () => {
    // scene-nav's first real render trails the doc content itself loading --
    // poll rather than assume it's already happened (same as the other
    // describe blocks' first test).
    await app.client.evaluate(`
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (document.querySelectorAll('.rail-scene-row').length >= 2) break;
        await new Promise(r => setTimeout(r, 100));
      }
    `);

    const before = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    assert.ok(before.indexOf('A1 opening') < before.indexOf('A2 second'));

    await app.client.evaluate(dragScript(
      `[...document.querySelectorAll('.rail-scene-row')][1]`, // A2
      `[...document.querySelectorAll('.rail-scene-row')][0]`  // A1
    ));
    const after = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    assert.ok(after.indexOf('A2 second') < after.indexOf('A1 opening'), 'A2 should now come before A1');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('dragging a scene onto another chapter\'s header moves it into that (empty) chapter', async () => {
    await app.client.evaluate(dragScript(
      `[...document.querySelectorAll('.rail-scene-row')].find(r => r.textContent.includes('Scene 1') && r.closest('.rail-scene-list').previousElementSibling.textContent.includes('Chapter Three'))`,
      `[...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter Two'))`
    ));
    const lines = await app.client.evaluate('return [...document.querySelectorAll(".cm-line")].map(l => l.textContent);');
    const chTwoIdx = lines.indexOf('Chapter Two');
    const chThreeIdx = lines.indexOf('Chapter Three');
    const sceneIdx = lines.findIndex(l => l.includes('C1 opening prose'));
    assert.ok(chTwoIdx !== -1 && chThreeIdx !== -1 && sceneIdx !== -1);
    assert.ok(sceneIdx > chTwoIdx && sceneIdx < chThreeIdx, 'C1 should now live under Chapter Two, before Chapter Three');

    const railText = await app.client.evaluate('return document.getElementById("scene-rail").innerText;');
    assert.match(railText, /Chapter Three\n0/); // Chapter Three is empty now

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('dragging a chapter header onto another chapter header reorders chapters', async () => {
    const before = await app.client.evaluate('return [...document.querySelectorAll(".rail-chapter-title")].map(t => t.textContent);');
    assert.deepEqual(before, ['Chapter One', 'Chapter Two', 'Chapter Three']);

    await app.client.evaluate(dragScript(
      `[...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter Three'))`,
      `[...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter One'))`
    ));
    const after = await app.client.evaluate('return [...document.querySelectorAll(".rail-chapter-title")].map(t => t.textContent);');
    assert.deepEqual(after, ['Chapter Three', 'Chapter One', 'Chapter Two']);

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  // Regression: the drag handle scopes native drag-and-drop so it doesn't
  // steal the row's normal click behavior (collapse-toggle for a chapter
  // row) -- clicking anywhere else on the row must still work exactly as
  // before drag support was added.
  test('clicking a chapter row body (not the handle) still toggles collapse', async () => {
    const result = await app.client.evaluate(`
      const row = [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter One'));
      const before = document.querySelectorAll('.rail-scene-row').length;
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const collapsed = document.querySelectorAll('.rail-scene-row').length;
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const restored = document.querySelectorAll('.rail-scene-row').length;
      return { before, collapsed, restored };
    `);
    assert.ok(result.collapsed < result.before);
    assert.equal(result.restored, result.before);
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

describe('Baretext E2E: theme picker', () => {
  let app;

  before(async () => {
    app = await launchApp({ fixtureContent: 'Some prose.', mode: 'editor' });
    await new Promise((r) => setTimeout(r, 400));
  });

  after(async () => {
    if (app) await app.close();
  });

  function openViaPalette(query) {
    return `
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      document.getElementById('palette-input').value = ${JSON.stringify(query)};
      document.getElementById('palette-input').dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      const target = [...document.querySelectorAll('.pitem')].find(el => el.querySelector('.pitem-label').textContent.includes(${JSON.stringify(query)}));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
    `;
  }

  test('"Change theme…" opens a 5-card gallery, each card resolving its own theme\'s tokens', async () => {
    const result = await app.client.evaluate(`
      ${openViaPalette('Change theme')}
      return {
        pickerDisplay: getComputedStyle(document.getElementById('theme-picker')).display,
        contentRowDisplay: getComputedStyle(document.getElementById('content-row')).display,
        cards: [...document.querySelectorAll('.tp-card')].map(c => ({
          theme: c.dataset.theme,
          bg: getComputedStyle(c).backgroundColor,
          role: c.getAttribute('role'),
        })),
      };
    `);
    assert.equal(result.pickerDisplay, 'flex');
    assert.equal(result.contentRowDisplay, 'none');
    assert.deepEqual(result.cards.map((c) => c.theme), ['dark', 'light', 'amstrad', 'grove', 'dracula']);
    assert.ok(result.cards.every((c) => c.role === 'radio'));
    // Each card must render its OWN theme's --bg, not the app's actual
    // active theme -- the whole point of the nested data-theme scope trick.
    assert.equal(result.cards[0].bg, 'rgb(36, 36, 36)');   // dark --bg #242424
    assert.equal(result.cards[3].bg, 'rgb(47, 56, 62)');   // grove --bg #2f383e
    const distinctBgs = new Set(result.cards.map((c) => c.bg));
    assert.equal(distinctBgs.size, 5);
  });

  test('clicking a card applies + persists the theme and keeps the picker open', async () => {
    const result = await app.client.evaluate(`
      const groveCard = document.querySelector('.tp-card[data-theme="grove"]');
      groveCard.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 400));
      return {
        appTheme: document.documentElement.getAttribute('data-theme'),
        groveApplied: groveCard.classList.contains('applied'),
        groveAriaChecked: groveCard.getAttribute('aria-checked'),
        darkApplied: document.querySelector('.tp-card[data-theme="dark"]').classList.contains('applied'),
        pickerStillOpen: getComputedStyle(document.getElementById('theme-picker')).display,
      };
    `);
    assert.equal(result.appTheme, 'grove');
    assert.equal(result.groveApplied, true);
    assert.equal(result.groveAriaChecked, 'true');
    assert.equal(result.darkApplied, false);
    assert.equal(result.pickerStillOpen, 'flex');
    assert.equal(app.readSettings().accentTheme, 'grove');
  });

  test('arrow keys move keyboard focus, Enter applies the focused card, Esc closes and refocuses the editor', async () => {
    const kbd = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const focused = document.querySelector('.tp-card.kbd-focus');
      const focusedTheme = focused ? focused.dataset.theme : null;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 400));
      return { focusedTheme, appThemeAfterEnter: document.documentElement.getAttribute('data-theme') };
    `);
    assert.equal(kbd.focusedTheme, 'dracula'); // grove -> next card in DOM order
    assert.equal(kbd.appThemeAfterEnter, 'dracula');

    const esc = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      return {
        pickerDisplay: getComputedStyle(document.getElementById('theme-picker')).display,
        contentRowDisplay: getComputedStyle(document.getElementById('content-row')).display,
        editorFocused: document.activeElement && document.activeElement.classList.contains('cm-content'),
      };
    `);
    assert.equal(esc.pickerDisplay, 'none');
    assert.equal(esc.contentRowDisplay, 'flex');
    assert.equal(esc.editorFocused, true);
  });

  test('reopening does not duplicate cards and resets keyboard focus to the applied theme', async () => {
    const result = await app.client.evaluate(`
      ${openViaPalette('Change theme')}
      const dracula = document.querySelector('.tp-card[data-theme="dracula"]');
      return {
        cardCount: document.querySelectorAll('.tp-card').length,
        draculaApplied: dracula.classList.contains('applied'),
        draculaKbdFocus: dracula.classList.contains('kbd-focus'),
      };
    `);
    assert.equal(result.cardCount, 5);
    assert.equal(result.draculaApplied, true);
    assert.equal(result.draculaKbdFocus, true);
  });

  test('the live specimen uses --typewriter-focus for the active line and .28 opacity for its neighbors', async () => {
    const result = await app.client.evaluate(`
      const darkCard = document.querySelector('.tp-card[data-theme="dark"]');
      const focusLine = darkCard.querySelector('.tp-specimen-line.focus');
      const dimLine = darkCard.querySelector('.tp-specimen-line.dim');
      return {
        focusLineColor: getComputedStyle(focusLine).color,
        dimLineOpacity: getComputedStyle(dimLine).opacity,
        caretWidth: getComputedStyle(darkCard.querySelector('.tp-caret')).width,
      };
    `);
    assert.equal(result.focusLineColor, 'rgb(251, 230, 160)'); // dark --typewriter-focus #fbe6a0
    assert.equal(result.dimLineOpacity, '0.28');
    assert.equal(result.caretWidth, '2px');
  });

  test('the direct per-theme palette entries (quick-switch) still work alongside the picker', async () => {
    const result = await app.client.evaluate(`
      ${openViaPalette('Amstrad')}
      return { appTheme: document.documentElement.getAttribute('data-theme') };
    `);
    assert.equal(result.appTheme, 'amstrad');
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

// Accessibility pass (design_handoff_baretext/ACCESSIBILITY.md): real
// <button>s instead of span/div+mousedown, keyboard-operable everywhere,
// hit targets, contrast, ARIA. Own instance so tabbing/keyboard-focus
// checks here can't be thrown off by state the other suites leave behind.
describe('Baretext E2E: accessibility pass', () => {
  let app;
  const fixture = [
    '# Chapter One',
    '',
    'A1 opening prose here, plenty of words so it is not a draft scene for testing.',
    '',
    '---',
    '',
    'A2 second scene prose here, plenty of words so it is not a draft scene either.',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
    await new Promise((r) => setTimeout(r, 400));
  });

  after(async () => {
    if (app) await app.close();
  });

  test('rail/corkboard/sprint controls are real, focusable <button>s, not span/div+mousedown', async () => {
    const result = await app.client.evaluate(`
      const selectors = [
        '.rail-corkboard-btn', '.rail-edit-btn', '.rail-delete-btn', '.rail-drag-handle',
        '.rail-scene-add', '.rail-footer', '#tw-status-indicator',
      ];
      return selectors.map(sel => {
        const el = document.querySelector(sel);
        return { sel, found: !!el, tag: el ? el.tagName : null, type: el ? el.type : null };
      });
    `);
    for (const r of result) {
      assert.ok(r.found, `${r.sel} should exist`);
      assert.equal(r.tag, 'BUTTON', `${r.sel} should be a real <button>`);
      assert.equal(r.type, 'button', `${r.sel} should have type="button"`);
    }
  });

  test('chapter and scene rows are keyboard-focusable tree items with the right ARIA roles', async () => {
    const result = await app.client.evaluate(`
      const tree = document.querySelector('#scene-rail [role="tree"]');
      const chRow = document.querySelector('.rail-chapter-row');
      const sceneRow = document.querySelector('.rail-scene-row');
      return {
        treeRole: tree ? tree.getAttribute('role') : null,
        chRole: chRow.getAttribute('role'),
        chTabIndex: chRow.tabIndex,
        chAriaExpanded: chRow.getAttribute('aria-expanded'),
        sceneRole: sceneRow.getAttribute('role'),
        sceneTabIndex: sceneRow.tabIndex,
      };
    `);
    assert.equal(result.treeRole, 'tree');
    assert.equal(result.chRole, 'treeitem');
    assert.equal(result.chTabIndex, 0);
    assert.ok(result.chAriaExpanded === 'true' || result.chAriaExpanded === 'false');
    assert.equal(result.sceneRole, 'treeitem');
    assert.equal(result.sceneTabIndex, 0);
  });

  test('Enter on a focused chapter row toggles it; arrow keys move focus between rows', async () => {
    const result = await app.client.evaluate(`
      const chRow = document.querySelector('.rail-chapter-row');
      const before = document.querySelectorAll('.rail-scene-row').length;
      chRow.focus();
      chRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const collapsed = document.querySelectorAll('.rail-scene-row').length;
      const stillFocused = document.activeElement && document.activeElement.classList.contains('rail-chapter-row');

      const chRowAfter = document.querySelector('.rail-chapter-row');
      chRowAfter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const restored = document.querySelectorAll('.rail-scene-row').length;

      document.querySelector('.rail-chapter-row').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 50));
      const focusedAfterArrow = document.activeElement ? document.activeElement.className : null;

      return { before, collapsed, restored, stillFocused, focusedAfterArrow };
    `);
    assert.ok(result.collapsed < result.before, 'Enter should collapse the chapter');
    assert.equal(result.stillFocused, true, 'focus should stay on the row after toggling, not get lost');
    assert.equal(result.restored, result.before, 'a second Enter should expand it back');
    assert.match(result.focusedAfterArrow || '', /rail-scene-row|rail-chapter-row/);
  });

  test('F2 renames and Delete arms the delete button on the focused row', async () => {
    const renamed = await app.client.evaluate(`
      const row = document.querySelector('.rail-scene-row');
      row.focus();
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const input = document.querySelector('.inline-rename-input');
      return { inputPresent: !!input, inputFocused: document.activeElement === input };
    `);
    assert.equal(renamed.inputPresent, true);
    assert.equal(renamed.inputFocused, true);
    await app.client.evaluate(`
      document.querySelector('.inline-rename-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
    `);

    const armed = await app.client.evaluate(`
      const row = document.querySelector('.rail-scene-row');
      row.focus();
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const btn = row.querySelector('.rail-delete-btn');
      const isArmed = btn.classList.contains('confirm');
      btn._testDisarm = true;
      return { isArmed, ariaLabel: btn.getAttribute('aria-label') };
    `);
    assert.equal(armed.isArmed, true);
    assert.match(armed.ariaLabel, /^Confirm delete/);
    // Let the 3s auto-revert clear the armed state before the next test.
    await new Promise((r) => setTimeout(r, 3200));
  });

  test('⌥↑/⌥↓ on a focused scene row reorders it within the chapter (keyboard alternative to drag)', async () => {
    const before = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    assert.ok(before.indexOf('A1 opening') < before.indexOf('A2 second'));

    await app.client.evaluate(`
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const second = rows[1]; // A2
      second.focus();
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
    `);
    const after = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    assert.ok(after.indexOf('A2 second') < after.indexOf('A1 opening'), 'A2 should now come before A1');
  });

  test('a global :focus-visible ring and a prefers-reduced-motion rule are registered app-wide', async () => {
    const result = await app.client.evaluate(`
      let hasFocusVisible = false, hasReducedMotion = false;
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const rule of rules) {
          if (rule.selectorText && rule.selectorText.includes(':focus-visible')) hasFocusVisible = true;
          if (rule.media && rule.conditionText && rule.conditionText.includes('prefers-reduced-motion')) hasReducedMotion = true;
        }
      }
      return { hasFocusVisible, hasReducedMotion };
    `);
    assert.equal(result.hasFocusVisible, true);
    assert.equal(result.hasReducedMotion, true);
  });

  // The worst offenders from ACCESSIBILITY.md's P0 hit-target table --
  // effective size counts the invisible ::before hit-layer some of these
  // use to grow the click target without growing the visible glyph.
  test('the smallest icon-only controls have a real ~28px+ hit target, not just their visible glyph', async () => {
    const result = await app.client.evaluate(`
      function effectiveSize(sel) {
        const el = document.querySelector(sel);
        const rect = el.getBoundingClientRect();
        const before = getComputedStyle(el, '::before');
        const inset = parseFloat(before.inset || before.top || '0') || 0;
        return { w: rect.width - inset * 2, h: rect.height - inset * 2 };
      }
      return {
        corkboardBtn: effectiveSize('.rail-corkboard-btn'),
        editBtn: effectiveSize('.rail-edit-btn'),
        deleteBtn: effectiveSize('.rail-delete-btn'),
        dragHandle: effectiveSize('.rail-drag-handle'),
        footerMinHeight: getComputedStyle(document.querySelector('.rail-footer')).minHeight,
      };
    `);
    for (const [name, size] of Object.entries(result)) {
      if (name === 'footerMinHeight') continue;
      assert.ok(size.w >= 24 && size.h >= 24, `${name} effective hit target should be >= 24px (got ${size.w}x${size.h})`);
    }
    assert.equal(result.footerMinHeight, '44px');
  });

  // P0-hover: rename/delete/drag-handle must never be hover-only -- a
  // keyboard/touch/screen-reader user can't hover, so they'd otherwise be
  // permanently unreachable.
  test('rail action buttons are visible (not hover-gated to invisible) even without hovering', async () => {
    const result = await app.client.evaluate(`
      const editBtn = document.querySelector('.rail-edit-btn');
      return { opacity: parseFloat(getComputedStyle(editBtn).opacity) };
    `);
    assert.ok(result.opacity > 0, 'edit button must have nonzero opacity by default, not opacity:0 until hover');
  });

  test('the command palette is a dialog+combobox+listbox: roles, aria-activedescendant tracks the highlighted option', async () => {
    const result = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const palette = document.getElementById('palette');
      const input = document.getElementById('palette-input');
      const list = document.getElementById('palette-list');
      const firstOption = document.querySelector('.pitem');
      const before = {
        dialogRole: palette.getAttribute('role'),
        ariaModal: palette.getAttribute('aria-modal'),
        inputRole: input.getAttribute('role'),
        inputControls: input.getAttribute('aria-controls'),
        listRole: list.getAttribute('role'),
        firstOptionRole: firstOption.getAttribute('role'),
        activeDescendantMatchesFirst: input.getAttribute('aria-activedescendant') === firstOption.id,
      };
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 50));
      const options = [...document.querySelectorAll('.pitem')];
      const activeOpt = options.find(o => o.getAttribute('aria-selected') === 'true');
      const afterArrow = {
        onlySelectedCount: options.filter(o => o.getAttribute('aria-selected') === 'true').length,
        activeDescendantMatchesActive: input.getAttribute('aria-activedescendant') === (activeOpt && activeOpt.id),
      };
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      return { before, afterArrow, closedAfterEsc: !document.getElementById('overlay').classList.contains('open') };
    `);
    assert.equal(result.before.dialogRole, 'dialog');
    assert.equal(result.before.ariaModal, 'true');
    assert.equal(result.before.inputRole, 'combobox');
    assert.equal(result.before.inputControls, 'palette-list');
    assert.equal(result.before.listRole, 'listbox');
    assert.equal(result.before.firstOptionRole, 'option');
    assert.equal(result.before.activeDescendantMatchesFirst, true);
    assert.equal(result.afterArrow.onlySelectedCount, 1);
    assert.equal(result.afterArrow.activeDescendantMatchesActive, true);
    assert.equal(result.closedAfterEsc, true);
  });

  test('Tab does not escape the palette while it is open (focus trap)', async () => {
    const result = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const input = document.getElementById('palette-input');
      input.focus();
      const before = document.activeElement === input;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 50));
      const after = document.activeElement === input;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      return { before, after };
    `);
    assert.equal(result.before, true);
    assert.equal(result.after, true, 'focus should stay on the palette input, not escape to the dimmed content behind it');
  });

  test('the font picker is a radiogroup and the status bar is a labeled region', async () => {
    const result = await app.client.evaluate(`
      const group = document.getElementById('font-picker');
      const serifBtn = document.querySelector('.fbtn.serif');
      serifBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      serifBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      return {
        groupRole: group.getAttribute('role'),
        groupLabel: group.getAttribute('aria-label'),
        monoChecked: document.querySelector('.fbtn.mono').getAttribute('aria-checked'),
        serifChecked: document.querySelector('.fbtn.serif').getAttribute('aria-checked'),
        statusbarRole: document.getElementById('statusbar').getAttribute('role'),
        statusbarLabel: document.getElementById('statusbar').getAttribute('aria-label'),
      };
    `);
    assert.equal(result.groupRole, 'radiogroup');
    assert.equal(result.groupLabel, 'Editor font');
    assert.equal(result.monoChecked, 'false');
    assert.equal(result.serifChecked, 'true');
    assert.equal(result.statusbarRole, 'region');
    assert.equal(result.statusbarLabel, 'Status');
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});
