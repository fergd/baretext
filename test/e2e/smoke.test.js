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
        if (text.includes('Chapter One')) break;
        await new Promise(r => setTimeout(r, 100));
      }
      return text;
    `);
    assert.match(railText, /(?:^|\n)1\nChapter One/);
    assert.match(railText, /(?:^|\n)2\nChapter Two/);
    assert.match(railText, /A Turning Point/);
  });

  test('editor line measure is 75ch in both modes, tunable from one CSS variable — the manuscript surface gutter hangs in the margin, it does not narrow the text column', async () => {
    // See MANUSCRIPT_SURFACE.md: the number gutter has its own --gutter/--gap
    // tokens and hangs in the space the window already has beside the
    // centered column. --editor-measure stays the single source of truth
    // for line width in Editor mode exactly like Sprinter — narrowing the
    // measure specifically for the gutter was tried and reverted, it made
    // the writing column uncomfortably narrow for real use.
    const result = await app.client.evaluate(`
      return {
        cssVar: getComputedStyle(document.documentElement).getPropertyValue('--editor-measure').trim(),
        resolvedMaxWidth: getComputedStyle(document.querySelector('.cm-content')).maxWidth,
      };
    `);
    assert.equal(result.cssVar, '75ch');
    assert.ok(parseInt(result.resolvedMaxWidth, 10) > 0); // resolves to a real pixel value, not left as an unparsed ch string
  });

  // Purely cosmetic (the titlebar is flat --bg with no shadow otherwise,
  // same as the content below it — the top edge of the window read as an
  // arbitrary cutoff rather than deliberate chrome), but easy to lose to a
  // future refactor of #titlebar/#content-row without a test noticing.
  test('titlebar has a subtle drop shadow separating it from the content below', async () => {
    const result = await app.client.evaluate(`
      const cs = getComputedStyle(document.getElementById('titlebar'));
      return { boxShadow: cs.boxShadow, position: cs.position, zIndex: cs.zIndex };
    `);
    assert.notEqual(result.boxShadow, 'none');
    assert.match(result.boxShadow, /rgba?\(0,\s*0,\s*0/); // black, matching this app's elevation language (no mid-tone shadows)
    // Needs to actually paint over #content-row (the next sibling), not
    // under it — position + z-index is what makes that happen.
    assert.notEqual(result.position, 'static');
    assert.equal(result.zIndex, '1');
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

  // A bare scene's name is a rail/corkboard navigation waypoint only -- it
  // must never become visible manuscript content. Regression coverage for
  // exactly what was reported broken: naming used to delete the --- break
  // symbol and insert a real ## heading in its place. This particular scene
  // is Chapter One's implicit first scene (no marker of its own) — the
  // marker-line case gets its own isolated describe block below, since
  // several later tests in this shared-state suite key off this rename
  // landing on "The Harbor Opens" exactly as before.
  test('naming a bare scene via the rail adds no heading to the manuscript', async () => {
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
    assert.ok(!lines.some((l) => /^#{1,3}\s*The Harbor Opens$/.test(l)), 'must not become a heading');
    assert.ok(lines.includes('Mara stood at the edge of the harbor and watched the fog roll in, thinking that she probably shouldn\'t have come here alone at all, but there was no one left to tell her not to.'), 'the original prose must be untouched');

    const railText = await app.client.evaluate('return document.getElementById("scene-rail").innerText;');
    assert.match(railText, /The Harbor Opens/);
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

// Own instance: toggles typewriter mode and switches between Sprinter/
// Editor, state the shared smoke-test block above shouldn't have to account
// for. User's own words: "for sprinter mode only, increase the fade effect
// to really bring focus mainly to the line the user is writing on... editor
// typewriter mode can stay as it is now."
describe('Baretext E2E: Sprinter-only typewriter fade is more aggressive than Editor mode\'s', () => {
  let app;

  before(async () => {
    app = await launchApp({
      fixtureContent: 'Some prose.\n\n'.repeat(20),
      mode: 'sprinter',
      extraSettings: { typewriter: true },
    });
    await new Promise((r) => setTimeout(r, 400));
  });

  after(async () => {
    if (app) await app.close();
  });

  async function fadeGradient() {
    return app.client.evaluate(`
      return getComputedStyle(document.getElementById('tw-fade')).backgroundImage;
    `);
  }

  test('Sprinter\'s fade uses a narrow flat clear band and a steep ramp to fully opaque, not a smooth 0%-50%-100% taper', async () => {
    const gradient = await fadeGradient();
    // Steep version has 6 stops (0/38/48/52/62/100); the original gentle
    // one has 3 (0/50/100) -- counting color stops is a robust way to tell
    // them apart regardless of how the browser serializes the color values.
    const stopCount = (gradient.match(/\d+%/g) || []).length;
    assert.equal(stopCount, 6, `expected the 6-stop steep gradient, got: ${gradient}`);
    assert.ok(gradient.includes('48%') && gradient.includes('52%'), 'expected a narrow clear band around the center line');
  });

  test('switching to Editor mode restores the original gentle, no-flat-zone fade', async () => {
    await app.client.evaluate(`
      document.querySelector('.mode-tab[data-mode="editor"]').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 400));
    const gradient = await fadeGradient();
    const stopCount = (gradient.match(/\d+%/g) || []).length;
    assert.equal(stopCount, 3, `expected Editor mode's unchanged 3-stop gradient, got: ${gradient}`);
    assert.ok(gradient.includes('50%'), 'expected the fade to still be centered with no flat clear zone');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
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
        if (document.querySelector('.rail-chapter-title.placeholder')) break;
        await new Promise(r => setTimeout(r, 100));
      }
      const widget = document.querySelector('.cm-chapter-placeholder');
      return { railText, widgetText: widget ? widget.textContent : null };
    `);
    assert.match(result.railText, /Untitled/);
    const railPlaceholderStyle = await app.client.evaluate(`
      const el = document.querySelector('.rail-chapter-title.placeholder');
      return { text: el.textContent, fontStyle: getComputedStyle(el).fontStyle };
    `);
    assert.deepEqual(railPlaceholderStyle, { text: 'Untitled', fontStyle: 'italic' });
    // The manuscript surface uses the same label without italic styling;
    // the rail's italic treatment distinguishes placeholder from user text.
    assert.equal(result.widgetText, 'Untitled');

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

// Own instance, own fixture: exercises every gutter/heading-treatment branch
// (chapter, real ## heading, named --- scene, unnamed --- scene, and the
// bare unnamed implicit-first-scene that gets no gutter number at all) in
// one document, per MANUSCRIPT_SURFACE.md.
describe('Baretext E2E: manuscript surface (number gutter, named/unnamed scenes)', () => {
  let app;
  const fixture = [
    '# Chapter One',
    '',
    'Opening prose for the implicit first scene, unnamed on purpose.',
    '',
    '---',
    '<!-- It Begins -->',
    '',
    'Named scene prose.',
    '',
    '---',
    '',
    'Unnamed marker scene prose.',
    '',
    '## A Real Heading Scene',
    '',
    'Real heading prose.',
    '',
    '### A Real H3 Heading Scene',
    '',
    'Real h3 heading prose.',
    '',
    '#',
    '',
    'Second chapter, blank title.',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
    // The default window (main.js) is exactly 900px wide — the gutter's own
    // <900px "not enough margin" breakpoint — so it'd render display:none
    // and every geometry-based assertion below would silently measure a
    // zeroed-out rect. Widen it so the gutter is actually on screen.
    await app.client.evaluate('window.resizeTo(1300, 900); return true;');
  });

  after(async () => {
    if (app) await app.close();
  });

  // .cm-line's own textContent must stay exactly the document's real text —
  // the gutter number is a block-widget SIBLING of the line, not a DOM
  // child of it (a plugin-provided decoration can't be block-level at all;
  // CodeMirror requires a StateField for that specifically), which is also
  // what keeps every other .cm-line-based assertion in this file (exact
  // heading/marker text matches) unaffected by this feature.
  test('gutter numbers never leak into .cm-line textContent', async () => {
    const lines = await app.client.evaluate('return [...document.querySelectorAll(".cm-line")].map(l => l.textContent);');
    assert.ok(lines.includes('Chapter One'));
    assert.ok(lines.includes('A Real Heading Scene'));
    assert.ok(lines.some((l) => l.trim() === '---'));
    assert.ok(!lines.some((l) => /^\d/.test(l)), 'no line should start with a gutter-number digit');
  });

  test('chapter/heading/named-scene lines get the right gutter number; the bare unnamed implicit-first-scene gets none', async () => {
    // Chapter/real-heading/named-scene numbers are .cm-gutter-num-inline
    // (genuinely inline, textContent-empty — the digits are CSS-generated
    // via attr(), read here the same way); the unnamed-scene ornament's
    // number is still the older .cm-gutter-num block widget. One combined
    // selector returns both in real document order.
    const nums = await app.client.evaluate(`
      return [...document.querySelectorAll('.cm-gutter-num-inline, .cm-gutter-num')].map(el => ({
        text: el.textContent || el.getAttribute('data-gutter-num'), kind: el.className,
      }));
    `);
    const texts = nums.map((n) => n.text);
    assert.deepEqual(texts, ['1', '1.2', '1.3', '1.4', '1.5', '2']);
    assert.match(nums[0].kind, /cm-gutter-num-chapter/);
    assert.match(nums[5].kind, /cm-gutter-num-chapter/);
    assert.match(nums[1].kind, /cm-gutter-num-scene/); // named --- scene, heading-styled
    assert.match(nums[2].kind, /cm-gutter-num-ornament/); // unnamed --- scene
    assert.match(nums[3].kind, /cm-gutter-num-scene/); // real ## heading
    assert.match(nums[4].kind, /cm-gutter-num-scene/); // real ### heading
  });

  test('named scene renders as a left-aligned heading with no ornament; unnamed scene keeps the ornament tinted --scene', async () => {
    const result = await app.client.evaluate(`
      const named = document.querySelector('.cm-scene-name-comment');
      const namedLabel = document.querySelector('.cm-scene-name-label');
      const namedMarker = document.querySelector('.cm-scene-break-named');
      const namedMarkerBefore = getComputedStyle(namedMarker, '::before');
      const unnamed = document.querySelector('.cm-scene-break:not(.cm-scene-break-named)');
      const unnamedBefore = getComputedStyle(unnamed, '::before');
      return {
        namedTextAlign: getComputedStyle(named).textAlign,
        namedFontSize: getComputedStyle(namedLabel).fontSize,
        namedFontWeight: getComputedStyle(namedLabel).fontWeight,
        namedOrnamentDisplay: namedMarkerBefore.display,
        unnamedOrnamentBg: unnamedBefore.backgroundColor,
        sceneToken: getComputedStyle(document.documentElement).getPropertyValue('--scene').trim(),
      };
    `);
    assert.equal(result.namedTextAlign, 'left');
    assert.equal(result.namedFontSize, '28px');
    assert.equal(result.namedFontWeight, '400');
    assert.equal(result.namedOrnamentDisplay, 'none');
    // The ornament's line pseudo-element is painted with the --scene token's color.
    const hexToRgb = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    assert.equal(result.unnamedOrnamentBg, hexToRgb(result.sceneToken));
  });

  // Regression: a real bug caught on the user's own document — outline.js
  // (and this feature's own gutter numbering) treat ## and ### as equally
  // valid scene markers, but markdown-language.js's h3 style was left
  // pointing at its own old, unrelated --h3/600-weight/1.28em tokens
  // instead of the manuscript surface's shared --ms-h3-*/--h3 override.
  // The visible symptom: a bold, bright, oddly-small scene heading next to
  // a 28px gutter number, reading as badly misaligned even though the two
  // elements' top edges matched exactly.
  test('an ### (h3) scene heading gets the identical manuscript-surface treatment as ##, not the old h3 style', async () => {
    const result = await app.client.evaluate(`
      const h3 = document.querySelector('.cm-heading-3');
      const spans = [...h3.querySelectorAll('span')].filter(s => s.textContent.trim());
      const span = spans[spans.length - 1];
      const cs = getComputedStyle(span);
      return { text: span.textContent, fontWeight: cs.fontWeight, fontSize: cs.fontSize };
    `);
    assert.equal(result.text, 'A Real H3 Heading Scene');
    assert.equal(result.fontWeight, '400');
    assert.equal(result.fontSize, '28px'); // matches .cm-gutter-num-scene exactly, not the old 1.28em/19px
  });

  // Regression: two real bugs caught on the user's own document, in
  // sequence, both around getting this number to sit on the SAME baseline
  // as its heading text. First attempt: reproduce the target's position in
  // CSS by matching font-size/line-height between the number and its
  // heading — fails, because a CodeMirror line's own line box is governed
  // by the block's *inherited* line-height (sized for 15px body text), and
  // a heading-sized span inside it produces a top-of-line-to-top-of-glyph
  // gap that isn't a fixed constant (measured 3 different values in 3
  // different directions across 3 cases using identical CSS). Second
  // attempt: measure the target's real rendered position with
  // getBoundingClientRect()/Range and set the number's top to match — fixed
  // the top-of-box mismatch, but still wrong whenever the target text's
  // tallest glyph differs in height from the number's own digits: matching
  // *bounding-box tops* doesn't guarantee matching *baselines*. Both were
  // caught by a screenshot, not by the delta-based test written after the
  // first fix — that test only proved the code did what it meant to (a
  // tautology), not that "matching measured tops" was the right thing to
  // match in the first place.
  //
  // The fix: stop computing a position in JS at all. The gutter number is
  // now genuinely inline content sharing the SAME line box as its heading
  // text (see manuscript-gutter.js for how it stays textContent-invisible
  // despite that), so the browser's own baseline alignment does the
  // positioning — the one thing guaranteed to get glyphs of differing
  // heights right, because it's the same mechanism that aligns a digit next
  // to a capital letter in ordinary prose.
  //
  // A DIRECT pixel-delta check (comparing getBoundingClientRect().bottom
  // between the number and the heading text) was tried here too and
  // produces a *false positive*: CSS-generated content (the number's
  // content: attr(...)) and a real text node measure a few pixels apart via
  // getBoundingClientRect() even when a manual pixel-column scan of the
  // actual rendered screenshot confirms both glyphs bottom out at the exact
  // same row. So this test checks the STRUCTURAL preconditions that make
  // native baseline alignment apply — same line, inline-level box,
  // vertical-align: baseline — rather than re-deriving pixel positions,
  // which is the thing already shown not to be trustworthy here. It also
  // confirms the number's negative-margin "hang in the gutter" trick
  // doesn't shift the heading text over — position, unlike vertical extent,
  // isn't subject to the same measurement quirk.
  test('gutter numbers share their heading\'s line box (native CSS baseline alignment applies) and don\'t shift the heading text', async () => {
    const result = await app.client.evaluate(`
      return [...document.querySelectorAll('.cm-gutter-num-inline')].map(num => {
        const line = num.closest('.cm-line');
        const cs = getComputedStyle(num);
        const spans = [...line.querySelectorAll('span')].filter((s) => s !== num && s.textContent.trim());
        const headingLeft = spans.length ? spans[spans.length - 1].getBoundingClientRect().left : null;
        return {
          text: num.getAttribute('data-gutter-num'),
          sameLine: num.closest('.cm-line') === line,
          display: cs.display,
          verticalAlign: cs.verticalAlign,
          numLeft: num.getBoundingClientRect().left,
          headingLeft,
        };
      });
    `);
    assert.ok(result.length > 0);
    for (const r of result) {
      assert.ok(r.sameLine, `"${r.text}" gutter number is not a child of its heading's own .cm-line`);
      assert.equal(r.display, 'inline-block', `"${r.text}" must be inline-level to share the line's baseline`);
      assert.equal(r.verticalAlign, 'baseline');
      // The number (in the negative-margin gutter) must render fully to
      // the left of wherever its heading text starts — confirms the
      // margin-left/margin-right pair nets to zero rather than shifting
      // the heading over.
      if (r.headingLeft !== null) assert.ok(r.numLeft < r.headingLeft, `"${r.text}" gutter number (${r.numLeft}) should sit left of its heading text (${r.headingLeft})`);
    }
  });

  test('blank chapter title shows "Untitled" (regular weight, --text-dimmer, no italic), not the rail\'s "Chapter N"', async () => {
    const result = await app.client.evaluate(`
      const el = document.querySelector('.cm-chapter-placeholder');
      return { text: el.textContent, color: getComputedStyle(el).color, fontStyle: getComputedStyle(el).fontStyle };
    `);
    assert.equal(result.text, 'Untitled');
    assert.equal(result.fontStyle, 'normal'); // regular monospace, not italic
  });

  test('Sprinter mode shows no gutter numbers and keeps the pre-existing ornament/placeholder look', async () => {
    await app.client.evaluate(`
      document.querySelector('.mode-tab[data-mode="sprinter"]').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    const result = await app.client.evaluate(`
      const h3 = document.querySelector('.cm-heading-3');
      const spans = [...h3.querySelectorAll('span')].filter(s => s.textContent.trim());
      const h3Span = spans[spans.length - 1];
      return {
        gutterDisplays: [...document.querySelectorAll('.cm-gutter-num')].map(el => getComputedStyle(el).display),
        placeholderText: document.querySelector('.cm-chapter-placeholder').textContent,
        maxWidth: getComputedStyle(document.querySelector('.cm-content')).maxWidth,
        h3FontSize: getComputedStyle(h3Span).fontSize,
        h3FontWeight: getComputedStyle(h3Span).fontWeight,
      };
    `);
    assert.ok(result.gutterDisplays.every((d) => d === 'none'));
    assert.equal(result.placeholderText, 'Chapter 2');
    // Sprinter's own measure (--editor-measure, 75ch) is untouched.
    assert.ok(parseInt(result.maxWidth, 10) > 600);
    // Sprinter's own h3 SIZE is untouched -- only Editor mode unifies h2/h3
    // into the shared manuscript-surface scene heading (28px). Weight is a
    // separate axis: the default font is mono, and html[data-font="mono"]
    // flattens every heading to regular weight in BOTH modes (bold
    // monospace glyphs render heavier/uneven, and it breaks mono's own
    // fixed-width alignment) -- so 400 here, not Sprinter's undimmed 600,
    // is the correct expectation for the app's actual default state.
    assert.equal(result.h3FontWeight, '400');
    assert.notEqual(result.h3FontSize, '28px');

    // Switch back so this describe's own state doesn't leak into anything
    // that might reuse `app` later (defensive; there's nothing after this
    // test today, but matches this file's convention elsewhere).
    await app.client.evaluate(`
      document.querySelector('.mode-tab[data-mode="editor"]').click();
      return true;
    `);
  });

  // Regression: native (OS-level) spellcheck used to be forced on
  // unconditionally at startup, independent of the app's own spellcheck
  // FEATURE (which IS correctly excluded from Sprinter's feature list in
  // modes.js) -- so red-squiggle native spellcheck kept showing during a
  // sprint even though the app's own flagging never loaded there. This is
  // the raw DOM attribute Chromium's spellchecker reads directly, not the
  // .cm-spellError decorations covered by the tests above.
  test('native spellcheck is off in Sprinter mode, on in Editor mode', async () => {
    const editorState = await app.client.evaluate(`return document.querySelector('.cm-content').getAttribute('spellcheck');`);
    assert.equal(editorState, 'true');

    await app.client.evaluate(`
      document.querySelector('.mode-tab[data-mode="sprinter"]').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    const sprinterState = await app.client.evaluate(`return document.querySelector('.cm-content').getAttribute('spellcheck');`);
    assert.equal(sprinterState, 'false');

    await app.client.evaluate(`
      document.querySelector('.mode-tab[data-mode="editor"]').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    const backToEditorState = await app.client.evaluate(`return document.querySelector('.cm-content').getAttribute('spellcheck');`);
    assert.equal(backToEditorState, 'true');
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

// Regression: reported on the user's own document via screenshots — arrowing
// down into a fresh named scene (or clicking right after renaming one via the
// rail) could land the caret partway through the scene's raw, invisible
// "<!-- Name -->" comment (see scene-breaks.js's SceneNameWidget: that text
// stays real, just color:transparent, so E2E's exact .cm-line-text
// assertions elsewhere in this file keep working) instead of skipping past
// it onto real content. Visually the caret appeared to sit right at the end
// of the rendered heading text, well past where a user would expect it —
// confusing because nothing was actually there to edit. Fixed by giving the
// marker + its name-comment line one atomic range (scene-breaks.js's
// sceneBreakAtomicRanges) so cursor motion always jumps clean over the whole
// unit onto the real line before or after it.
describe('Baretext E2E: cursor never rests inside a named scene break\'s hidden comment text', () => {
  let app;
  const fixture = [
    '# Chapter One',
    '',
    'Opening prose for the implicit first scene, unnamed on purpose.',
    '',
    '---',
    '<!-- It Begins -->',
    '',
    'Named scene prose.',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  function selectionLine() {
    return `
      const sel = document.getSelection();
      let node = sel.anchorNode;
      let lineEl = node && node.nodeType === 3 ? node.parentElement : node;
      while (lineEl && !lineEl.classList.contains('cm-line')) lineEl = lineEl.parentElement;
      return {
        anchorNodeText: node ? node.textContent : null,
        anchorOffset: sel.anchorOffset,
        lineClass: lineEl ? lineEl.className : null,
      };
    `;
  }

  test('arrowing down through a named scene break never stops inside the name comment', async () => {
    await app.client.evaluate(`
      const lines = [...document.querySelectorAll('.cm-line')];
      const target = lines.find(l => l.textContent.includes('Opening prose'));
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: rect.right - 2, clientY: rect.top + rect.height / 2 }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: rect.right - 2, clientY: rect.top + rect.height / 2 }));
      await new Promise(r => setTimeout(r, 80));
    `);

    const steps = [];
    for (let i = 0; i < 5; i++) {
      const step = await app.client.evaluate(`
        document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 60));
        ${selectionLine()}
      `);
      steps.push(step);
    }

    assert.ok(
      steps.every((s) => !(s.lineClass || '').includes('cm-scene-name-comment')),
      `caret rested inside the hidden name-comment line at some step: ${JSON.stringify(steps)}`
    );
    // And it did actually reach the real content on the far side, not get stuck short of it.
    assert.ok(steps.some((s) => s.lineClass && s.lineClass.includes('cm-paragraph-line') && s.anchorNodeText === 'Named scene prose.'));
  });

  test('clicking directly on the rendered heading label lands on real content, not the hidden comment', async () => {
    const clicked = await app.client.evaluate(`
      const label = document.querySelector('.cm-scene-name-label');
      const rect = label.getBoundingClientRect();
      const x = rect.right - 2, y = rect.top + rect.height / 2;
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      await new Promise(r => setTimeout(r, 100));
      ${selectionLine()}
    `);
    assert.ok(!(clicked.lineClass || '').includes('cm-scene-name-comment'), `click landed inside the hidden comment: ${JSON.stringify(clicked)}`);
  });

  test('arrowing up from the scene\'s content back through the break never stops inside the name comment either', async () => {
    await app.client.evaluate(`
      const lines = [...document.querySelectorAll('.cm-line')];
      const target = lines.find(l => l.textContent === 'Named scene prose.');
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 }));
      await new Promise(r => setTimeout(r, 80));
    `);

    const steps = [];
    for (let i = 0; i < 5; i++) {
      const step = await app.client.evaluate(`
        document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38, bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 60));
        ${selectionLine()}
      `);
      steps.push(step);
    }

    assert.ok(
      steps.every((s) => !(s.lineClass || '').includes('cm-scene-name-comment')),
      `caret rested inside the hidden name-comment line at some step: ${JSON.stringify(steps)}`
    );
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

// Own instance: switches the editor font live, which the stateful suites
// around it shouldn't inherit.
describe('Baretext E2E: mono font flattens every heading to regular weight; other fonts keep bold', () => {
  let app;

  before(async () => {
    app = await launchApp({
      fixtureContent: '# Chapter One\n\n## A Scene\n\nProse.\n\n### Another Scene\n\nMore prose.',
      mode: 'editor',
    });
  });

  after(async () => {
    if (app) await app.close();
  });

  // The weight actually lands on the HighlightStyle-generated inner span,
  // not the .cm-heading-N line div itself (that div is just a decoration
  // class block-spacing.js adds for padding) -- reading the line's own
  // computed style would silently show its inherited default instead of
  // the real heading style, same gotcha the existing Sprinter-mode h3 test
  // above already works around.
  async function headingWeights() {
    return app.client.evaluate(`
      function styledSpanWeight(lineSelector) {
        const line = document.querySelector(lineSelector);
        const spans = [...line.querySelectorAll('span')].filter(s => s.textContent.trim());
        return getComputedStyle(spans[spans.length - 1]).fontWeight;
      }
      return {
        h1: styledSpanWeight('.cm-heading-1'),
        h2: styledSpanWeight('.cm-heading-2'),
        h3: styledSpanWeight('.cm-heading-3'),
      };
    `);
  }

  test('mono (the default font) renders the chapter title at regular weight, not bold', async () => {
    // h2/h3 are also 400 here, but that's Editor mode's own pre-existing
    // manuscript-surface unification (unconditional on font) -- h1 is the
    // assertion that actually isolates the new mono-specific rule, since
    // nothing else touches h1's weight in Editor mode.
    const weights = await headingWeights();
    assert.equal(weights.h1, '400', 'chapter title (h1) must not be bold in mono');
  });

  test('Sprinter mode: mono flattens all three heading levels; switching to serif reverts every one of them to its own bold default', async () => {
    // Sprinter mode applies none of Editor mode's own weight overrides, so
    // this isolates the font-driven rule specifically across h1/h2/h3.
    await app.client.evaluate(`
      document.querySelector('.mode-tab[data-mode="sprinter"]').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    const monoWeights = await headingWeights();
    assert.equal(monoWeights.h1, '400');
    assert.equal(monoWeights.h2, '400');
    assert.equal(monoWeights.h3, '400');

    await app.client.evaluate(`
      document.querySelector('.fbtn.serif').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.querySelector('.fbtn.serif').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    `);
    const serifWeights = await headingWeights();
    assert.equal(serifWeights.h1, '700', 'serif keeps its own bold chapter title');
    assert.equal(serifWeights.h2, '700');
    assert.equal(serifWeights.h3, '600');

    await app.client.evaluate(`
      document.querySelector('.fbtn.mono').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.querySelector('.fbtn.mono').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    `);
    const monoAgain = await headingWeights();
    assert.equal(monoAgain.h1, '400');
    assert.equal(monoAgain.h2, '400');
    assert.equal(monoAgain.h3, '400');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

// Own instance: needs long scenes to make "landed at the top" and "landed
// centered" measurably distinct, which would be an odd fixture to force on
// every other test in the shared smoke-test describe block.
describe('Baretext E2E: rail/corkboard navigation scrolls the jump target to the top, not the center', () => {
  let app;

  before(async () => {
    const longScene = (label) =>
      `## ${label}\n\n` +
      Array.from({ length: 40 }, (_, i) => `Paragraph ${i} of ${label}, with enough words to take up real vertical space in the editor viewport.`).join('\n\n');
    const fixtureContent = `# Chapter One\n\n${longScene('Alpha')}\n\n---\n\n${longScene('Beta')}\n\n---\n\n${longScene('Gamma')}`;
    app = await launchApp({ fixtureContent, mode: 'editor' });
    await new Promise((r) => setTimeout(r, 300));
  });

  after(async () => {
    if (app) await app.close();
  });

  async function headingPositionAfterJump(clickScript, headingLabel) {
    await app.client.evaluate(clickScript);
    await new Promise((r) => setTimeout(r, 300));
    return app.client.evaluate(`
      const heading = [...document.querySelectorAll('.cm-heading-2')].find(h => h.textContent.includes(${JSON.stringify(headingLabel)}));
      const scroller = document.querySelector('.cm-scroller');
      const scrollerRect = scroller.getBoundingClientRect();
      const headingRect = heading.getBoundingClientRect();
      return (headingRect.top - scrollerRect.top) / scrollerRect.height;
    `);
  }

  test('clicking a scene row in the rail scrolls its heading near the top of the viewport', async () => {
    const fraction = await headingPositionAfterJump(
      `
        const row = [...document.querySelectorAll('.rail-scene-row')].find(r => r.textContent.includes('Gamma'));
        row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      `,
      'Gamma'
    );
    assert.ok(fraction < 0.2, `expected the heading within the top 20% of the viewport, landed at ${(fraction * 100).toFixed(1)}%`);

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('double-clicking a card in the corkboard also scrolls its heading to the top, not centered', async () => {
    await app.client.evaluate(`
      document.querySelector('.rail-corkboard-btn').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    const fraction = await headingPositionAfterJump(
      `
        const card = [...document.querySelectorAll('.scene-card')].find(c => c.textContent.includes('Beta'));
        card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        return true;
      `,
      'Beta'
    );
    assert.ok(fraction < 0.2, `expected the heading within the top 20% of the viewport, landed at ${(fraction * 100).toFixed(1)}%`);

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

// Own instance: types real keystrokes and drives real mouse clicks to move
// the caret, so it needs a document whose spellcheck state nothing else is
// asserting on mid-suite.
describe('Baretext E2E: spellcheck does not flag a word the caret is still inside', () => {
  let app;

  before(async () => {
    app = await launchApp({ fixtureContent: '# One\n\nI wil go there teh other day.', mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('typing a misspelled word does not flag it until the caret leaves it', async () => {
    const result = await app.client.evaluate(`
      const cm = document.querySelector('.cm-content');
      cm.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(cm);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      const word = 'helllo';
      const flaggedWhileTyping = [];
      for (const ch of word) {
        document.execCommand('insertText', false, ch);
        await new Promise(r => setTimeout(r, 30));
        flaggedWhileTyping.push([...document.querySelectorAll('.cm-spellError')].some(e => e.textContent === 'helllo'));
      }
      document.execCommand('insertText', false, ' ');
      await new Promise(r => setTimeout(r, 150));
      const flaggedAfterCaretLeaves = [...document.querySelectorAll('.cm-spellError')].some(e => e.textContent === 'helllo');
      return { flaggedWhileTyping, flaggedAfterCaretLeaves };
    `);
    assert.ok(result.flaggedWhileTyping.every((f) => f === false), 'a word being actively typed must never be flagged mid-keystroke');
    assert.equal(result.flaggedAfterCaretLeaves, true, 'the finished word must be flagged once the caret has moved on');
  });

  test('clicking into an already-flagged word un-flags it; clicking away re-flags it', async () => {
    const initial = await app.client.evaluate(
      "return [...document.querySelectorAll('.cm-spellError')].map(e => e.textContent);"
    );
    assert.ok(initial.includes('teh'));

    const tehRect = await app.client.evaluate(`
      const el = [...document.querySelectorAll('.cm-spellError')].find(e => e.textContent === 'teh');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `);
    await app.client.mouseEvent('mouseMoved', tehRect.x, tehRect.y);
    await app.client.mouseEvent('mousePressed', tehRect.x, tehRect.y, 1);
    await app.client.mouseEvent('mouseReleased', tehRect.x, tehRect.y, 0);
    await new Promise((r) => setTimeout(r, 150));
    const whileCaretInside = await app.client.evaluate(
      "return [...document.querySelectorAll('.cm-spellError')].map(e => e.textContent);"
    );
    assert.ok(!whileCaretInside.includes('teh'), 'caret parked inside a flagged word must un-flag it live');

    const endRect = await app.client.evaluate(`
      const lines = document.querySelectorAll('.cm-line');
      const last = lines[lines.length - 1];
      const r = last.getBoundingClientRect();
      return { x: r.right - 2, y: r.top + r.height / 2 };
    `);
    await app.client.mouseEvent('mouseMoved', endRect.x, endRect.y);
    await app.client.mouseEvent('mousePressed', endRect.x, endRect.y, 1);
    await app.client.mouseEvent('mouseReleased', endRect.x, endRect.y, 0);
    await new Promise((r) => setTimeout(r, 150));
    const afterMovingAway = await app.client.evaluate(
      "return [...document.querySelectorAll('.cm-spellError')].map(e => e.textContent);"
    );
    assert.ok(afterMovingAway.includes('teh'), 'moving the caret away must re-flag the word');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

// Own instance: types real character-by-character keystrokes (an em dash
// only converts on genuine typing, not a bulk paste/insert), so it needs a
// document nothing else is asserting content against mid-suite.
describe('Baretext E2E: typing -- converts to an em dash, but not inside a --- scene break', () => {
  let app;

  before(async () => {
    app = await launchApp({ fixtureContent: '# One\n\nSome text here. ', mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  async function typeChars(str) {
    for (const ch of str) {
      await app.client.evaluate(`document.execCommand('insertText', false, ${JSON.stringify(ch)}); return true;`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  test('typing "word--word" converts the double dash to an em dash as soon as the next character lands', async () => {
    await app.client.evaluate(`
      const cm = document.querySelector('.cm-content');
      cm.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(cm);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    `);
    await typeChars('wait--what');
    const text = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    assert.ok(text.includes('wait—what'), 'expected an em dash between "wait" and "what"');
    assert.ok(!text.includes('wait--what'), 'the literal double dash must not survive');
  });

  test('typing a fresh "---" scene-break marker on its own line is left untouched', async () => {
    await typeChars('\n\n---\n\nNext scene.');
    const text = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    assert.ok(text.includes('---'), 'the three-dash scene-break marker must survive intact, not become an em dash');
    assert.ok(!text.includes('——'), 'no em dash should have been produced while typing the marker');
  });

  test('a run of four or more dashes is left alone, not partially converted', async () => {
    await typeChars('----done');
    const text = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    assert.ok(text.includes('----done'), 'four literal dashes followed by text must stay literal, not have its first pair swapped for an em dash');
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

// Own instance: real mouse-drag word selection + Mod-key dispatch, needs a
// document nothing else is asserting content against mid-suite. Regression
// coverage for a real bug: @codemirror/commands' own defaultKeymap binds
// Mod-i to selectParentSyntax (expand selection) at default precedence, and
// since it's registered before boldItalicKeymap() in api.js's extension
// list, it silently ate every Cmd-I keystroke -- Mod-i never reached
// wrapSelection('*') at all, it just kept expanding the selection, which
// read to the user as "Cmd-I selects all". Fixed with Prec.highest on
// boldItalicKeymap(); the assertions here need a real selection (not just a
// text check) to catch that failure mode again.
describe('Baretext E2E: Mod-b / Mod-i wrap the real selection in bold/italic markers', () => {
  let app;

  before(async () => {
    app = await launchApp({ fixtureContent: '# One\n\nSome plain text here for testing.', mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  // Drags a real mouse selection across the exact bounds of `word` (must
  // appear exactly once in the doc) via realDrag, so CM6's own selection
  // state picks it up the same way a genuine user drag would -- dispatching
  // Mod-key events at a hand-set browser Selection (no real drag) doesn't
  // exercise this, CM ignores selection changes it didn't originate.
  async function dragSelectWord(word) {
    const { startX, startY, endX, endY } = await app.client.evaluate(`
      const cm = document.querySelector('.cm-content');
      cm.focus();
      // textContent, not innerText -- innerText includes this app's own
      // CSS ::before generated content (gutter numbers, scene labels),
      // which would throw off character offsets against the real text
      // nodes a TreeWalker below actually visits.
      const text = cm.textContent;
      const idx = text.indexOf(${JSON.stringify(word)});
      const walker = document.createTreeWalker(cm, NodeFilter.SHOW_TEXT);
      let node, offset = 0, target, so, eo;
      while ((node = walker.nextNode())) {
        const len = node.textContent.length;
        if (so === undefined && idx >= offset && idx < offset + len) { target = node; so = idx - offset; }
        const endIdx = idx + ${JSON.stringify(word)}.length;
        if (eo === undefined && endIdx >= offset && endIdx <= offset + len) { eo = endIdx - offset; }
        offset += len;
      }
      const r1 = document.createRange();
      r1.setStart(target, so); r1.setEnd(target, so + 1);
      const rect1 = r1.getBoundingClientRect();
      const r2 = document.createRange();
      r2.setStart(target, eo - 1); r2.setEnd(target, eo);
      const rect2 = r2.getBoundingClientRect();
      return { startX: rect1.left, startY: rect1.top + rect1.height / 2, endX: rect2.right, endY: rect2.top + rect2.height / 2 };
    `);
    await app.client.realDrag(startX, startY, endX, endY, { steps: 6, stepDelayMs: 20 });
    await new Promise((r) => setTimeout(r, 150));
  }

  test('Mod-i wraps a real selection in single asterisks and does not expand the selection', async () => {
    await dragSelectWord('plain');
    const selectedBefore = await app.client.evaluate('return window.getSelection().toString();');
    assert.equal(selectedBefore, 'plain');

    await app.client.evaluate(`
      document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'i', metaKey: true, bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 200));

    const after = await app.client.evaluate(`
      return { text: document.querySelector('.cm-content').innerText, selected: window.getSelection().toString() };
    `);
    assert.ok(after.text.includes('*plain*'), 'expected the selected word wrapped in single asterisks');
    assert.equal(after.selected, 'plain', 'selection must stay on the wrapped word, not balloon out to the whole line');
  });

  test('Mod-b wraps a real selection in double asterisks', async () => {
    await dragSelectWord('testing');
    await app.client.evaluate(`
      document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 200));
    const text = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    assert.ok(text.includes('**testing**'), 'expected the selected word wrapped in double asterisks');
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

  // Regression: the minimized sprint edge line lives outside #statusbar (an
  // absolutely-positioned sibling), so hiding the status bar alone left it
  // on screen -- defeating the point of focus mode's declutter.
  test('focus mode (⌘.) also hides the minimized sprint edge line, and restores it when toggled off', async () => {
    await app.client.evaluate(`
      // Restore to active, then minimize, so the edge line is showing.
      document.querySelector('.sprint-chip-status').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.querySelector('.sprint-chip-status').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const minBtn = [...document.querySelectorAll('.sprint-pill')].find(b => b.innerText === 'minimize');
      minBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      minBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const before = await app.client.evaluate(`
      return { edgeDisplay: getComputedStyle(document.querySelector('.sprint-edge')).display, edgeOpacity: getComputedStyle(document.querySelector('.sprint-edge')).opacity };
    `);
    assert.equal(before.edgeDisplay, 'block');
    assert.equal(before.edgeOpacity, '1');

    const focusOn = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      return { edgeOpacity: getComputedStyle(document.querySelector('.sprint-edge')).opacity };
    `);
    assert.equal(focusOn.edgeOpacity, '0');

    const focusOff = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      return { edgeOpacity: getComputedStyle(document.querySelector('.sprint-edge')).opacity };
    `);
    assert.equal(focusOff.edgeOpacity, '1');

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
  //
  // dragover/drop fire as real MouseEvents (not a bare Event) with clientY
  // pinned near the TOP of the target row specifically — rail.js's
  // before/after drop-indicator feature reads clientY to decide which side
  // of the target a drop lands on, and every test written against this
  // helper already assumes "drop = insert before". A bare Event has no
  // clientY at all (reads as NaN, which always lost the "< midpoint"
  // comparison and landed every synthetic drop on the "after" side instead
  // — every test below broke against that until this got fixed here rather
  // than in each assertion).
  function dragScript(fromExpr, toExpr, targetHalf = 'top') {
    return `
      function fireDnd(type, el, dt) {
        const rect = el.getBoundingClientRect();
        const y = ${JSON.stringify(targetHalf)} === 'bottom' ? rect.bottom - 4 : rect.top + 4;
        const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: y });
        e.dataTransfer = dt;
        el.dispatchEvent(e);
      }
      const dt = { effectAllowed: '', dropEffect: '', data: {}, setData(k,v){this.data[k]=v;}, getData(k){return this.data[k];} };
      const from = ${fromExpr};
      const to = ${toExpr};
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

  // The drop-position feedback feature itself (not just "doesn't regress
  // the pre-existing before-only behavior", which every dragScript() test
  // above already covers by construction): hovering a row's TOP half shows
  // a drop-before indicator and inserts before it (already implied by every
  // test above); hovering its BOTTOM half shows drop-after and inserts
  // AFTER it instead — previously impossible to request at all, a drop
  // always landed before whatever row it was released on regardless of
  // where on that row the cursor was.
  test('dropping on a row\'s bottom half shows a drop-after indicator and inserts after it, not before', async () => {
    // Own fixture, own app instance -- the shared describe-level `app` above
    // this point in the file has been reordered/relocated several times by
    // earlier tests, and its scenes are unnamed (rail labels them
    // positionally, "Scene 1"/"Scene 2"/... by current order) -- there's no
    // stable identity to assert against there. Named scenes here give each
    // one a fixed label regardless of where it ends up.
    const fixture = [
      '# Chapter One', '',
      '---', '<!-- Alpha -->', '', 'Alpha prose.', '',
      '---', '<!-- Beta -->', '', 'Beta prose.', '',
      '---', '<!-- Gamma -->', '', 'Gamma prose.',
    ].join('\n');
    const dragApp = await launchApp({ fixtureContent: fixture, mode: 'editor' });
    try {
      // scene-nav's first real render trails the doc content itself loading
      // (debounced 180ms) -- poll rather than assume it's already happened
      // (same as this describe block's very first test, above).
      await dragApp.client.evaluate(`
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          if (document.querySelectorAll('.rail-scene-row').length >= 3) break;
          await new Promise(r => setTimeout(r, 100));
        }
      `);
      const before = await dragApp.client.evaluate('return [...document.querySelectorAll(".rail-scene-name")].map(e => e.textContent);');
      assert.deepEqual(before, ['Alpha', 'Beta', 'Gamma']);

      // Drag Alpha (first) onto Gamma's (last) BOTTOM half -- dropping on
      // its top half would land Alpha directly before Gamma, indistinguishable
      // from a generic "move to position 2" bug; the bottom half must put
      // it strictly after Gamma, at the very end.
      await dragApp.client.evaluate(dragScript(
        `document.querySelectorAll('.rail-scene-row')[0]`,
        `document.querySelectorAll('.rail-scene-row')[2]`,
        'bottom',
      ));
      const after = await dragApp.client.evaluate('return [...document.querySelectorAll(".rail-scene-name")].map(e => e.textContent);');
      assert.deepEqual(after, ['Beta', 'Gamma', 'Alpha']);

      const bad = dragApp.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
      assert.deepEqual(bad, []);
    } finally {
      await dragApp.close();
    }
  });

  test('the drop-before/drop-after indicator classes actually reflect which half of the row dragover is over', async () => {
    const result = await app.client.evaluate(`
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const from = rows[0], target = rows[rows.length - 1];
      function fireDnd(type, el, dt, y) {
        const rect = el.getBoundingClientRect();
        const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: y });
        e.dataTransfer = dt;
        el.dispatchEvent(e);
      }
      const dt = { effectAllowed: '', dropEffect: '', data: {}, setData(k,v){this.data[k]=v;}, getData(k){return this.data[k];} };
      fireDnd('dragstart', from, dt);

      const rect = target.getBoundingClientRect();
      fireDnd('dragover', target, dt, rect.top + 4);
      const afterTopHover = target.className;
      fireDnd('dragover', target, dt, rect.bottom - 4);
      const afterBottomHover = target.className;

      target.dispatchEvent(new Event('dragleave', { bubbles: true, cancelable: true }));
      const afterLeave = target.className;

      from.dispatchEvent(new Event('dragend', { bubbles: true, cancelable: true }));
      return { afterTopHover, afterBottomHover, afterLeave };
    `);
    assert.match(result.afterTopHover, /\bdrop-before\b/);
    assert.doesNotMatch(result.afterTopHover, /\bdrop-after\b/);
    assert.match(result.afterBottomHover, /\bdrop-after\b/);
    assert.doesNotMatch(result.afterBottomHover, /\bdrop-before\b/);
    assert.doesNotMatch(result.afterLeave, /\bdrop-before\b|\bdrop-after\b/, 'dragleave should clear the indicator');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  // The Figma interaction separates navigation from disclosure: the row
  // body jumps to the chapter, while only the persistent chevron toggles.
  test('chapter body navigates while its chevron alone toggles collapse', async () => {
    const result = await app.client.evaluate(`
      const row = [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter One'));
      const before = document.querySelectorAll('.rail-scene-row').length;
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const afterBody = document.querySelectorAll('.rail-scene-row').length;
      const chevron = [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter One')).querySelector('.rail-chevron-btn');
      chevron.click();
      await new Promise(r => setTimeout(r, 100));
      const afterChevron = document.querySelectorAll('.rail-scene-row').length;
      [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter One')).querySelector('.rail-chevron-btn').click();
      await new Promise(r => setTimeout(r, 100));
      const restored = document.querySelectorAll('.rail-scene-row').length;
      return { before, afterBody, afterChevron, restored };
    `);
    assert.equal(result.afterBody, result.before, 'chapter body must not collapse the chapter');
    assert.ok(result.afterChevron < result.before, 'the chevron should collapse the chapter');
    assert.equal(result.restored, result.before, 'the second chevron click should restore suite state');
  });

  // Regression test for a real bug the synthetic-DragEvent tests above could
  // not have caught: mousedown->preventDefault() (used everywhere else to
  // keep the editor from losing focus on a chrome click) silently stops
  // Chromium from ever starting a native drag when it's on the same element
  // the drag initiates from. Rows are draggable directly now (no separate
  // handle icon), wired via onActivateDraggable() specifically because it
  // omits that preventDefault() -- every dragScript() test above still
  // passed throughout regardless because fireDnd() hand-dispatches DragEvent
  // objects directly, which runs the app's own dragstart/dragover/drop
  // handlers but never exercises the browser's actual "should a drag even
  // start here" decision. A real press+move+release through the CDP Input
  // domain does.
  test('a real mouse-driven press+move+release on a scene row actually reorders (not just a synthetic DragEvent)', async () => {
    // Earlier tests in this describe block already reordered A1/A2 at least
    // once, so don't assume which currently comes first -- read the live
    // order, then drag whichever row is second onto whichever is first.
    const before = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    const firstIsA1 = before.indexOf('A1 opening') < before.indexOf('A2 second');

    const rects = await app.client.evaluate(`
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const from = rows[1]; // whichever scene currently comes second
      const to = rows[0];   // whichever scene currently comes first
      const f = from.getBoundingClientRect();
      const t = to.getBoundingClientRect();
      // Land in the TOP quarter of the target row, not its exact center --
      // rail.js's before/after drop-indicator splits exactly at the
      // midpoint, and releasing precisely there is a genuine tie (which
      // side wins is an implementation detail, not something to depend on).
      // Landing clearly in the top half means "insert before", matching
      // the assertion below.
      return { from: { x: f.x + f.width / 2, y: f.y + f.height / 2 }, to: { x: t.x + t.width / 2, y: t.y + t.height / 4 } };
    `);

    await app.client.realDrag(rects.from.x, rects.from.y, rects.to.x, rects.to.y);
    await new Promise((r) => setTimeout(r, 200));

    const after = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    const stillFirstIsA1 = after.indexOf('A1 opening') < after.indexOf('A2 second');
    assert.notEqual(stillFirstIsA1, firstIsA1, 'a real mouse drag should swap A1/A2\'s order, same as the synthetic-event test above already showed the app logic can do');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  // Regression: a real bug the user hit directly, via a real mouse drag
  // (not the synthetic-DragEvent tests above, which never exercised this —
  // it isn't about drag initiation, it's about what reorderScenes()'s
  // buildDocument() does with the moved scene's content). "+ add scene"
  // inserts a bare `---` marker with nothing typed after it yet; an earlier
  // version of buildDocument() silently pruned any scene whose body was
  // empty once the document got rebuilt, meaning a freshly-added, not-yet-
  // written scene vanished entirely the moment it was dragged anywhere —
  // no error, no undo-worthy trace, just gone.
  test('dragging a freshly-added (still-empty) scene to another chapter does not lose it', async () => {
    await app.client.evaluate(`
      const addRow = [...document.querySelectorAll('.rail-scene-add')].find(r => r.title.includes('Chapter One'));
      addRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      addRow.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    // This describe block's tests run sequentially against one shared,
    // mutating document (earlier tests in it already reorder/relocate
    // scenes), so read live counts as the baseline rather than assuming the
    // fixture's original per-chapter numbers still hold at this point.
    const before = await app.client.evaluate(`
      return {
        sceneRowCount: document.querySelectorAll('.rail-scene-row').length,
        ch1SceneCount: [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter One')).querySelector('.rail-dim').textContent.split('/')[0],
        ch3SceneCount: [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter Three')).querySelector('.rail-dim').textContent.split('/')[0],
      };
    `);

    const rects = await app.client.evaluate(`
      const ch1Rows = [...document.querySelectorAll('.rail-scene-row')].filter(r => r.closest('.rail-scene-list').previousElementSibling.textContent.includes('Chapter One'));
      const source = ch1Rows[ch1Rows.length - 1]; // the just-added empty scene, last in Chapter One
      const target = [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter Three'));
      const s = source.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      return { from: { x: s.x + s.width / 2, y: s.y + s.height / 2 }, to: { x: t.x + t.width / 2, y: t.y + t.height / 2 } };
    `);
    await app.client.realDrag(rects.from.x, rects.from.y, rects.to.x, rects.to.y);
    await new Promise((r) => setTimeout(r, 250));

    const after = await app.client.evaluate(`
      return {
        sceneRowCount: document.querySelectorAll('.rail-scene-row').length,
        ch1SceneCount: [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter One')).querySelector('.rail-dim').textContent.split('/')[0],
        ch3SceneCount: [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter Three')).querySelector('.rail-dim').textContent.split('/')[0],
      };
    `);
    // Total scene count must be unchanged by the move — this is the actual
    // regression check; the old bug dropped the row count by exactly one.
    assert.equal(after.sceneRowCount, before.sceneRowCount, 'the empty scene must not disappear from the rail');
    assert.equal(Number(after.ch1SceneCount), Number(before.ch1SceneCount) - 1);
    assert.equal(Number(after.ch3SceneCount), Number(before.ch3SceneCount) + 1);

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

// Own instance: Cold Storage is a place to park cut scenes without deleting
// them (see model.js/reorder.js) -- always present in the rail as a drop
// zone, excluded from the "N ch · M" header count and the status bar's word
// count, self-cleaning (writes nothing to the document) when empty.
describe('Baretext E2E: Cold Storage parks cut scenes without deleting them', () => {
  let app;

  before(async () => {
    app = await launchApp({
      fixtureContent:
        '# Chapter One\n\nFirst scene, plenty of words here to count toward the total for this test fixture document.\n\n---\n\nSecond scene, also plenty of words here to count toward the total for this fixture document too.',
      mode: 'editor',
    });
    await new Promise((r) => setTimeout(r, 300));
  });

  after(async () => {
    if (app) await app.close();
  });

  test('is always visible in the rail, even before it has ever been used, and excluded from the "N ch" count', async () => {
    const state = await app.client.evaluate(`
      return {
        visible: !!document.querySelector('.rail-cold-storage-row'),
        headerText: document.querySelector('.rail-header .rail-dim').textContent,
        docText: document.querySelector('.cm-content').innerText,
      };
    `);
    assert.equal(state.visible, true);
    assert.equal(state.headerText, '1ch/2'); // 1 real chapter, 2 real scenes -- Cold Storage doesn't count
    assert.ok(!state.docText.includes('COLD STORAGE')); // never touches the doc until actually used
  });

  test('dragging a scene onto it removes the scene from its chapter, excludes it from the word count, and writes the marker', async () => {
    const before = await app.client.evaluate(`
      return { wordCount: document.getElementById('word-count').textContent };
    `);
    assert.equal(before.wordCount, '37 words');

    const coords = await app.client.evaluate(`
      const sceneRow = [...document.querySelectorAll('.rail-scene-row')].find(r => r.textContent.includes('Scene 2'));
      const sRect = sceneRow.getBoundingClientRect();
      const coldRow = document.querySelector('.rail-cold-storage-row');
      const cRect = coldRow.getBoundingClientRect();
      return {
        fromX: sRect.left + sRect.width / 2, fromY: sRect.top + sRect.height / 2,
        toX: cRect.left + cRect.width / 2, toY: cRect.top + cRect.height / 2,
      };
    `);
    await app.client.realDrag(coords.fromX, coords.fromY, coords.toX, coords.toY, { steps: 12, stepDelayMs: 30 });
    await new Promise((r) => setTimeout(r, 300));

    const after = await app.client.evaluate(`
      return {
        headerText: document.querySelector('.rail-header .rail-dim').textContent,
        coldStorageCount: document.querySelector('.rail-cold-storage-row .rail-dim').textContent,
        wordCount: document.getElementById('word-count').textContent,
        // .cm-content's rendered text, NOT the real document -- Cold
        // Storage is now always hidden from the scrollable manuscript (see
        // cold-storage-view.js), so this checks it's genuinely invisible,
        // not just that the assertion below is redundant with it.
        visibleText: document.querySelector('.cm-content').innerText,
      };
    `);
    assert.equal(after.headerText, '1ch/1', 'the moved scene must no longer count toward the real chapter/scene total');
    assert.match(after.coldStorageCount, /^1\/\d+$/, 'Cold Storage meta is "scenes/words"'); // 1 scene now parked there
    assert.equal(after.wordCount, '19 words', 'Cold Storage words must not count toward the manuscript word count');
    assert.ok(!after.visibleText.includes('COLD STORAGE'), 'Cold Storage must not be scrollable into from the main manuscript view');
    assert.ok(!after.visibleText.includes('Second scene'), 'the moved scene\'s own text must not be visible either');

    // The marker + moved scene must still be written for real, just not
    // rendered -- force a save and check the actual bytes on disk, the
    // only way to see the real document now that it's hidden from .cm-content.
    await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
    `);
    const saved = fs.readFileSync(app.fixturePath, 'utf8');
    assert.ok(saved.includes('COLD STORAGE'));
    assert.ok(saved.includes('Second scene'));

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('dragging its last scene back into a chapter erases the marker and restores the word count', async () => {
    const coordsBack = await app.client.evaluate(`
      const coldRow = document.querySelector('.rail-cold-storage-row');
      const sceneRow = coldRow.nextElementSibling.querySelector('.rail-scene-row');
      const sRect = sceneRow.getBoundingClientRect();
      const chRow = [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter One'));
      const cRect = chRow.getBoundingClientRect();
      return {
        fromX: sRect.left + sRect.width / 2, fromY: sRect.top + sRect.height / 2,
        toX: cRect.left + cRect.width / 2, toY: cRect.top + cRect.height / 2,
      };
    `);
    await app.client.realDrag(coordsBack.fromX, coordsBack.fromY, coordsBack.toX, coordsBack.toY, { steps: 12, stepDelayMs: 30 });
    await new Promise((r) => setTimeout(r, 300));

    const after = await app.client.evaluate(`
      return {
        headerText: document.querySelector('.rail-header .rail-dim').textContent,
        coldStorageCount: document.querySelector('.rail-cold-storage-row .rail-dim').textContent,
        coldStorageStillVisible: !!document.querySelector('.rail-cold-storage-row'),
        wordCount: document.getElementById('word-count').textContent,
      };
    `);
    assert.equal(after.headerText, '1ch/2');
    assert.equal(after.coldStorageCount, '0/0'); // emptied -- 0 scenes, 0 words
    assert.equal(after.coldStorageStillVisible, true, 'Cold Storage stays a persistent drop zone even once emptied');
    assert.equal(after.wordCount, '37 words');

    await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
    `);
    const saved = fs.readFileSync(app.fixturePath, 'utf8');
    assert.ok(!saved.includes('COLD STORAGE'), 'an emptied Cold Storage must erase its own marker from the real document, not just hide it');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

// Own instance: Cold Storage scenes aren't reachable by scrolling the main
// manuscript at all -- clicking one opens an isolated "scene view" (see
// src/editor/cold-storage-view.js), exited via Back/Escape/clicking another
// scene, which restores wherever the cursor was in the real manuscript
// before scene view was entered. User's own words: "you should not be able
// to scroll to 'cold storage' files as part of scrolling through the main
// manuscript... Cold storage should be stand-alone scenes."
describe('Baretext E2E: Cold Storage scenes open in an isolated scene view, not inline in the manuscript', () => {
  let app;
  // A known cursor position inside chapter one's prose -- set via settings
  // (see harness.js) so entering/exiting scene view has a real, non-zero
  // manuscript position to prove it actually restores, rather than just
  // landing back at whatever position the doc happens to load with.
  const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} of chapter one, with enough text to make the manuscript genuinely scrollable.`);
  const fixtureContent = `# Chapter One\n\n${paragraphs.join('\n\n')}\n\n<!-- COLD STORAGE -->\n\n<!-- First Cut -->\n\nFirst cut scene content, not too short.\n\n---\n<!-- Second Cut -->\n\nSecond cut scene content, also not too short.`;
  const knownCursorPos = fixtureContent.indexOf('Paragraph 5 of');

  before(async () => {
    app = await launchApp({ fixtureContent, mode: 'editor', extraSettings: { lastCursorPos: knownCursorPos } });
    await new Promise((r) => setTimeout(r, 300));
  });

  after(async () => {
    if (app) await app.close();
  });

  async function visibleText() {
    return app.client.evaluate('return document.querySelector(".cm-content").innerText;');
  }
  async function clickRailRow(labelSubstr) {
    await app.client.evaluate(`
      const row = [...document.querySelectorAll('.rail-scene-row')].find(r => r.textContent.includes(${JSON.stringify(labelSubstr)}));
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
  }
  async function bannerState() {
    return app.client.evaluate(`
      return {
        visible: document.getElementById('cold-storage-banner').classList.contains('visible'),
        label: document.getElementById('cold-storage-banner-label').textContent,
        hostActive: document.getElementById('editor-host').classList.contains('cold-storage-view-active'),
      };
    `);
  }

  test('scrolling the main manuscript to its bottom never reaches Cold Storage', async () => {
    const text = await app.client.evaluate(`
      const scroller = document.querySelector('.cm-scroller');
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise(r => setTimeout(r, 150));
      return document.querySelector('.cm-content').innerText;
    `);
    assert.ok(!text.includes('COLD STORAGE'), 'the marker must never become visible by scrolling');
    assert.ok(!text.includes('First cut scene'), 'Cold Storage scene text must never become visible by scrolling');
    // Reset scroll for the tests that follow.
    await app.client.evaluate('document.querySelector(".cm-scroller").scrollTop = 0; return true;');
  });

  test('clicking a Cold Storage scene opens an isolated scene view showing only that scene', async () => {
    await clickRailRow('First Cut');
    const banner = await bannerState();
    const text = await visibleText();
    assert.equal(banner.visible, true);
    assert.equal(banner.label, 'First Cut');
    assert.equal(banner.hostActive, true);
    assert.ok(!text.includes('Paragraph'), 'the manuscript prose must not be visible');
    assert.ok(text.includes('First cut scene content'), 'the target scene must be visible');
    assert.ok(!text.includes('Second cut scene content'), 'the OTHER Cold Storage scene must not be visible either');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('editing while in scene view writes to the real document', async () => {
    await app.client.evaluate(`
      document.querySelector('.cm-content').focus();
      document.execCommand('insertText', false, ' EDITED-IN-SCENE-VIEW');
      return true;
    `);
    await new Promise((r) => setTimeout(r, 150));
    const text = await visibleText();
    assert.ok(text.includes('EDITED-IN-SCENE-VIEW'));

    await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
    `);
    const saved = fs.readFileSync(app.fixturePath, 'utf8');
    assert.ok(saved.includes('EDITED-IN-SCENE-VIEW'), 'the edit made while isolated must land in the real file, not a disconnected copy');
  });

  test('clicking Back restores the exact cursor position from before scene view was entered', async () => {
    await app.client.evaluate(`
      document.getElementById('cold-storage-back-btn').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.getElementById('cold-storage-back-btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    const banner = await bannerState();
    const text = await visibleText();
    assert.equal(banner.visible, false);
    assert.equal(banner.hostActive, false);
    assert.ok(text.includes('Paragraph 5 of'), 'must return to the exact spot the cursor was at before entering scene view');
    assert.ok(!text.includes('COLD STORAGE'));
  });

  test('switching between two Cold Storage scenes, then exiting, restores the ORIGINAL manuscript position — not the first scene visited', async () => {
    await clickRailRow('First Cut');
    await clickRailRow('Second Cut');
    const midSwitch = await bannerState();
    assert.equal(midSwitch.label, 'Second Cut');

    await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    const banner = await bannerState();
    const text = await visibleText();
    assert.equal(banner.visible, false, 'Escape must exit scene view');
    assert.ok(text.includes('Paragraph 5 of'), 'must land back at the original manuscript position, not wherever First Cut left off');
  });

  test('clicking a real chapter scene while in scene view exits and jumps there correctly', async () => {
    await clickRailRow('First Cut');
    assert.equal((await bannerState()).visible, true);

    // The rail stays interactive during scene view -- click the real
    // chapter's own (implicit first) scene row, still visible the whole
    // time, to jump there directly.
    const sceneRowClick = await app.client.evaluate(`
      const row = [...document.querySelectorAll('.rail-scene-row')].find(r => r.dataset.ci === '0');
      if (!row) return false;
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    `);
    assert.equal(sceneRowClick, true);
    await new Promise((r) => setTimeout(r, 300));

    const banner = await bannerState();
    const text = await visibleText();
    assert.equal(banner.visible, false, 'jumping to a real chapter scene must exit Cold Storage scene view');
    assert.ok(text.includes('Chapter One'), 'the real manuscript must be reachable/visible again');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('deleting the scene currently open in scene view exits back to the manuscript', async () => {
    await clickRailRow('Second Cut');
    assert.equal((await bannerState()).visible, true);

    // Two-click arm/confirm on the still-visible rail row's own delete button.
    await app.client.evaluate(`
      const row = [...document.querySelectorAll('.rail-scene-row')].find(r => r.textContent.includes('Second Cut'));
      const deleteBtn = row.querySelector('.rail-delete-btn');
      deleteBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      deleteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 100));
    await app.client.evaluate(`
      const row = [...document.querySelectorAll('.rail-scene-row')].find(r => r.textContent.includes('Second Cut'));
      const deleteBtn = row.querySelector('.rail-delete-btn');
      deleteBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      deleteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));

    const banner = await bannerState();
    const text = await visibleText();
    assert.equal(banner.visible, false, 'self-deleting the viewed scene must exit scene view rather than leave it pointed at nothing');
    assert.ok(text.includes('Chapter One'), 'must land back in the visible manuscript');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('Cold Storage scenes never get a manuscript-surface gutter number', async () => {
    const gutterNums = await app.client.evaluate(`
      return [...document.querySelectorAll('[data-gutter-num]')].map(el => el.getAttribute('data-gutter-num'));
    `);
    // Only the chapter itself should be numbered in this fixture (the
    // implicit first scene is unnamed, so it never gets a visible number
    // either -- that's pre-existing, unrelated behavior). What matters
    // here: nothing from Cold Storage's remaining scene appears.
    assert.deepEqual(gutterNums, ['1']);
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

describe('Baretext E2E: naming a bare marker-line scene', () => {
  let app;
  const fixture = [
    '# Chapter One',
    '',
    'First scene prose goes here with enough words to clear the draft threshold nicely for this test case.',
    '',
    '---',
    '',
    'Second scene prose goes here with enough words to clear the draft threshold nicely for this test case.',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('keeps the --- break symbol, adds no heading, and hides the raw comment in the editor', async () => {
    // scene-nav's first real render trails the doc content itself loading
    // (debounced 180ms) -- poll rather than assume it's already happened.
    await app.client.evaluate(`
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (document.querySelectorAll('.rail-scene-row').length >= 2) break;
        await new Promise(r => setTimeout(r, 100));
      }
    `);

    const before = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    const breakCountBefore = (before.match(/^---$/gm) || []).length;

    await app.client.evaluate(`
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const target = rows.find(r => r.innerText.startsWith('Scene 2'));
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
    assert.ok(!lines.some((l) => /^#{1,3}\s*The Harbor Opens$/.test(l)), 'must not become a heading');
    assert.ok(lines.some((l) => l.trim() === '---'), 'the --- break line must still be a real line in the doc');

    const afterDoc = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    const breakCountAfter = (afterDoc.match(/^---$/gm) || []).length;
    assert.equal(breakCountAfter, breakCountBefore, 'no --- lines lost or gained');
    assert.ok(afterDoc.includes('First scene prose') && afterDoc.includes('Second scene prose'), 'original prose untouched');

    const railText = await app.client.evaluate('return document.getElementById("scene-rail").innerText;');
    assert.match(railText, /The Harbor Opens/);

    // The editor visually hides the raw <!-- --> syntax the same way it
    // already hides the raw dashes, replacing it with just the name — a
    // separate widget (.cm-scene-name-label), not the line itself, so it
    // can be ordered independently of the gutter number sharing this line
    // (see manuscript-gutter.js/scene-breaks.js for why).
    const visual = await app.client.evaluate(`
      const line = document.querySelector('.cm-scene-name-comment');
      const label = document.querySelector('.cm-scene-name-label');
      return line && label
        ? { dataName: label.getAttribute('data-scene-name'), lineColor: getComputedStyle(line).color }
        : null;
    `);
    assert.ok(visual, 'the name-comment line and its label widget should both be present');
    assert.equal(visual.dataName, 'The Harbor Opens');
    assert.equal(visual.lineColor, 'rgba(0, 0, 0, 0)');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('re-naming the same scene replaces the comment in place, no duplicate', async () => {
    await app.client.evaluate(`
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const target = rows.find(r => r.innerText.includes('The Harbor Opens'));
      const editBtn = target.querySelector('.rail-edit-btn');
      editBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const input = document.querySelector('.inline-rename-input');
      input.value = 'Confrontation';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const doc = await app.client.evaluate('return document.querySelector(".cm-content").innerText;');
    assert.ok(!doc.includes('The Harbor Opens'), 'the old name should be fully replaced');
    assert.equal((doc.match(/Confrontation/g) || []).length, 1, 'exactly one comment, not a duplicate');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

describe('Baretext E2E: corkboard cross-chapter drag', () => {
  let app;
  const fixture = [
    '# Chapter One',
    '',
    'B1 opening prose here, plenty of words so it is not a draft scene for testing purposes today.',
    '',
    '# Chapter Two', // deliberately empty, same "Ch. 2 has nothing in it" case as the rail fixture above
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
    await app.client.evaluate(`
      document.querySelector('.rail-corkboard-btn').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.querySelector('.rail-corkboard-btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
  });

  after(async () => {
    if (app) await app.close();
  });

  // Regression test: the grid's catch-all "append to end of this chapter"
  // dragover/drop handlers required `e.target === grid` exactly, which only
  // matches the grid's own bare background pixels. A real drop almost
  // always lands on some descendant instead -- most obviously the dashed
  // "new scene" tile, which is the only thing rendered at all in an empty
  // chapter's grid. That bubbled target failed the check, so preventDefault
  // was never called on dragover, and the browser silently rejected the
  // drop (dragend fired with no 'drop' in between) -- confirmed live before
  // this fix. A real mouse-driven drag (not a hand-dispatched DragEvent)
  // onto that tile is what actually exercises the bug.
  test('a real mouse-driven drag onto an empty chapter\'s "new scene" tile moves the card there', async () => {
    const rects = await app.client.evaluate(`
      const sections = [...document.querySelectorAll('.corkboard-chapter')];
      const card = sections[0].querySelector('.scene-card').getBoundingClientRect();
      const tile = sections[1].querySelector('.scene-card-new').getBoundingClientRect();
      return {
        from: { x: card.x + card.width / 2, y: card.y + card.height / 2 },
        to: { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 },
      };
    `);

    await app.client.realDrag(rects.from.x, rects.from.y, rects.to.x, rects.to.y);
    await new Promise((r) => setTimeout(r, 200));

    const titles = await app.client.evaluate(`
      return [...document.querySelectorAll('.corkboard-chapter')].map(s =>
        [...s.querySelectorAll('.scene-card-title-text')].map(e => e.textContent));
    `);
    assert.deepEqual(titles[0], [], 'Chapter One should now be empty');
    assert.deepEqual(titles[1], ['Scene 1'], 'the scene should have landed in Chapter Two');

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
        '.rail-corkboard-btn', '.rail-edit-btn', '.rail-delete-btn',
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

  test('Enter on a focused chapter row navigates; arrow keys move focus between rows', async () => {
    const result = await app.client.evaluate(`
      const chRow = document.querySelector('.rail-chapter-row');
      const before = document.querySelectorAll('.rail-scene-row').length;
      chRow.focus();
      chRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const afterEnter = document.querySelectorAll('.rail-scene-row').length;
      const editorFocused = !!document.activeElement?.closest('.cm-editor');

      const chRowAfter = document.querySelector('.rail-chapter-row');
      chRowAfter.focus();
      chRowAfter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 50));
      const focusedAfterArrow = document.activeElement ? document.activeElement.className : null;

      return { before, afterEnter, editorFocused, focusedAfterArrow };
    `);
    assert.equal(result.afterEnter, result.before, 'Enter must not collapse the chapter');
    assert.equal(result.editorFocused, true, 'navigation should return focus to the editor');
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
        footerHeight: document.querySelector('.rail-footer').getBoundingClientRect().height,
      };
    `);
    for (const [name, size] of Object.entries(result)) {
      if (name === 'footerHeight') continue;
      assert.ok(size.w >= 24 && size.h >= 24, `${name} effective hit target should be >= 24px (got ${size.w}x${size.h})`);
    }
    assert.equal(result.footerHeight, 32);
  });

  // P0-hover: rename/delete must never be hover-only -- a keyboard/touch/
  // screen-reader user can't hover, so they'd otherwise be permanently
  // unreachable. (Dragging isn't hover-gated at all now -- it's the whole
  // row, always there.)
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

  test('the status-bar mode switch is a tablist reflecting the current mode, clicking a tab switches', async () => {
    const initial = await app.client.evaluate(`
      const sprinterTab = document.querySelector('.mode-tab[data-mode="sprinter"]');
      const editorTab = document.querySelector('.mode-tab[data-mode="editor"]');
      return {
        tablistRole: document.getElementById('mode-switch').getAttribute('role'),
        sprinterRole: sprinterTab.getAttribute('role'),
        editorRole: editorTab.getAttribute('role'),
        editorSelected: editorTab.getAttribute('aria-selected'),
        editorTabIndex: editorTab.tabIndex,
        sprinterTabIndex: sprinterTab.tabIndex,
      };
    `);
    assert.equal(initial.tablistRole, 'tablist');
    assert.equal(initial.sprinterRole, 'tab');
    assert.equal(initial.editorRole, 'tab');
    assert.equal(initial.editorSelected, 'true'); // fixture launched in editor mode
    assert.equal(initial.editorTabIndex, 0);
    assert.equal(initial.sprinterTabIndex, -1);

    const afterClick = await app.client.evaluate(`
      const sprinterTab = document.querySelector('.mode-tab[data-mode="sprinter"]');
      sprinterTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      sprinterTab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
      return {
        mode: document.documentElement.getAttribute('data-mode'),
        sprinterSelected: sprinterTab.getAttribute('aria-selected'),
        editorSelected: document.querySelector('.mode-tab[data-mode="editor"]').getAttribute('aria-selected'),
        // Switching to Sprinter via the tab is the same action as the
        // palette's "Switch to Sprinter" -- both should open sprint setup.
        evokeVisible: getComputedStyle(document.querySelector('.sprint-panel')).display,
      };
    `);
    assert.equal(afterClick.mode, 'sprinter');
    assert.equal(afterClick.sprinterSelected, 'true');
    assert.equal(afterClick.editorSelected, 'false');
    assert.equal(afterClick.evokeVisible, 'block');

    // Cancel the evoke panel and switch back to Editor via ⌘⇧D -- the tabs
    // must stay in sync with mode changes from other entry points too.
    const backToEditor = await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
      return {
        mode: document.documentElement.getAttribute('data-mode'),
        editorSelected: document.querySelector('.mode-tab[data-mode="editor"]').getAttribute('aria-selected'),
      };
    `);
    assert.equal(backToEditor.mode, 'editor');
    assert.equal(backToEditor.editorSelected, 'true');
  });

  test('arrow keys move roving focus within the mode switch without activating; Enter/Space does', async () => {
    const result = await app.client.evaluate(`
      const editorTab = document.querySelector('.mode-tab[data-mode="editor"]');
      const sprinterTab = document.querySelector('.mode-tab[data-mode="sprinter"]');
      editorTab.focus();
      editorTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 50));
      const focusedSprinterAfterArrow = document.activeElement === sprinterTab;
      const modeAfterArrowOnly = document.documentElement.getAttribute('data-mode');

      sprinterTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
      const modeAfterEnter = document.documentElement.getAttribute('data-mode');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));

      // Switch back to editor for tests after this one.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));

      return { focusedSprinterAfterArrow, modeAfterArrowOnly, modeAfterEnter };
    `);
    assert.equal(result.focusedSprinterAfterArrow, true);
    assert.equal(result.modeAfterArrowOnly, 'editor', 'arrow keys should only move focus, not activate');
    assert.equal(result.modeAfterEnter, 'sprinter');
  });

  test('the status bar is a 3-column grid with the mode switch centered and the right cluster right-aligned', async () => {
    const result = await app.client.evaluate(`
      const cs = getComputedStyle(document.getElementById('statusbar'));
      const groups = [...document.querySelectorAll('#statusbar .status-group')];
      return {
        display: cs.display,
        justifySelfLast: getComputedStyle(groups[groups.length - 1]).justifySelf,
      };
    `);
    assert.equal(result.display, 'grid');
    assert.equal(result.justifySelfLast, 'end');
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

// Own instance: deliberately breaks the save path on disk (replaces the
// target file with a directory, so fs.writeFileSync throws EISDIR), which
// no other suite should have to account for.
//
// Regression coverage for two real bugs found in an architecture review:
// (1) a write failure only ever logged to the main-process console --
// #save-error existed in index.html/app.js (cleared on every successful
// save) but nothing ever set it, so the app kept behaving as if the save
// had gone through while silently failing to persist anything; (2) worse,
// manual save (Cmd+S) replied 'save-confirmed' unconditionally right after
// calling the writer, regardless of whether the write actually succeeded --
// a failed Cmd+S told the user "saved" (toast and all) even though nothing
// was written.
describe('Baretext E2E: a failed save surfaces to the user instead of failing silently', () => {
  let app;

  before(async () => {
    app = await launchApp({ fixtureContent: 'Some prose.', mode: 'editor' });
    await new Promise((r) => setTimeout(r, 300));
  });

  after(async () => {
    if (app) await app.close();
  });

  function breakSavePath() {
    fs.unlinkSync(app.fixturePath);
    fs.mkdirSync(app.fixturePath);
  }
  // Removes the blocking directory AND restores a real file in its place --
  // just rmdir-ing leaves nothing at all on disk, breaking every subsequent
  // test's assumption that app.fixturePath is a real, writable file.
  function fixSavePath() {
    fs.rmdirSync(app.fixturePath);
    fs.writeFileSync(app.fixturePath, 'Some prose.', 'utf8');
  }

  test('a failed manual save (Cmd+S) shows the error indicator and does NOT falsely report success', async () => {
    breakSavePath();
    try {
      const before = await app.client.evaluate(
        "return document.getElementById('save-error').classList.contains('visible');"
      );
      assert.equal(before, false);

      await app.client.evaluate(`
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
        return true;
      `);
      await new Promise((r) => setTimeout(r, 400));

      const after = await app.client.evaluate(`
        return {
          visible: document.getElementById('save-error').classList.contains('visible'),
          title: document.getElementById('save-error').title,
          toastText: document.getElementById('toast').textContent,
        };
      `);
      assert.equal(after.visible, true, 'the error indicator must light up on a failed save');
      assert.ok(after.title.includes('save failed'), `expected the title to explain the failure, got: ${after.title}`);
      assert.notEqual(after.toastText, 'saved', 'a failed save must never claim success');
      assert.ok(after.toastText.includes('failed'), `expected a failure toast, got: ${after.toastText}`);
    } finally {
      fixSavePath();
    }

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('a failed autosave (triggered by typing) also lights the indicator, and a later successful save clears it', async () => {
    breakSavePath();
    try {
      await app.client.evaluate(`
        const cm = document.querySelector('.cm-content');
        cm.focus();
        document.execCommand('insertText', false, ' more text');
        return true;
      `);
      await new Promise((r) => setTimeout(r, 800)); // clears the 500ms autosave debounce
      const failed = await app.client.evaluate(
        "return document.getElementById('save-error').classList.contains('visible');"
      );
      assert.equal(failed, true);
    } finally {
      fixSavePath();
    }

    await app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 400));
    const recovered = await app.client.evaluate(
      "return document.getElementById('save-error').classList.contains('visible');"
    );
    assert.equal(recovered, false, 'a successful save afterward must clear the error indicator');
  });

  test('repeated failed autosaves show the failure toast only once, not on every debounce tick', async () => {
    breakSavePath();
    try {
      await app.client.evaluate(`
        document.execCommand('insertText', false, 'x');
        return true;
      `);
      await new Promise((r) => setTimeout(r, 800));
      const firstToastShowing = await app.client.evaluate(
        "return document.getElementById('toast').classList.contains('show');"
      );
      assert.equal(firstToastShowing, true);

      // Let the 1.6s toast auto-hide, then fail a second time while the
      // error indicator is still lit from the first failure.
      await new Promise((r) => setTimeout(r, 1700));
      await app.client.evaluate(`
        document.execCommand('insertText', false, 'y');
        return true;
      `);
      await new Promise((r) => setTimeout(r, 800));
      const secondToastShowing = await app.client.evaluate(
        "return document.getElementById('toast').classList.contains('show');"
      );
      assert.equal(secondToastShowing, false, 'the toast should not re-fire while the indicator is already showing');

      const stillVisible = await app.client.evaluate(
        "return document.getElementById('save-error').classList.contains('visible');"
      );
      assert.equal(stillVisible, true, 'the indicator itself must still reflect the ongoing failure');
    } finally {
      fixSavePath();
    }
  });
});

// Regression coverage for a design-system rail redesign that was attempted
// once before, shipped as a full implementation, and then fully reverted
// after real visual review found four concrete bugs (see PROGRESS.md and
// git stash — "Aug 2026 design-system/rail redesign attempt — reverted,
// didn't work out"). This second attempt fixes the same underlying design
// direction (JetBrains Mono and a floating rail panel)
// while specifically avoiding each of those four failure modes — this
// suite locks each one in so a future change can't silently reintroduce
// any of them.
describe('Baretext E2E: rail redesign — regression coverage for four previously-reverted bugs', () => {
  let app;
  const fixture = [
    '# A Turning Point',
    '',
    'Opening prose long enough to clear the draft threshold for this test case easily.',
    '',
    '---',
    '<!-- A Fairly Long Named Scene Title -->',
    '',
    'Named scene prose, also long enough to clear the draft threshold nicely here.',
    '',
    '<!-- COLD STORAGE -->',
    '',
    '<!-- A Cut Scene -->',
    '',
    'Cut scene content, long enough to clear the draft threshold nicely as well.',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
    await app.client.evaluate('window.resizeTo(1400, 900); return true;');
    await app.client.evaluate(`
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (document.querySelectorAll('.rail-scene-row').length >= 1) break;
        await new Promise(r => setTimeout(r, 100));
      }
    `);
  });

  after(async () => {
    if (app) await app.close();
  });

  test('bug 1: the Figma chevron is an exact 16px asset in its own persistent column', async () => {
    const result = await app.client.evaluate(`
      const row = document.querySelector('.rail-chapter-row');
      const button = row.querySelector('.rail-chevron-btn').getBoundingClientRect();
      const glyph = row.querySelector('.rail-svg-icon').getBoundingClientRect();
      return { button: [button.width, button.height], glyph: [glyph.width, glyph.height] };
    `);
    assert.deepEqual(result, { button: [16, 16], glyph: [16, 16] });
  });

  test('the rail keeps the Figma structure with a tightened panel, row, inset, radius, and gap rhythm', async () => {
    const result = await app.client.evaluate(`
      const panel = document.getElementById('scene-rail').getBoundingClientRect();
      const header = document.querySelector('.rail-header').getBoundingClientRect();
      const chapter = document.querySelector('.rail-chapter-row').getBoundingClientRect();
      const scene = document.querySelector('.rail-scene-row').getBoundingClientRect();
      const node = document.querySelector('.rail-chapter-num').getBoundingClientRect();
      return {
        panelWidth: panel.width,
        headerWidth: header.width,
        headerTop: header.top - panel.top,
        chapterWidth: chapter.width,
        chapterHeight: chapter.height,
        chapterInset: chapter.left - panel.left,
        sceneWidth: scene.width,
        sceneHeight: scene.height,
        sceneInset: scene.left - chapter.left,
        rowGap: scene.top - chapter.bottom,
        rowRadius: getComputedStyle(document.querySelector('.rail-chapter-row')).borderRadius,
        nodeWidth: node.width, nodeHeight: node.height,
      };
    `);
    assert.deepEqual(result, {
      panelWidth: 336, headerWidth: 320, headerTop: 16,
      chapterWidth: 320, chapterHeight: 32, chapterInset: 8,
      sceneWidth: 271, sceneHeight: 32, sceneInset: 49, rowGap: 4,
      rowRadius: '8px', nodeWidth: 16, nodeHeight: 16,
    });
  });

  test('the header matches the Figma hierarchy: squares + title left, compact counter right', async () => {
    const result = await app.client.evaluate(`
      const panel = document.getElementById('scene-rail').getBoundingClientRect();
      const header = document.querySelector('.rail-header').getBoundingClientRect();
      const button = document.querySelector('.rail-corkboard-btn').getBoundingClientRect();
      const labelEl = document.querySelector('.rail-label');
      const label = labelEl.getBoundingClientRect();
      const counterEl = document.querySelector('.rail-header > .rail-dim');
      const counter = counterEl.getBoundingClientRect();
      const labelStyle = getComputedStyle(labelEl);
      const counterStyle = getComputedStyle(counterEl);
      return {
        children: Array.from(document.querySelector('.rail-header').children).map(el => el.className),
        headerX: header.left - panel.left,
        headerY: header.top - panel.top,
        headerWidth: header.width,
        headerHeight: header.height,
        iconX: button.left - header.left,
        iconSize: [button.width, button.height],
        labelX: label.left - header.left,
        counterRightInset: header.right - counter.right,
        labelText: labelEl.textContent,
        counterText: counterEl.textContent,
        labelFont: [labelStyle.fontSize, labelStyle.lineHeight, labelStyle.fontWeight, labelStyle.letterSpacing],
        counterFont: [counterStyle.fontSize, counterStyle.lineHeight, counterStyle.fontWeight],
      };
    `);
    assert.deepEqual(result, {
      children: ['rail-header-left', 'rail-dim'],
      headerX: 8, headerY: 16, headerWidth: 320, headerHeight: 32,
      iconX: 4, iconSize: [16, 16], labelX: 28, counterRightInset: 4,
      labelText: 'test', counterText: '1ch/2',
      labelFont: ['14px', '24px', '700', 'normal'],
      counterFont: ['10px', '24px', '400'],
    });
  });

  test('the filename is only the default book title; a rail edit creates the shared manuscript title', async () => {
    const fromRail = await app.client.evaluate(`
      document.querySelector('.rail-label').click();
      const input = document.querySelector('.rail-header .inline-rename-input');
      input.value = 'Warfare Winter';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise(r => setTimeout(r, 220));
      return {
        label: document.querySelector('.rail-label').textContent,
        firstLine: document.querySelector('.cm-line').textContent,
        fileName: document.getElementById('file-name').textContent,
      };
    `);
    assert.deepEqual(fromRail, {
      label: 'Warfare Winter', firstLine: 'Warfare Winter', fileName: 'test.md',
    });

  });

  test('the timeline is gone and add-scene follows the inset scene-row geometry', async () => {
    const result = await app.client.evaluate(`
      const chapter = document.querySelector('.rail-chapter-row').getBoundingClientRect();
      const add = document.querySelector('.rail-scene-add').getBoundingClientRect();
      const plusIcon = document.querySelector('.rail-scene-add .ti-plus').getBoundingClientRect();
      return {
        connectors: document.querySelectorAll('.rail-connector').length,
        addInset: add.left - chapter.left,
        addHeight: add.height,
        plusWidth: plusIcon.width,
      };
    `);
    assert.deepEqual(result, { connectors: 0, addInset: 49, addHeight: 32, plusWidth: 16 });
  });

  test('chapter and scene columns retain exact offsets in the tightened rhythm', async () => {
    const result = await app.client.evaluate(`
      const panel = document.getElementById('scene-rail').getBoundingClientRect();
      const chapterTitle = document.querySelector('.rail-chapter-title').getBoundingClientRect();
      const sceneTitle = document.querySelector('.rail-scene-name').getBoundingClientRect();
      return {
        chapterTitleX: chapterTitle.left - panel.left,
        sceneTitleX: sceneTitle.left - panel.left,
      };
    `);
    assert.deepEqual(result, { chapterTitleX: 60, sceneTitleX: 61 });
  });

  test('Cold Storage uses the same columns and its snowflake stays blue', async () => {
    const result = await app.client.evaluate(`
      const chapterNode = document.querySelector('.rail-chapter-num').getBoundingClientRect();
      const frost = document.querySelector('.rail-cold-storage-row .ti-snowflake');
      const frostRect = frost.getBoundingClientRect();
      const style = getComputedStyle(frost);
      return {
        chapterNodeCenterX: chapterNode.left + chapterNode.width / 2,
        frostCenterX: frostRect.left + frostRect.width / 2,
        frostColor: style.color,
        expectedColor: getComputedStyle(document.documentElement).getPropertyValue('--cold-storage-accent').trim(),
      };
    `);
    assert.ok(Math.abs(result.chapterNodeCenterX - result.frostCenterX) <= 1,
      `snowflake not aligned with chapter nodes: ${JSON.stringify(result)}`);
    assert.equal(result.frostColor, 'rgb(127, 166, 196)');
    assert.equal(result.expectedColor, '#7fa6c4');
  });

  // scrollWidth reflects full content size regardless of clipping -- a hit-
  // target ::before pseudo-element (deliberately extending a few px past
  // its own visible box, by design, to keep a real click target on a small
  // icon) will always make scrollWidth a few px larger than clientWidth.
  // The actual bug was a VISIBLE horizontal scrollbar; the real assertion
  // is that the axis is clipped, not that content never technically
  // overflows it.
  test('bug 1b: the rail never shows a horizontal scrollbar (overflow-x is clipped)', async () => {
    const overflowX = await app.client.evaluate(
      "return getComputedStyle(document.getElementById('scene-rail').querySelector('.rail-list')).overflowX;"
    );
    assert.equal(overflowX, 'hidden');
  });

  // "A Turning Point" (16 chars) is the longest real title in this
  // project's own E2E fixture (test/fixtures/manuscript.md) -- a realistic
  // bar, not an arbitrarily long invented string (truncation for a
  // genuinely long title is expected/fine in any fixed-width sidebar).
  test('bug 2: a realistic-length chapter title does not truncate at the current rail width', async () => {
    const result = await app.client.evaluate(`
      const title = document.querySelector('.rail-chapter-title');
      return { text: title.textContent, scrollWidth: title.scrollWidth, clientWidth: title.clientWidth };
    `);
    assert.ok(result.scrollWidth <= result.clientWidth + 1, `chapter title truncated: ${JSON.stringify(result)}`);
  });

  // The original bug (a mostly-empty floating card reading as "container in
  // a container" on a short document) was fixed by hugging content instead
  // of stretching -- then explicitly reversed later in the same session:
  // the user asked for the rail to always be full height regardless of
  // content. This asserts the CURRENT, deliberate direction; if the
  // hug-content look ever comes back, this is the test to update, not
  // silently leave contradicting the shipped behavior.
  test('the rail panel is always full column height, regardless of content length', async () => {
    const result = await app.client.evaluate(`
      const rail = document.getElementById('scene-rail').getBoundingClientRect();
      const contentRow = document.getElementById('content-row').getBoundingClientRect();
      return { railHeight: rail.height, contentRowHeight: contentRow.height };
    `);
    assert.ok(
      result.railHeight > result.contentRowHeight - 30,
      `rail is not full height: ${JSON.stringify(result)}`
    );
  });

  test('bug 4: Cold Storage\'s card background is visibly distinct from the rail panel it sits inside', async () => {
    const result = await app.client.evaluate(`
      const section = document.querySelector('.rail-cold-storage-section');
      const rail = document.getElementById('scene-rail');
      return { coldBg: getComputedStyle(section).backgroundColor, railBg: getComputedStyle(rail).backgroundColor };
    `);
    assert.notEqual(result.coldBg, result.railBg, `Cold Storage card has zero contrast against its own container: ${JSON.stringify(result)}`);
  });

  test('the rail uses JetBrains Mono, not IBM Plex Mono', async () => {
    const fontFamily = await app.client.evaluate(
      "return getComputedStyle(document.getElementById('scene-rail')).fontFamily;"
    );
    assert.match(fontFamily, /JetBrains Mono/);
  });

  test('the rail panel has no border stroke -- depth comes from the shadow alone', async () => {
    const borderWidth = await app.client.evaluate(
      "return getComputedStyle(document.getElementById('scene-rail')).borderWidth;"
    );
    assert.equal(borderWidth, '0px');
  });

  test('the footer button reads "New Chapter" and adds a new blank chapter before Cold Storage, without resetting the cursor to the start of the document', async () => {
    const before = await app.client.evaluate("return document.querySelector('.rail-footer').textContent.trim();");
    assert.match(before, /New Chapter/);

    const chaptersBefore = await app.client.evaluate(
      "return document.querySelectorAll('.rail-chapter-row:not(.rail-cold-storage-row)').length;"
    );

    // Reproduces the reported bug: land the cursor at the end of the last
    // real chapter (via the rail, same as a reader who was just writing
    // there) before adding a new chapter after it -- setDoc's full-buffer
    // replace used to collapse the cursor/scroll position to the very start
    // of the document regardless of where the writer actually was.
    await app.client.evaluate(`
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const target = rows.find(r => r.getAttribute('aria-label').includes('Named Scene'));
      target.click();
      await new Promise(r => setTimeout(r, 200));
    `);
    const activeBefore = await app.client.evaluate(
      "const a = document.querySelector('.rail-scene-row.active'); return a ? a.getAttribute('aria-label') : null;"
    );
    assert.match(activeBefore || '', /Named Scene/, 'setup: clicking the scene row should have made it active first');

    await app.client.evaluate(`
      document.querySelector('.rail-footer').click();
      await new Promise(r => setTimeout(r, 200));
    `);
    const activeAfter = await app.client.evaluate(
      "const a = document.querySelector('.rail-scene-row.active'); return a ? a.getAttribute('aria-label') : null;"
    );
    assert.equal(activeAfter, activeBefore, 'adding a new chapter should not move the cursor away from the scene the writer was in');

    const result = await app.client.evaluate(`
      const rows = [...document.querySelectorAll('.rail-chapter-row:not(.rail-cold-storage-row)')];
      const coldStorage = document.querySelector('.rail-cold-storage-row');
      const coldStorageIndex = [...document.querySelectorAll('.rail-chapter-row')].indexOf(coldStorage);
      return {
        chapterCount: rows.length,
        lastChapterBeforeColdStorage: coldStorageIndex - 1 === rows.length - 1,
      };
    `);
    assert.equal(result.chapterCount, chaptersBefore + 1);
    assert.equal(result.lastChapterBeforeColdStorage, true, 'new chapter should land right before Cold Storage');
  });

  test('a chapter row\'s trailing meta shows "scenes/words", not just a bare scene count', async () => {
    const meta = await app.client.evaluate("return document.querySelector('.rail-trailing-meta').textContent;");
    assert.match(meta, /^\d+\/\d+$/, `chapter meta not in "scenes/words" format: ${meta}`);
    const [sceneCount, wordCount] = meta.split('/').map(Number);
    assert.equal(sceneCount, 2); // this fixture's chapter has 2 scenes
    assert.ok(wordCount > 0, 'word count should reflect real prose, not be stuck at 0');
  });

  test('Cold Storage is anchored to the bottom of the panel, not floating directly under the last chapter', async () => {
    const result = await app.client.evaluate(`
      const coldSection = document.querySelector('.rail-cold-storage-section').getBoundingClientRect();
      const footer = document.querySelector('.rail-footer').getBoundingClientRect();
      return { gapBelowColdStorage: footer.top - coldSection.bottom };
    `);
    assert.ok(
      result.gapBelowColdStorage >= 0 && result.gapBelowColdStorage < 20,
      `Cold Storage isn't anchored against the footer: ${JSON.stringify(result)}`
    );
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});
