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
      section.querySelector('.scene-card-new').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
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
      await new Promise(r => setTimeout(r, 150));
      const cork = document.getElementById('corkboard');
      const card = [...cork.querySelectorAll('.scene-card')][0];
      const openBtn = [...card.querySelectorAll('.corkboard-edit-btn')][1];
      const title = openBtn.title;
      openBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
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
      await new Promise(r => setTimeout(r, 100));
      const firstArmed = first.classList.contains('confirm');
      second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
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
      await new Promise(r => setTimeout(r, 100));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
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
      await new Promise(r => setTimeout(r, 150));
      const cork = document.getElementById('corkboard');
      const before = cork.querySelectorAll('.scene-card').length;
      const btn = cork.querySelector('.scene-card .corkboard-delete-btn');
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
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
      await new Promise(r => setTimeout(r, 100));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
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
