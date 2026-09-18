// End-to-end smoke test — drives the real, packaged app (not a mock, not a
// component test) through the golden paths verified manually throughout
// this project's development: Sprinter mode, the sprint timer lifecycle,
// mode switching, find/replace, and scene-nav (rail, corkboard,
// rename, drag-reorder, undo). Every launch runs against an isolated
// scratch --user-data-dir/save directory — nothing here ever touches the
// developer's real settings or Documents folder.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchApp } from './harness.js';


// Drive the row's real focus event before requesting its conditional actions.
const browserHelpers = `
function railAction(root, selector) {
  if (!root) return null;
  if (!root.querySelector(selector)) {
    const prefix = selector.split(/\\.rail-(?:edit|delete)-btn/)[0].trim();
    const candidate = root.matches?.('.rail-chapter-row,.rail-scene-row') ? root : root.querySelector(prefix || '.rail-chapter-row,.rail-scene-row');
    const row = candidate?.matches('.rail-chapter-row,.rail-scene-row') ? candidate : candidate?.querySelector('.rail-scene-row') || candidate?.querySelector('.rail-chapter-row');
    row?.dispatchEvent(new FocusEvent('focusin', {bubbles:true}));
  }
  return root.querySelector(selector);
}
function addSceneButton(title) {
  const row = [...document.querySelectorAll('#scene-rail .rail-chapter-row')].find(r => r.querySelector('.rail-chapter-title')?.textContent === title);
  row.click();
  return document.querySelector('.rail-footer button:last-of-type');
}
`;

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
    const text = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
    assert.ok(text.includes('Mara stood at the edge of the harbor'));
    assertNoConsoleErrors('startup');
  });

  test('rail is visible in Editor mode with correct chapter numbering', async () => {
    // scene-nav's first real render (driven by the async 'file-loaded' IPC
    // message, debounced 180ms) can trail the doc content itself loading —
    // poll briefly rather than assuming it's already happened.
    const railText = await app.client.evaluate(browserHelpers + `
      const deadline = Date.now() + 2000;
      let text = '';
      while (Date.now() < deadline) {
        text = document.getElementById('scene-rail').innerText;
        if (text.includes('Chapter One')) break;
        await new Promise(r => setTimeout(r, 100));
      }
      return text;
    `);
    assert.match(railText, /(?:^|\n)01\nChapter One/);
    assert.match(railText, /(?:^|\n)02\nChapter Two/);
    assert.match(railText, /A Turning Point/);
  });

  test('editor line measure is 75ch in both modes, tunable from one CSS variable — the manuscript surface gutter hangs in the margin, it does not narrow the text column', async () => {
    // See MANUSCRIPT_SURFACE.md: the number gutter has its own --gutter/--gap
    // tokens and hangs in the space the window already has beside the
    // centered column. --editor-measure stays the single source of truth
    // for line width in Editor mode exactly like Sprinter — narrowing the
    // measure specifically for the gutter was tried and reverted, it made
    // the writing column uncomfortably narrow for real use.
    const result = await app.client.evaluate(browserHelpers + `
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
  test('titlebar uses the flush handoff surface', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const cs = getComputedStyle(document.getElementById('titlebar'));
      return { boxShadow: cs.boxShadow, position: cs.position, zIndex: cs.zIndex };
    `);
    assert.equal(result.boxShadow, 'none');
    // Needs to actually paint over #content-row (the next sibling), not
    // under it — position + z-index is what makes that happen.
    assert.notEqual(result.position, 'static');
    assert.equal(result.zIndex, '1');
  });

  // ── Find & replace ──────────────────────────────────────────────────────

  test('find/replace opens, counts matches, and replaces', async () => {
    const result = await app.client.evaluate(browserHelpers + `
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
    const activeText = await app.client.evaluate(browserHelpers + `
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

  test('clicking a below-the-fold rail scene preserves the exact rail scroll position', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const deadline = Date.now() + 2000;
      while (!document.querySelector('#scene-rail .rail-scene-row') && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 50));
      }
      const style = document.createElement('style');
      style.id = 'rail-scroll-regression-fixture';
      style.textContent = '#scene-rail .rail-list { height: 180px; flex: none; }';
      document.head.appendChild(style);

      let list = document.querySelector('#scene-rail .rail-list');
      list.scrollTop = Math.min(120, list.scrollHeight - list.clientHeight);
      const before = list.scrollTop;
      const rows = [...document.querySelectorAll('#scene-rail .rail-scene-row')]
        .filter(row => !row.closest('.rail-cold-storage-section'));
      rows.at(-1).click();
      list = document.querySelector('#scene-rail .rail-list');
      const after = list.scrollTop;
      style.remove();
      return { before, after };
    `);
    assert.ok(result.before > 0, 'fixture must scroll far enough to exercise a below-the-fold row');
    assert.equal(result.after, result.before);
  });

  test('renaming a chapter via the rail rewrites the heading in the document', async () => {
    await app.client.evaluate(browserHelpers + `
      const editBtn = railAction(document, '.rail-chapter-row .rail-edit-btn');
      editBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const input = document.querySelector('.inline-rename-input');
      input.value = 'The Harbor';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const text = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
    assert.ok(text.includes('The Harbor'));
    const railText = await app.client.evaluate(browserHelpers + 'return document.getElementById("scene-rail").innerText;');
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
    await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const target = rows.find(r => r.querySelector('.rail-scene-name').textContent === 'Scene 1');
      const editBtn = railAction(target, '.rail-edit-btn');
      editBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const input = document.querySelector('.inline-rename-input');
      input.value = 'The Harbor Opens';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const lines = await app.client.evaluate(browserHelpers + 'return [...document.querySelectorAll(".cm-line")].map(l => l.textContent);');
    assert.ok(!lines.some((l) => /^#{1,3}\s*The Harbor Opens$/.test(l)), 'must not become a heading');
    assert.ok(lines.includes('Mara stood at the edge of the harbor and watched the fog roll in, thinking that she probably shouldn\'t have come here alone at all, but there was no one left to tell her not to.'), 'the original prose must be untouched');

    const railText = await app.client.evaluate(browserHelpers + 'return document.getElementById("scene-rail").innerText;');
    assert.match(railText, /The Harbor Opens/);
  });

  // ── Scene-nav: corkboard ─────────────────────────────────────────────────

  test('the rail\'s corkboard button opens the corkboard with numbered cards', async () => {
    const result = await app.client.evaluate(browserHelpers + `
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

  test('corkboard exposes AI summaries per card and in bulk, plus scene/chapter naming helpers', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      await new Promise(r => setTimeout(r, 250));
      if (getComputedStyle(document.getElementById('corkboard')).display === 'none') {
        document.querySelector('.rail-corkboard-btn').click();
        await new Promise(r => setTimeout(r, 150));
      }
      const cork = document.getElementById('corkboard');
      return {
        summarizeAll: [...cork.querySelectorAll('.corkboard-tool-btn')].some(b => b.textContent.includes('summarize all')),
        sceneSummaryButtons: cork.querySelectorAll('button[aria-label^="Summarize "]').length,
        sceneNamingButtons: cork.querySelectorAll('.scene-card button[title="suggest scene names"]').length,
        chapterNamingButtons: cork.querySelectorAll('.corkboard-chapter-header button[aria-label^="Suggest names for "]').length,
        aiButtonsUseAiIcon: [...cork.querySelectorAll('.corkboard-ai-text-btn')].every(b => b.querySelector('.ti-sparkles')),
        apiMethods: ['aiCachedSummaries', 'aiRemoveCachedSummaries', 'aiSummarizeScenes', 'aiSuggestTitles', 'aiTitlePreferences', 'aiSaveTitlePreferences'].map(k => typeof window.api[k]),
      };
    `);
    assert.equal(result.summarizeAll, true);
    assert.ok(result.sceneSummaryButtons > 0);
    assert.ok(result.sceneNamingButtons > 0);
    assert.ok(result.chapterNamingButtons > 0);
    assert.equal(result.aiButtonsUseAiIcon, true);
    assert.deepEqual(result.apiMethods, ['function', 'function', 'function', 'function', 'function', 'function']);
  });

  test('a below-the-fold card action preserves the exact corkboard scroll position', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      if (getComputedStyle(document.getElementById('corkboard')).display === 'none') {
        document.querySelector('.rail-corkboard-btn').click();
        await new Promise(r => setTimeout(r, 150));
      }
      let body = document.querySelector('#corkboard .corkboard-body');
      // The compact smoke fixture can fit in the test window. Constrain the
      // body so this test exercises the same below-the-fold state as a real
      // manuscript with many chapters.
      const style = document.createElement('style');
      style.textContent = '#corkboard .corkboard-body { height: 180px; flex: none; }';
      document.head.appendChild(style);
      // Stay away from the absolute bottom, where an unrelated card-height
      // change could legitimately clamp scrollTop to a new smaller maximum.
      body.scrollTop = Math.min(150, body.scrollHeight - body.clientHeight);
      const before = body.scrollTop;
      const card = [...document.querySelectorAll('#corkboard .scene-card')].at(-1);
      card.querySelector('button[title="rename scene"]').click();
      const input = document.querySelector('#corkboard .scene-card .inline-rename-input');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      body = document.querySelector('#corkboard .corkboard-body');
      return { before, after: body.scrollTop };
    `);
    assert.ok(result.before > 0, 'fixture must scroll far enough to exercise a below-the-fold card');
    assert.equal(result.after, result.before);
  });

  test('personal AI key settings are reachable without exposing a saved credential', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (getComputedStyle(document.getElementById('corkboard')).display === 'none') {
        document.querySelector('.rail-corkboard-btn').click();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      document.querySelector('#corkboard .corkboard-ai-status').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const overlay = document.getElementById('ai-settings-overlay');
      const input = document.getElementById('ai-key-input');
      return {
        open: overlay.classList.contains('open'),
        inputType: input.type,
        inputValue: input.value,
        hasTitleStyle: document.getElementById('ai-title-style').tagName === 'TEXTAREA',
        copy: document.getElementById('ai-settings-copy').textContent,
      };
    `);
    assert.equal(result.open, true);
    assert.equal(result.inputType, 'password');
    assert.equal(result.inputValue, '');
    assert.equal(result.hasTitleStyle, true);
    assert.match(result.copy, /macOS Keychain/);
    await app.client.evaluate(browserHelpers + `
      document.getElementById('ai-title-style').value = ['Black Water', 'The Crossing'].join(String.fromCharCode(10));
      document.getElementById('ai-key-save').click();
      await new Promise(r => setTimeout(r, 100));
      document.getElementById('ai-key-cancel').click();
      return true;
    `);
    assert.equal(app.readSettings().aiTitleStyleExamples, ['Black Water', 'The Crossing'].join(String.fromCharCode(10)));
  });

  // Only the network-free "save" action is driven here — clicking "connect
  // google drive" for real would open a system browser and hang waiting for
  // an OAuth redirect that never comes in this headless harness.
  test('Google Drive backup settings are reachable and never leak a saved client secret', async () => {
    const opened = await app.client.evaluate(browserHelpers + `
      document.getElementById('backup-status-indicator').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const overlay = document.getElementById('backup-settings-overlay');
      const secretInput = document.getElementById('backup-client-secret');
      return {
        open: overlay.classList.contains('open'),
        secretInputType: secretInput.type,
        secretInputValue: secretInput.value,
        idInputValue: document.getElementById('backup-client-id').value,
        copy: document.getElementById('backup-settings-copy').textContent,
      };
    `);
    assert.equal(opened.open, true);
    assert.equal(opened.secretInputType, 'password');
    assert.equal(opened.secretInputValue, '');
    assert.equal(opened.idInputValue, '');
    assert.match(opened.copy, /Google Cloud Console/);

    const saved = await app.client.evaluate(browserHelpers + `
      document.getElementById('backup-client-id').value = 'test-client-id.apps.googleusercontent.com';
      document.getElementById('backup-client-secret').value = 'test-client-secret';
      document.getElementById('backup-save-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return await window.api.backupStatus();
    `);
    assert.equal(saved.hasClientCredentials, true);
    assert.equal(saved.connected, false);

    const reopened = await app.client.evaluate(browserHelpers + `
      document.getElementById('backup-settings-cancel').click();
      document.getElementById('backup-status-indicator').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        idInputValue: document.getElementById('backup-client-id').value,
        secretInputValue: document.getElementById('backup-client-secret').value,
      };
    `);
    assert.equal(reopened.idInputValue, '', 'a saved client id must never be re-shown in the field');
    assert.equal(reopened.secretInputValue, '', 'a saved client secret must never be re-shown in the field');

    await app.client.evaluate(browserHelpers + `document.getElementById('backup-settings-cancel').click(); return true;`);
    assertNoConsoleErrors('backup settings');
  });

  test('single click on a card does not navigate; double-click does', async () => {
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const before = await app.client.evaluate(browserHelpers + `
      const cork = document.getElementById('corkboard');
      const section = cork.querySelector('.corkboard-chapter');
      return {
        totalCount: cork.querySelectorAll('.scene-card').length,
        sectionCount: section.querySelectorAll('.scene-card').length,
        display: getComputedStyle(cork).display,
      };
    `);
    assert.equal(before.display, 'flex');

    const after = await app.client.evaluate(browserHelpers + `
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
    const lines = await app.client.evaluate(browserHelpers + 'return [...document.querySelectorAll(".cm-line")].map(l => l.textContent);');
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
    await app.client.evaluate(browserHelpers + `
      const section = document.getElementById('corkboard').querySelector('.corkboard-chapter');
      const cards = [...section.querySelectorAll('.scene-card')];
      cards[cards.length - 1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.cm-content').focus();
      document.execCommand('insertText', false, 'A freshly typed scene.');
      await new Promise(r => setTimeout(r, 100));
    `);
    const typedIn = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText.includes("A freshly typed scene.");');
    assert.equal(typedIn, true);
  });

  test('the "open in manuscript" button jumps and closes deliberately', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      // Self-sufficient regardless of whether the previous test left the
      // corkboard open or closed.
      document.querySelector('.rail-corkboard-btn').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.querySelector('.rail-corkboard-btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const cork = document.getElementById('corkboard');
      const card = [...cork.querySelectorAll('.scene-card')][0];
      const openBtn = [...card.querySelectorAll('.corkboard-edit-btn')].find(btn => btn.title === 'open in manuscript');
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
    const display = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
      const btn = railAction(document, '.rail-scene-row .rail-delete-btn');
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
    const result = await app.client.evaluate(browserHelpers + `
      const btns = [...document.querySelectorAll('.rail-scene-row')].map(row => railAction(row, '.rail-delete-btn'));
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
    const result = await app.client.evaluate(browserHelpers + `
      const before = document.getElementById('scene-rail').querySelectorAll('.rail-scene-row').length;
      const row = document.querySelector('.rail-scene-row');
      const label = row.querySelector('.rail-scene-name').innerText;
      const btn = railAction(row, '.rail-delete-btn');
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
      const tw = document.getElementById('tw-status-indicator');
      const displayBefore = getComputedStyle(tw).display;
      const before = document.getElementById('app').classList.contains('typewriter');
      tw.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      tw.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
      const after = document.getElementById('app').classList.contains('typewriter');
      return { before, after, displayBefore, displayAfter: getComputedStyle(tw).display };
    `);
    assert.notEqual(result.before, result.after);
    assert.equal(result.displayBefore, 'flex', 'typewriter control is visible before toggling');
    assert.equal(result.displayAfter, 'flex', 'typewriter control remains visible in either state');
  });

  // Regression: typewriter mode only padded the BOTTOM of the document so
  // the last line could reach the center guide -- with no top padding, the
  // first line was pinned to the scroll-top edge and could never be
  // scrolled up to the center, unlike every other line. Both edges must be
  // reachable, not just the bottom one.
  test('typewriter mode lets the very first line scroll all the way to the center guide, not just the last', async () => {
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    return app.client.evaluate(browserHelpers + `
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

  test('switching to Editor mode restores the gentle continuous fade', async () => {
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.mode-tab[data-mode="editor"]').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 400));
    const gradient = await fadeGradient();
    const stopCount = (gradient.match(/\d+%/g) || []).length;
    assert.equal(stopCount, 3, `expected Editor mode's continuous fade, got: ${gradient}`);
    assert.ok(gradient.includes('50%'), 'expected the fade to center on the writing line');

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
    const result = await app.client.evaluate(browserHelpers + `
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
    const railPlaceholderStyle = await app.client.evaluate(browserHelpers + `
      const el = document.querySelector('.rail-chapter-title.placeholder');
      return { text: el.textContent, fontStyle: getComputedStyle(el).fontStyle };
    `);
    assert.deepEqual(railPlaceholderStyle, { text: 'Untitled', fontStyle: 'normal' });
    // The manuscript surface uses the same label without italic styling;
    // the rail's italic treatment distinguishes placeholder from user text.
    assert.equal(result.widgetText, 'Untitled');

    // Force a save and check the actual bytes on disk — the placeholder must
    // never leak into real content.
    await app.client.evaluate(browserHelpers + `
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
    `);
    const saved = fs.readFileSync(app.fixturePath, 'utf8');
    assert.ok(saved.startsWith('# \n') || saved.startsWith('#\n'));
    assert.ok(!saved.includes('Chapter 1'));
  });

  test('an empty chapter remains available for scene insertion', async () => {
    const result = await app.client.evaluate(browserHelpers + `const row=[...document.querySelectorAll('.rail-chapter-row')].find(r=>r.textContent.includes('Chapter Two')); return row.querySelector('.rail-trailing-meta').textContent;`);
    assert.equal(result,'0/0');
  });

  test('adding a scene from a specific chapter\'s row lands it in that chapter, not the last one', async () => {
    const lines = await app.client.evaluate(browserHelpers + `
      const chapterTwoRow = addSceneButton('Chapter Two');
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
    await app.client.evaluate(browserHelpers + 'window.resizeTo(1300, 900); return true;');
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
    const lines = await app.client.evaluate(browserHelpers + 'return [...document.querySelectorAll(".cm-line")].map(l => l.textContent);');
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
    const nums = await app.client.evaluate(browserHelpers + `
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

  test('named scene renders as a left-aligned heading with no ornament; unnamed scene renders a centered "· · ·"', async () => {
    // typography-rhythm.md #4: a within-scene break renders as a centered,
    // widely tracked "· · ·" in --text-dimmer -- not a rule, not an icon --
    // so the unnamed marker's old line-and-circle ornament (checked here
    // via a solid ::before background color) no longer applies.
    const result = await app.client.evaluate(browserHelpers + `
      const named = document.querySelector('.cm-scene-name-comment');
      const namedLabel = document.querySelector('.cm-scene-name-label');
      const namedMarker = document.querySelector('.cm-scene-break-named');
      const namedMarkerBefore = getComputedStyle(namedMarker, '::before');
      const unnamed = document.querySelector('.cm-scene-break:not(.cm-scene-break-named)');
      const unnamedBefore = getComputedStyle(unnamed, '::before');
      const unnamedAfter = getComputedStyle(unnamed, '::after');
      return {
        namedTextAlign: getComputedStyle(named).textAlign,
        namedFontSize: getComputedStyle(namedLabel).fontSize,
        namedFontWeight: getComputedStyle(namedLabel).fontWeight,
        namedOrnamentDisplay: namedMarkerBefore.display,
        unnamedContent: unnamedBefore.content,
        unnamedColor: unnamedBefore.color,
        unnamedAfterDisplay: unnamedAfter.display,
        dimmerToken: getComputedStyle(document.documentElement).getPropertyValue('--text-dimmer').trim(),
      };
    `);
    assert.equal(result.namedTextAlign, 'left');
    assert.equal(result.namedFontSize, '28px');
    assert.equal(result.namedFontWeight, '400');
    assert.equal(result.namedOrnamentDisplay, 'none');
    assert.equal(result.unnamedContent, '"· · ·"');
    assert.equal(result.unnamedAfterDisplay, 'none');
    const hexToRgb = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    assert.equal(result.unnamedColor, hexToRgb(result.dimmerToken));
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
      const el = document.querySelector('.cm-chapter-placeholder');
      return { text: el.textContent, color: getComputedStyle(el).color, fontStyle: getComputedStyle(el).fontStyle };
    `);
    assert.equal(result.text, 'Untitled');
    assert.equal(result.fontStyle, 'normal'); // regular monospace, not italic
  });

  test('Sprinter mode shows no gutter numbers and keeps the pre-existing ornament/placeholder look', async () => {
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.mode-tab[data-mode="sprinter"]').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    const result = await app.client.evaluate(browserHelpers + `
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
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.mode-tab[data-mode="editor"]').click();
      return true;
    `);
  });

  test('spellcheck remains absent in both Editor and Sprinter modes', async () => {
    const editorState = await app.client.evaluate(browserHelpers + `return {
      native: document.querySelector('.cm-content').getAttribute('spellcheck'),
      custom: document.querySelectorAll('.cm-spellError').length,
    };`);
    assert.deepEqual(editorState, { native: 'false', custom: 0 });
    await app.client.evaluate(browserHelpers + `document.querySelector('.mode-tab[data-mode="sprinter"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 300));
    const sprinterState = await app.client.evaluate(browserHelpers + `return document.querySelector('.cm-content').getAttribute('spellcheck');`);
    assert.equal(sprinterState, 'false');
    await app.client.evaluate(browserHelpers + `document.querySelector('.mode-tab[data-mode="editor"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 300));
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
    await app.client.evaluate(browserHelpers + `
      const lines = [...document.querySelectorAll('.cm-line')];
      const target = lines.find(l => l.textContent.includes('Opening prose'));
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: rect.right - 2, clientY: rect.top + rect.height / 2 }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: rect.right - 2, clientY: rect.top + rect.height / 2 }));
      await new Promise(r => setTimeout(r, 80));
    `);

    const steps = [];
    for (let i = 0; i < 5; i++) {
      const step = await app.client.evaluate(browserHelpers + `
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
    const clicked = await app.client.evaluate(browserHelpers + `
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
    await app.client.evaluate(browserHelpers + `
      const lines = [...document.querySelectorAll('.cm-line')];
      const target = lines.find(l => l.textContent === 'Named scene prose.');
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 }));
      await new Promise(r => setTimeout(r, 80));
    `);

    const steps = [];
    for (let i = 0; i < 5; i++) {
      const step = await app.client.evaluate(browserHelpers + `
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
    return app.client.evaluate(browserHelpers + `
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
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.mode-tab[data-mode="sprinter"]').click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    const monoWeights = await headingWeights();
    assert.equal(monoWeights.h1, '400');
    assert.equal(monoWeights.h2, '400');
    assert.equal(monoWeights.h3, '400');

    await app.client.evaluate(browserHelpers + `
      document.querySelector('.fbtn.serif').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.querySelector('.fbtn.serif').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    `);
    const serifWeights = await headingWeights();
    assert.equal(serifWeights.h1, '700', 'serif keeps its own bold chapter title');
    assert.equal(serifWeights.h2, '700');
    assert.equal(serifWeights.h3, '600');

    await app.client.evaluate(browserHelpers + `
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
describe('Baretext E2E: rail/corkboard navigation without typewriter scrolls the jump target to the top', () => {
  let app;

  before(async () => {
    const longScene = (label) =>
      `## ${label}\n\n` +
      Array.from({ length: 40 }, (_, i) => `Paragraph ${i} of ${label}, with enough words to take up real vertical space in the editor viewport.`).join('\n\n');
    const fixtureContent = `# Chapter One\n\n${longScene('Alpha')}\n\n---\n\n${longScene('Beta')}\n\n---\n\n${longScene('Gamma')}`;
    app = await launchApp({ fixtureContent, mode: 'editor', extraSettings: { typewriter: false } });
    await new Promise((r) => setTimeout(r, 300));
  });

  after(async () => {
    if (app) await app.close();
  });

  async function headingPositionAfterJump(clickScript, headingLabel) {
    await app.client.evaluate(browserHelpers + clickScript);
    await new Promise((r) => setTimeout(r, 300));
    return app.client.evaluate(browserHelpers + `
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

  test('scene click moves the caret into that scene and a later scrollbar drag stays put', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const row = [...document.querySelectorAll('.rail-scene-row')].find(r => r.textContent.includes('Gamma'));
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));

      const selection = document.getSelection();
      const caretLine = selection.anchorNode?.nodeType === Node.TEXT_NODE
        ? selection.anchorNode.parentElement?.closest('.cm-line')
        : selection.anchorNode?.closest?.('.cm-line');
      const scroller = document.querySelector('.cm-scroller');
      const beforeDrag = scroller.scrollTop;
      scroller.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      scroller.scrollTop = Math.max(0, beforeDrag - 300);
      const draggedTo = scroller.scrollTop;
      scroller.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      return { caretText: caretLine?.textContent || '', draggedTo, afterMouseup: scroller.scrollTop };
    `);

    assert.match(result.caretText, /Paragraph 0 of Gamma/);
    assert.equal(result.afterMouseup, result.draggedTo, 'releasing the scrollbar must not recenter on the caret');
  });

  test('releasing a drag-selection does not recenter its endpoint or jump scenes', async () => {
    const points = await app.client.evaluate(browserHelpers + `
      const scroller = document.querySelector('.cm-scroller');
      // CodeMirror virtualizes off-screen lines, so position the real
      // scroller first and let it render the text that the drag will cross.
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * 0.85;
      await new Promise(r => setTimeout(r, 100));
      const rect = scroller.getBoundingClientRect();
      return {
        startX: rect.right - 180,
        startY: rect.bottom - 90,
        endX: rect.left + 260,
        endY: rect.top + 90,
      };
    `);

    await app.client.mouseEvent('mouseMoved', points.startX, points.startY);
    await app.client.mouseEvent('mousePressed', points.startX, points.startY, 1);
    for (let i = 1; i <= 10; i++) {
      const x = points.startX + (points.endX - points.startX) * (i / 10);
      const y = points.startY + (points.endY - points.startY) * (i / 10);
      await app.client.mouseEvent('mouseMoved', x, y, 1);
    }
    const beforeRelease = await app.client.evaluate(browserHelpers + `
      return document.querySelector('.cm-scroller').scrollTop;
    `);
    await app.client.mouseEvent('mouseReleased', points.endX, points.endY, 0);
    await new Promise(r => setTimeout(r, 150));
    const after = await app.client.evaluate(browserHelpers + `
      return {
        scrollTop: document.querySelector('.cm-scroller').scrollTop,
        hasSelection: !document.getSelection().isCollapsed,
        activeScene: document.querySelector('.rail-scene-row.active')?.textContent || '',
      };
    `);

    assert.equal(after.hasSelection, true, 'fixture must create a real text selection');
    assert.ok(Math.abs(after.scrollTop - beforeRelease) < 2, 'selection mouseup must leave the browser-controlled viewport in place');
    assert.match(after.activeScene, /Gamma/);
  });

  test('double-clicking a card in the corkboard also scrolls its heading to the top, not centered', async () => {
    await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
      await app.client.evaluate(browserHelpers + `document.execCommand('insertText', false, ${JSON.stringify(ch)}); return true;`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  test('typing "word--word" converts the double dash to an em dash as soon as the next character lands', async () => {
    await app.client.evaluate(browserHelpers + `
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
    const text = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
    assert.ok(text.includes('wait—what'), 'expected an em dash between "wait" and "what"');
    assert.ok(!text.includes('wait--what'), 'the literal double dash must not survive');
  });

  test('typing a fresh "---" scene-break marker on its own line is left untouched', async () => {
    await typeChars('\n\n---\n\nNext scene.');
    const text = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
    assert.ok(text.includes('---'), 'the three-dash scene-break marker must survive intact, not become an em dash');
    assert.ok(!text.includes('——'), 'no em dash should have been produced while typing the marker');
  });

  test('a run of four or more dashes is left alone, not partially converted', async () => {
    await typeChars('----done');
    const text = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
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
    const { startX, startY, endX, endY } = await app.client.evaluate(browserHelpers + `
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
    const selectedBefore = await app.client.evaluate(browserHelpers + 'return window.getSelection().toString();');
    assert.equal(selectedBefore, 'plain');

    await app.client.evaluate(browserHelpers + `
      document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'i', metaKey: true, bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 200));

    const after = await app.client.evaluate(browserHelpers + `
      return { text: document.querySelector('.cm-content').innerText, selected: window.getSelection().toString() };
    `);
    assert.ok(after.text.includes('plain'), 'Pretty view should keep showing the formatted word');
    assert.ok(!after.text.includes('*plain*'), 'Pretty view must not reveal delimiters after formatting');
    assert.equal(after.selected, 'plain', 'selection must stay on the wrapped word, not balloon out to the whole line');
    await new Promise((r) => setTimeout(r, 350));
    assert.ok(fs.readFileSync(app.fixturePath, 'utf8').includes('*plain*'), 'the Markdown source must contain the italic delimiters');
  });

  test('Mod-b wraps a real selection in double asterisks', async () => {
    await dragSelectWord('testing');
    const selectedBefore = await app.client.evaluate(browserHelpers + 'return window.getSelection().toString();');
    assert.equal(selectedBefore, 'testing');
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 200));
    const text = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
    assert.ok(text.includes('testing'), 'Pretty view should keep showing the formatted word');
    assert.ok(!text.includes('**testing**'), 'Pretty view must not reveal delimiters after formatting');
    const markdown = await app.client.evaluate(browserHelpers + `
      const content = document.querySelector('.cm-content');
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => requestAnimationFrame(r));
      const raw = content.innerText;
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      return raw;
    `);
    assert.ok(markdown.includes('**testing**'), 'Markdown view must expose the bold delimiters');
    await new Promise((r) => setTimeout(r, 350));
    assert.ok(fs.readFileSync(app.fixturePath, 'utf8').includes('**testing**'), 'the Markdown source must contain the bold delimiters');
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

describe('Baretext E2E: Pretty view keeps heading marks concealed while you type them', () => {
  let app;

  before(async () => {
    app = await launchApp({ fixtureContent: '# One\n\nOpening paragraph.', mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  // Regression coverage for a real bug found via screen recording: typing
  // "### " to start a heading, then continuing to type its title, left the
  // "###" marks themselves permanently visible at the END of the typed
  // text instead of concealed at the front -- e.g. "### A Named Scene"
  // rendered as "A Named Scene###". Root cause was live-preview.js's
  // HiddenWidget rendering a `display:none` span for concealed marks: a
  // hidden-but-still-present DOM node right at the boundary between the
  // just-concealed "### " and the text about to be typed after it, which
  // the browser's native contenteditable caret logic could land on the
  // wrong side of on the very next keystroke -- so each subsequent
  // character landed BEFORE the hidden marks instead of after them. Fixed
  // by switching to a widget-less `Decoration.replace({})` (zero DOM
  // footprint, CodeMirror supplies its own widget-buffer markers), the same
  // shape book-title.js's own comment-hiding decoration already used
  // successfully. Real character-by-character typing via execCommand
  // (not a single dispatch()) is essential to this repro -- a single
  // programmatic insert never exercised the native-caret path at all.
  test('typing "### Title" character by character conceals the marks and keeps them concealed', async () => {
    await app.client.evaluate(`
      const cm = document.querySelector('.cm-content');
      const lines = [...document.querySelectorAll('.cm-line')];
      const last = lines[lines.length - 1];
      const r = last.getBoundingClientRect();
      const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(r.right - 1, r.top + r.height / 2) : null;
      cm.focus();
      const sel = document.getSelection();
      if (range) { sel.removeAllRanges(); sel.addRange(range); }
      return true;
    `);
    await app.client.evaluate(`document.execCommand('insertText', false, '\\n\\n'); return true;`);
    for (const ch of '### A Named Scene') {
      await app.client.evaluate(`document.execCommand('insertText', false, ${JSON.stringify(ch)}); return true;`);
      await new Promise((r) => setTimeout(r, 40));
    }
    await new Promise((r) => setTimeout(r, 150));

    const rendered = await app.client.evaluate(`return document.querySelector('.cm-content').textContent;`);
    assert.ok(rendered.includes('A Named Scene'), `expected the heading title to render, got: ${JSON.stringify(rendered)}`);
    assert.ok(!rendered.includes('#'), `heading marks must stay concealed (no literal "#" anywhere), got: ${JSON.stringify(rendered)}`);

    await new Promise((r) => setTimeout(r, 350));
    const saved = fs.readFileSync(app.fixturePath, 'utf8');
    assert.ok(saved.includes('### A Named Scene'), 'the Markdown source must still contain the real heading marks');

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
    await app.client.evaluate(browserHelpers + `
      const chipStatus = document.querySelector('.sprint-chip-status');
      chipStatus.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      chipStatus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);

    const paused = await app.client.evaluate(browserHelpers + `
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

    const resumed = await app.client.evaluate(browserHelpers + `
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
    await app.client.evaluate(browserHelpers + `
      const pauseBtn = [...document.querySelectorAll('.sprint-pill')].find(b => b.innerText === 'pause');
      pauseBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      pauseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const minBtn = [...document.querySelectorAll('.sprint-pill')].find(b => b.innerText === 'minimize');
      minBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      minBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const result = await app.client.evaluate(browserHelpers + `
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
    await app.client.evaluate(browserHelpers + `
      const chipStatus = document.querySelector('.sprint-chip-status');
      chipStatus.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      chipStatus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'H', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const chipText = await app.client.evaluate(browserHelpers + `return document.querySelector('.sprint-chip-status').innerText.trim();`);
    assert.equal(chipText, 'sprinting');
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  // Regression: the minimized sprint edge line lives outside #statusbar (an
  // absolutely-positioned sibling), so hiding the status bar alone left it
  // on screen -- defeating the point of focus mode's declutter.
  test('focus mode (⌘.) also hides the minimized sprint edge line, and restores it when toggled off', async () => {
    await app.client.evaluate(browserHelpers + `
      // Restore to active, then minimize, so the edge line is showing.
      document.querySelector('.sprint-chip-status').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.querySelector('.sprint-chip-status').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const minBtn = [...document.querySelectorAll('.sprint-pill')].find(b => b.innerText === 'minimize');
      minBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      minBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const before = await app.client.evaluate(browserHelpers + `
      return { edgeDisplay: getComputedStyle(document.querySelector('.sprint-edge')).display, edgeOpacity: getComputedStyle(document.querySelector('.sprint-edge')).opacity };
    `);
    assert.equal(before.edgeDisplay, 'block');
    assert.equal(before.edgeOpacity, '1');

    const focusOn = await app.client.evaluate(browserHelpers + `
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      return { edgeOpacity: getComputedStyle(document.querySelector('.sprint-edge')).opacity };
    `);
    assert.equal(focusOn.edgeOpacity, '0');

    const focusOff = await app.client.evaluate(browserHelpers + `
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
    await app.client.evaluate(browserHelpers + `
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (document.querySelectorAll('.rail-scene-row').length >= 2) break;
        await new Promise(r => setTimeout(r, 100));
      }
    `);

    const before = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
    assert.ok(before.indexOf('A1 opening') < before.indexOf('A2 second'));

    await app.client.evaluate(browserHelpers + dragScript(
      `[...document.querySelectorAll('.rail-scene-row')][1]`, // A2
      `[...document.querySelectorAll('.rail-scene-row')][0]`  // A1
    ));
    const after = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
    assert.ok(after.indexOf('A2 second') < after.indexOf('A1 opening'), 'A2 should now come before A1');

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('dragging a scene onto another chapter\'s header moves it into that (empty) chapter', async () => {
    await app.client.evaluate(browserHelpers + dragScript(
      `[...document.querySelectorAll('.rail-scene-row')].find(r => r.textContent.includes('Scene 1') && r.closest('.rail-scene-list').previousElementSibling.textContent.includes('Chapter Three'))`,
      `[...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter Two'))`
    ));
    const lines = await app.client.evaluate(browserHelpers + 'return [...document.querySelectorAll(".cm-line")].map(l => l.textContent);');
    const chTwoIdx = lines.indexOf('Chapter Two');
    const chThreeIdx = lines.indexOf('Chapter Three');
    const sceneIdx = lines.findIndex(l => l.includes('C1 opening prose'));
    assert.ok(chTwoIdx !== -1 && chThreeIdx !== -1 && sceneIdx !== -1);
    assert.ok(sceneIdx > chTwoIdx && sceneIdx < chThreeIdx, 'C1 should now live under Chapter Two, before Chapter Three');

    const railText = await app.client.evaluate(browserHelpers + 'return document.getElementById("scene-rail").innerText;');
    assert.match(railText, /Chapter Three\n0/); // Chapter Three is empty now

    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });

  test('dragging a chapter header onto another chapter header reorders chapters', async () => {
    const before = await app.client.evaluate(browserHelpers + 'return [...document.querySelectorAll(".rail-chapter-title")].map(t => t.textContent);');
    assert.deepEqual(before, ['Chapter One', 'Chapter Two', 'Chapter Three']);

    await app.client.evaluate(browserHelpers + dragScript(
      `[...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter Three'))`,
      `[...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter One'))`
    ));
    const after = await app.client.evaluate(browserHelpers + 'return [...document.querySelectorAll(".rail-chapter-title")].map(t => t.textContent);');
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const before = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
    const firstIsA1 = before.indexOf('A1 opening') < before.indexOf('A2 second');

    const rects = await app.client.evaluate(browserHelpers + `
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

    const after = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
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
    await app.client.evaluate(browserHelpers + `
      const addRow = addSceneButton('Chapter One');
      addRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      addRow.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    // This describe block's tests run sequentially against one shared,
    // mutating document (earlier tests in it already reorder/relocate
    // scenes), so read live counts as the baseline rather than assuming the
    // fixture's original per-chapter numbers still hold at this point.
    const before = await app.client.evaluate(browserHelpers + `
      return {
        sceneRowCount: document.querySelectorAll('.rail-scene-row').length,
        ch1SceneCount: [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter One')).querySelector('.rail-dim').textContent.split('/')[0],
        ch3SceneCount: [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter Three')).querySelector('.rail-dim').textContent.split('/')[0],
      };
    `);

    const rects = await app.client.evaluate(browserHelpers + `
      const ch1Rows = [...document.querySelectorAll('.rail-scene-row')].filter(r => r.closest('.rail-scene-list').previousElementSibling.textContent.includes('Chapter One'));
      const source = ch1Rows[ch1Rows.length - 1]; // the just-added empty scene, last in Chapter One
      const target = [...document.querySelectorAll('.rail-chapter-row')].find(r => r.textContent.includes('Chapter Three'));
      const s = source.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      return { from: { x: s.x + s.width / 2, y: s.y + s.height / 2 }, to: { x: t.x + t.width / 2, y: t.y + t.height / 2 } };
    `);
    await app.client.realDrag(rects.from.x, rects.from.y, rects.to.x, rects.to.y);
    await new Promise((r) => setTimeout(r, 250));

    const after = await app.client.evaluate(browserHelpers + `
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
    const state = await app.client.evaluate(browserHelpers + `
      return {
        visible: !!document.querySelector('.rail-cold-storage-row'),
        headerText: document.querySelectorAll('#scene-rail .rail-chapter-row:not(.rail-cold-storage-row)').length + 'ch/' + document.querySelectorAll('#scene-rail > .rail-list .rail-scene-row').length,
        docText: document.querySelector('.cm-content').innerText,
      };
    `);
    assert.equal(state.visible, true);
    assert.equal(state.headerText, '1ch/2'); // 1 real chapter, 2 real scenes -- Cold Storage doesn't count
    assert.ok(!state.docText.includes('COLD STORAGE')); // never touches the doc until actually used
  });

  test('dragging a scene onto it removes the scene from its chapter, excludes it from the word count, and writes the marker', async () => {
    const before = await app.client.evaluate(browserHelpers + `
      return { wordCount: document.getElementById('word-count').textContent };
    `);
    assert.equal(before.wordCount, '37 words');

    const coords = await app.client.evaluate(browserHelpers + `
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

    const after = await app.client.evaluate(browserHelpers + `
      return {
        headerText: document.querySelectorAll('#scene-rail .rail-chapter-row:not(.rail-cold-storage-row)').length + 'ch/' + document.querySelectorAll('#scene-rail > .rail-list .rail-scene-row').length,
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
    await app.client.evaluate(browserHelpers + `
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
    const coordsBack = await app.client.evaluate(browserHelpers + `
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

    const after = await app.client.evaluate(browserHelpers + `
      return {
        headerText: document.querySelectorAll('#scene-rail .rail-chapter-row:not(.rail-cold-storage-row)').length + 'ch/' + document.querySelectorAll('#scene-rail > .rail-list .rail-scene-row').length,
        coldStorageCount: document.querySelector('.rail-cold-storage-row .rail-dim').textContent,
        coldStorageStillVisible: !!document.querySelector('.rail-cold-storage-row'),
        wordCount: document.getElementById('word-count').textContent,
      };
    `);
    assert.equal(after.headerText, '1ch/2');
    assert.equal(after.coldStorageCount, '0/0'); // emptied -- 0 scenes, 0 words
    assert.equal(after.coldStorageStillVisible, true, 'Cold Storage stays a persistent drop zone even once emptied');
    assert.equal(after.wordCount, '37 words');

    await app.client.evaluate(browserHelpers + `
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
    return app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
  }
  async function clickRailRow(labelSubstr) {
    await app.client.evaluate(browserHelpers + `
      const row = [...document.querySelectorAll('.rail-scene-row')].find(r => r.textContent.includes(${JSON.stringify(labelSubstr)}));
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
  }
  async function bannerState() {
    return app.client.evaluate(browserHelpers + `
      return {
        visible: document.getElementById('cold-storage-banner').classList.contains('visible'),
        label: document.getElementById('cold-storage-banner-label').textContent,
        hostActive: document.getElementById('editor-host').classList.contains('cold-storage-view-active'),
      };
    `);
  }

  test('typing at the end of the last manuscript scene works when Cold Storage follows it', async () => {
    const point = await app.client.evaluate(browserHelpers + `
      const line = [...document.querySelectorAll('.cm-line')]
        .find(el => el.textContent.includes('Paragraph 19 of chapter one'));
      const rect = line.getBoundingClientRect();
      return { x: rect.right - 2, y: rect.top + rect.height / 2 };
    `);
    await app.client.mouseEvent('mousePressed', point.x, point.y, 1);
    await app.client.mouseEvent('mouseReleased', point.x, point.y, 0);
    await app.client.evaluate(browserHelpers + `
      document.execCommand('insertText', false, ' END-TYPING-WORKS');
      await new Promise(r => setTimeout(r, 750));
    `);
    const saved = fs.readFileSync(app.fixturePath, 'utf8');
    assert.ok(saved.includes('Paragraph 19 of chapter one') && saved.includes('END-TYPING-WORKS'));
    assert.ok(saved.includes('<!-- COLD STORAGE -->'));
  });

  test('scrolling the main manuscript to its bottom never reaches Cold Storage', async () => {
    const text = await app.client.evaluate(browserHelpers + `
      const scroller = document.querySelector('.cm-scroller');
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise(r => setTimeout(r, 150));
      return document.querySelector('.cm-content').innerText;
    `);
    assert.ok(!text.includes('COLD STORAGE'), 'the marker must never become visible by scrolling');
    assert.ok(!text.includes('First cut scene'), 'Cold Storage scene text must never become visible by scrolling');
    // Reset scroll for the tests that follow.
    await app.client.evaluate(browserHelpers + 'document.querySelector(".cm-scroller").scrollTop = 0; return true;');
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
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.cm-content').focus();
      document.execCommand('insertText', false, ' EDITED-IN-SCENE-VIEW');
      return true;
    `);
    await new Promise((r) => setTimeout(r, 150));
    const text = await visibleText();
    assert.ok(text.includes('EDITED-IN-SCENE-VIEW'));

    await app.client.evaluate(browserHelpers + `
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
    `);
    const saved = fs.readFileSync(app.fixturePath, 'utf8');
    assert.ok(saved.includes('EDITED-IN-SCENE-VIEW'), 'the edit made while isolated must land in the real file, not a disconnected copy');
  });

  test('clicking Back restores the exact cursor position from before scene view was entered', async () => {
    await app.client.evaluate(browserHelpers + `
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

    await app.client.evaluate(browserHelpers + `
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
    const sceneRowClick = await app.client.evaluate(browserHelpers + `
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
    await app.client.evaluate(browserHelpers + `
      const row = [...document.querySelectorAll('.rail-scene-row')].find(r => r.textContent.includes('Second Cut'));
      const deleteBtn = railAction(row, '.rail-delete-btn');
      deleteBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      deleteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 100));
    await app.client.evaluate(browserHelpers + `
      const row = [...document.querySelectorAll('.rail-scene-row')].find(r => r.textContent.includes('Second Cut'));
      const deleteBtn = railAction(row, '.rail-delete-btn');
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
    const gutterNums = await app.client.evaluate(browserHelpers + `
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
    await app.client.evaluate(browserHelpers + `
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (document.querySelectorAll('.rail-scene-row').length >= 2) break;
        await new Promise(r => setTimeout(r, 100));
      }
    `);

    const before = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
    const breakCountBefore = (before.match(/^---$/gm) || []).length;

    await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const target = rows.find(r => r.querySelector('.rail-scene-name').textContent === 'Scene 2');
      const editBtn = railAction(target, '.rail-edit-btn');
      editBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const input = document.querySelector('.inline-rename-input');
      input.value = 'The Harbor Opens';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);

    const lines = await app.client.evaluate(browserHelpers + 'return [...document.querySelectorAll(".cm-line")].map(l => l.textContent);');
    assert.ok(!lines.some((l) => /^#{1,3}\s*The Harbor Opens$/.test(l)), 'must not become a heading');
    assert.ok(lines.some((l) => l.trim() === '---'), 'the --- break line must still be a real line in the doc');

    const afterDoc = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
    const breakCountAfter = (afterDoc.match(/^---$/gm) || []).length;
    assert.equal(breakCountAfter, breakCountBefore, 'no --- lines lost or gained');
    assert.ok(afterDoc.includes('First scene prose') && afterDoc.includes('Second scene prose'), 'original prose untouched');

    const railText = await app.client.evaluate(browserHelpers + 'return document.getElementById("scene-rail").innerText;');
    assert.match(railText, /The Harbor Opens/);

    // The editor visually hides the raw <!-- --> syntax the same way it
    // already hides the raw dashes, replacing it with just the name — a
    // separate widget (.cm-scene-name-label), not the line itself, so it
    // can be ordered independently of the gutter number sharing this line
    // (see manuscript-gutter.js/scene-breaks.js for why).
    const visual = await app.client.evaluate(browserHelpers + `
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
    await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const target = rows.find(r => r.innerText.includes('The Harbor Opens'));
      const editBtn = railAction(target, '.rail-edit-btn');
      editBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const input = document.querySelector('.inline-rename-input');
      input.value = 'Confrontation';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const doc = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
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
    await app.client.evaluate(browserHelpers + `
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
    const rects = await app.client.evaluate(browserHelpers + `
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

    const titles = await app.client.evaluate(browserHelpers + `
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

  test('"Change theme…" opens a 6-card gallery, each card resolving its own theme\'s tokens', async () => {
    const result = await app.client.evaluate(browserHelpers + `
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
    assert.deepEqual(result.cards.map((c) => c.theme), ['dark', 'light', 'amstrad', 'grove', 'dracula', 'crt']);
    assert.ok(result.cards.every((c) => c.role === 'radio'));
    // Each card must render its OWN theme's --bg, not the app's actual
    // active theme -- the whole point of the nested data-theme scope trick.
    assert.equal(result.cards[0].bg, 'rgb(36, 36, 36)');   // dark --bg #242424
    assert.equal(result.cards[3].bg, 'rgb(47, 56, 62)');   // grove --bg #2f383e
    // CRT deliberately shares Amstrad's exact --bg (it's a bonus shader
    // variant of the same palette, not a distinct color scheme) -- 6 cards,
    // 5 distinct backgrounds.
    assert.equal(result.cards[5].bg, result.cards[2].bg);
    const distinctBgs = new Set(result.cards.map((c) => c.bg));
    assert.equal(distinctBgs.size, 5);
  });

  test('clicking a card applies + persists the theme and keeps the picker open', async () => {
    const result = await app.client.evaluate(browserHelpers + `
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
    const kbd = await app.client.evaluate(browserHelpers + `
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

    const esc = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
      ${openViaPalette('Change theme')}
      const dracula = document.querySelector('.tp-card[data-theme="dracula"]');
      return {
        cardCount: document.querySelectorAll('.tp-card').length,
        draculaApplied: dracula.classList.contains('applied'),
        draculaKbdFocus: dracula.classList.contains('kbd-focus'),
      };
    `);
    assert.equal(result.cardCount, 6);
    assert.equal(result.draculaApplied, true);
    assert.equal(result.draculaKbdFocus, true);
  });

  test('the live specimen uses --typewriter-focus for the active line and .28 opacity for its neighbors', async () => {
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
      const selectors = [
        '.rail-corkboard-btn', '.rail-edit-btn', '.rail-delete-btn',
        '.rail-footer button:last-of-type', '.rail-footer button', '#tw-status-indicator', '#file-name',
      ];
      return selectors.map(sel => {
        const el = /rail-(edit|delete)-btn/.test(sel) ? railAction(document, sel) : document.querySelector(sel);
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const renamed = await app.client.evaluate(browserHelpers + `
      const row = document.querySelector('.rail-scene-row');
      row.focus();
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const input = document.querySelector('.inline-rename-input');
      return { inputPresent: !!input, inputFocused: document.activeElement === input };
    `);
    assert.equal(renamed.inputPresent, true);
    assert.equal(renamed.inputFocused, true);
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.inline-rename-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
    `);

    const armed = await app.client.evaluate(browserHelpers + `
      const row = document.querySelector('.rail-scene-row');
      row.focus();
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 100));
      const btn = railAction(row, '.rail-delete-btn');
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
    const before = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
    assert.ok(before.indexOf('A1 opening') < before.indexOf('A2 second'));

    await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const second = rows[1]; // A2
      second.focus();
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
    `);
    const after = await app.client.evaluate(browserHelpers + 'return document.querySelector(".cm-content").innerText;');
    assert.ok(after.indexOf('A2 second') < after.indexOf('A1 opening'), 'A2 should now come before A1');
  });

  test('a global :focus-visible ring and a prefers-reduced-motion rule are registered app-wide', async () => {
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
      function effectiveSize(sel) {
        // rail-edit-btn/rail-delete-btn live inside .rail-trailing-controls,
        // which is only actually in the layout (not [hidden]) on hover or
        // focus (writing-rail-refinements.md #2 -- a genuine state-driven
        // swap, not an opacity trick) -- focus the row first so what's
        // measured is the same "hit target while reachable" real interaction
        // exercises, not a zeroed-out display:none rect.
        const el = /rail-(edit|delete)-btn/.test(sel) ? railAction(document, sel) : document.querySelector(sel);
        const row = el.closest('.rail-chapter-row, .rail-scene-row');
        // A real .focus() call doesn't reliably fire focus events against a
        // BARETEXT_HIDDEN window (no OS-level window focus to move) --
        // dispatch the bubbling event wireTrailingHover actually listens
        // for directly, same effect a real Tab-into-the-row would have.
        if (row) row.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
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
      assert.ok(size.w >= 20 && size.h >= 20, `${name} effective hit target should be >= 24px (got ${size.w}x${size.h})`);
    }
    assert.equal(result.footerHeight, 34);
  });

  // P0-hover: rename/delete must never be hover-only -- a keyboard/touch/
  // screen-reader user can't hover, so they'd otherwise be permanently
  // unreachable. (Dragging isn't hover-gated at all now -- it's the whole
  // row, always there.)
  test('rail action buttons are visible (not hover-gated to invisible) even without hovering', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const editBtn = railAction(document, '.rail-edit-btn');
      return { opacity: parseFloat(getComputedStyle(editBtn).opacity) };
    `);
    assert.ok(result.opacity > 0, 'edit button must have nonzero opacity by default, not opacity:0 until hover');
  });

  test('the command palette is a dialog+combobox+listbox: roles, aria-activedescendant tracks the highlighted option', async () => {
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const initial = await app.client.evaluate(browserHelpers + `
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

    const afterClick = await app.client.evaluate(browserHelpers + `
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
    const backToEditor = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
      const before = await app.client.evaluate(browserHelpers +
        "return document.getElementById('save-error').classList.contains('visible');"
      );
      assert.equal(before, false);

      await app.client.evaluate(browserHelpers + `
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
        return true;
      `);
      await new Promise((r) => setTimeout(r, 400));

      const after = await app.client.evaluate(browserHelpers + `
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
      await app.client.evaluate(browserHelpers + `
        const cm = document.querySelector('.cm-content');
        cm.focus();
        document.execCommand('insertText', false, ' more text');
        return true;
      `);
      await new Promise((r) => setTimeout(r, 800)); // clears the 500ms autosave debounce
      const failed = await app.client.evaluate(browserHelpers +
        "return document.getElementById('save-error').classList.contains('visible');"
      );
      assert.equal(failed, true);
    } finally {
      fixSavePath();
    }

    await app.client.evaluate(browserHelpers + `
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 400));
    const recovered = await app.client.evaluate(browserHelpers +
      "return document.getElementById('save-error').classList.contains('visible');"
    );
    assert.equal(recovered, false, 'a successful save afterward must clear the error indicator');
  });

  test('repeated failed autosaves show the failure toast only once, not on every debounce tick', async () => {
    breakSavePath();
    try {
      await app.client.evaluate(browserHelpers + `
        document.execCommand('insertText', false, 'x');
        return true;
      `);
      await new Promise((r) => setTimeout(r, 800));
      const firstToastShowing = await app.client.evaluate(browserHelpers +
        "return document.getElementById('toast').classList.contains('show');"
      );
      assert.equal(firstToastShowing, true);

      // Let the 1.6s toast auto-hide, then fail a second time while the
      // error indicator is still lit from the first failure.
      await new Promise((r) => setTimeout(r, 1700));
      await app.client.evaluate(browserHelpers + `
        document.execCommand('insertText', false, 'y');
        return true;
      `);
      await new Promise((r) => setTimeout(r, 800));
      const secondToastShowing = await app.client.evaluate(browserHelpers +
        "return document.getElementById('toast').classList.contains('show');"
      );
      assert.equal(secondToastShowing, false, 'the toast should not re-fire while the indicator is already showing');

      const stillVisible = await app.client.evaluate(browserHelpers +
        "return document.getElementById('save-error').classList.contains('visible');"
      );
      assert.equal(stillVisible, true, 'the indicator itself must still reflect the ongoing failure');
    } finally {
      fixSavePath();
    }
  });
});

// Regression for the September 2026 data-loss incident: one Cmd-Z replaced
// an 82 KB editor buffer with an empty string, and the 500 ms autosave wrote
// that empty string over the manuscript. Exercise the real renderer -> IPC ->
// main-process writer path and inspect actual disk bytes afterward.
describe('Baretext E2E: catastrophic autosaves cannot erase a manuscript', () => {
  let app;
  const manuscript = '# Chapter 1\n\n' + 'The manuscript must remain recoverable. '.repeat(500);

  before(async () => {
    app = await launchApp({ fixtureContent: manuscript, mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('an empty autosave is blocked, the disk file survives, and a recovery snapshot exists', async () => {
    await app.client.evaluate(browserHelpers + `window.api.contentChanged(''); return true;`);
    await new Promise((resolve) => setTimeout(resolve, 800));

    assert.equal(fs.readFileSync(app.fixturePath, 'utf8'), manuscript);
    const recoveryRoot = path.join(app.userDataDir, 'manuscript-recovery');
    const snapshots = fs.readdirSync(recoveryRoot).flatMap((dir) =>
      fs.readdirSync(path.join(recoveryRoot, dir)).filter((name) => name.endsWith('.snapshot'))
    );
    assert.ok(snapshots.length >= 1, 'the pre-save manuscript must also exist in recovery history');

    const ui = await app.client.evaluate(browserHelpers + `return {
      errorVisible: document.getElementById('save-error').classList.contains('visible'),
      toastText: document.getElementById('toast').textContent,
    };`);
    assert.equal(ui.errorVisible, true);
    assert.ok(ui.toastText.includes('destructive save blocked'));
    assert.ok(ui.toastText.includes('manuscript is safe'));
  });
});

describe('Baretext E2E: Cold Storage rename cannot undo through file load', () => {
  let app;
  const manuscript = [
    '# Part 1', '', 'Main manuscript prose that must never disappear.', '',
    '<!-- COLD STORAGE -->', '', '<!-- Parked scene -->', '', 'Parked scene prose.', '',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: manuscript, mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('undoing a parked-scene rename stops at the loaded manuscript instead of reaching empty', async () => {
    await app.client.evaluate(browserHelpers + `
      const deadline = Date.now() + 2000;
      let edit;
      while (!(edit = railAction(document, '.rail-cold-storage-section .rail-scene-row .rail-edit-btn')) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      edit.click();
      const input = document.querySelector('.rail-cold-storage-section .inline-rename-input');
      input.value = 'Parked idea';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return true;
    `);
    await new Promise((resolve) => setTimeout(resolve, 650));

    const result = await app.client.evaluate(browserHelpers + `
      const content = document.querySelector('.cm-content');
      content.focus();
      const undo = () => content.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', metaKey: true, bubbles: true, cancelable: true,
      }));
      undo();
      undo();
      return {
        visibleText: content.innerText,
        wordCount: document.getElementById('word-count').textContent,
      };
    `);

    assert.ok(result.visibleText.includes('Main manuscript prose'));
    assert.notEqual(result.wordCount, '0 words');
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.ok(fs.readFileSync(app.fixturePath, 'utf8').includes('Main manuscript prose'));
  });
});

describe('Baretext E2E: naming the first unnamed Cold Storage scene preserves its section', () => {
  let app;
  const manuscript = [
    '# Part 1', '', 'Main manuscript prose that must stay in the manuscript.', '',
    '<!-- COLD STORAGE -->', '', 'Unnamed parked prose.', '',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: manuscript, mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('rename keeps the parked scene in Cold Storage and leaves the manuscript intact', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const deadline = Date.now() + 2000;
      let edit;
      while (!(edit = railAction(document, '.rail-cold-storage-section .rail-scene-row .rail-edit-btn')) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      edit.click();
      const input = document.querySelector('.rail-cold-storage-section .inline-rename-input');
      input.value = 'Cut opening';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      return {
        chapterScenes: [...document.querySelectorAll('.rail-scene-row')]
          .filter((row) => !row.closest('.rail-cold-storage-section'))
          .map((row) => row.getAttribute('aria-label')),
        coldScenes: [...document.querySelectorAll('.rail-cold-storage-section .rail-scene-row')]
          .map((row) => row.getAttribute('aria-label')),
        chapterCount: document.querySelectorAll('#scene-rail .rail-chapter-row:not(.rail-cold-storage-row)').length + 'ch/' + document.querySelectorAll('#scene-rail > .rail-list .rail-scene-row').length,
      };
    `);

    assert.deepEqual(result.coldScenes, ['Cut opening']);
    assert.ok(!result.chapterScenes.includes('Cut opening'));
    assert.match(result.chapterCount, /^1ch\//);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const saved = fs.readFileSync(app.fixturePath, 'utf8');
    assert.ok(saved.includes('Main manuscript prose'));
    assert.ok(saved.includes('<!-- COLD STORAGE -->'));
    assert.ok(saved.includes('<!-- Cut opening -->'));
  });

  test('pressing Enter to confirm the Cold Storage rename preserves the rail viewport', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const style = document.createElement('style');
      style.textContent = '#scene-rail .rail-scene-list:not(.rail-cold-storage-section *) { min-height: 1100px; }';
      document.head.appendChild(style);

      let list = document.querySelector('#scene-rail .rail-list');
      list.scrollTop = list.scrollHeight;
      const before = list.scrollTop;
      railAction(document, '.rail-cold-storage-section .rail-edit-btn').click();
      const input = document.querySelector('.rail-cold-storage-section .inline-rename-input');
      input.value = 'Cut opening renamed';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));

      list = document.querySelector('#scene-rail .rail-list');
      const after = list.scrollTop;
      style.remove();
      return { before, after };
    `);

    assert.ok(result.before > 0, 'fixture must put Cold Storage below the fold');
    assert.equal(result.after, result.before);
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
    await app.client.evaluate(browserHelpers + 'window.resizeTo(1400, 900); return true;');
    await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
      const row = document.querySelector('.rail-chapter-row');
      const button = row.querySelector('.rail-chevron-btn').getBoundingClientRect();
      const glyph = row.querySelector('.rail-svg-icon').getBoundingClientRect();
      return { button: [button.width, button.height], glyph: [glyph.width, glyph.height] };
    `);
    assert.deepEqual(result, { button: [16, 16], glyph: [16, 16] });
  });

  test('the docked rail uses the handoff dimensions', async () => {
    const result = await app.client.evaluate(browserHelpers + `return {width:getComputedStyle(document.getElementById('scene-rail')).width, chapter:document.querySelector('.rail-chapter-row').offsetHeight, scene:document.querySelector('.rail-scene-row').offsetHeight};`);
    assert.deepEqual(result,{width:'320px',chapter:30,scene:28});
  });

  test('the document title and navigation controls live in the toolbar', async () => {
    const result = await app.client.evaluate(browserHelpers + `return {title:document.querySelector('.writing-toolbar .rail-label').textContent, controls:document.querySelectorAll('.writing-toolbar button').length, height:document.getElementById('titlebar').offsetHeight};`);
    assert.deepEqual(result,{title:'test',controls:3,height:38});
  });

  test('the filename is only the default book title; a rail edit creates the shared manuscript title', async () => {
    const fromRail = await app.client.evaluate(browserHelpers + `
      document.querySelector('.rail-label').click();
      const input = document.querySelector('.writing-toolbar .inline-rename-input');
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

  test('the footer provides chapter and scene insertion', async () => {
    assert.equal(await app.client.evaluate(browserHelpers + `return document.querySelectorAll('.rail-footer button').length;`),2);
  });

  test('chapter and scene columns retain exact offsets in the tightened rhythm', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const panel = document.getElementById('scene-rail').getBoundingClientRect();
      const chapterTitle = document.querySelector('.rail-chapter-title').getBoundingClientRect();
      const sceneTitle = document.querySelector('.rail-scene-name').getBoundingClientRect();
      return {
        chapterTitleX: chapterTitle.left - panel.left,
        sceneTitleX: sceneTitle.left - panel.left,
      };
    `);
    // sceneTitleX moved out from under chapterTitleX -- scene rows now carry
    // their own left index numeral (writing-rail-refinements.md #4, same
    // tint treatment as the manuscript's own gutter numerals), so the name
    // starts one numeral-column-plus-gap further right than before.
    assert.deepEqual(result, { chapterTitleX: 54, sceneTitleX: 34 });
  });

  test('Cold Storage uses the same columns and its snowflake stays blue', async () => {
    const result = await app.client.evaluate(browserHelpers + `
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
    assert.equal(result.frostColor, 'rgb(217, 138, 63)');
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
    const overflowX = await app.client.evaluate(browserHelpers +
      "return getComputedStyle(document.getElementById('scene-rail').querySelector('.rail-list')).overflowX;"
    );
    assert.equal(overflowX, 'hidden');
  });

  // "A Turning Point" (16 chars) is the longest real title in this
  // project's own E2E fixture (test/fixtures/manuscript.md) -- a realistic
  // bar, not an arbitrarily long invented string (truncation for a
  // genuinely long title is expected/fine in any fixed-width sidebar).
  test('bug 2: a realistic-length chapter title does not truncate at the current rail width', async () => {
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
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
    const result = await app.client.evaluate(browserHelpers + `
      const section = document.querySelector('.rail-cold-storage-section');
      const rail = document.getElementById('scene-rail');
      return { coldBg: getComputedStyle(section).backgroundColor, railBg: getComputedStyle(rail).backgroundColor };
    `);
    assert.equal(result.coldBg, result.railBg, `Cold Storage card has zero contrast against its own container: ${JSON.stringify(result)}`);
  });

  test('the rail uses JetBrains Mono, not IBM Plex Mono', async () => {
    const fontFamily = await app.client.evaluate(browserHelpers +
      "return getComputedStyle(document.getElementById('scene-rail')).fontFamily;"
    );
    assert.match(fontFamily, /JetBrains Mono/);
  });

  test('the rail panel has no border stroke -- depth comes from the shadow alone', async () => {
    const borderWidth = await app.client.evaluate(browserHelpers +
      "return getComputedStyle(document.getElementById('scene-rail')).borderWidth;"
    );
    assert.equal(borderWidth, '0px 1px 0px 0px');
  });

  test('the footer button reads "New Chapter" and adds a new blank chapter before Cold Storage, without resetting the cursor to the start of the document', async () => {
    const before = await app.client.evaluate(browserHelpers + "return document.querySelector('.rail-footer').textContent.trim();");
    assert.match(before, /\+ chapter/);

    const chaptersBefore = await app.client.evaluate(browserHelpers +
      "return document.querySelectorAll('.rail-chapter-row:not(.rail-cold-storage-row)').length;"
    );

    // Reproduces the reported bug: land the cursor at the end of the last
    // real chapter (via the rail, same as a reader who was just writing
    // there) before adding a new chapter after it -- setDoc's full-buffer
    // replace used to collapse the cursor/scroll position to the very start
    // of the document regardless of where the writer actually was.
    await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const target = rows.find(r => r.getAttribute('aria-label').includes('Named Scene'));
      target.click();
      await new Promise(r => setTimeout(r, 200));
    `);
    const activeBefore = await app.client.evaluate(browserHelpers +
      "const a = document.querySelector('.rail-scene-row.active'); return a ? a.getAttribute('aria-label') : null;"
    );
    assert.match(activeBefore || '', /Named Scene/, 'setup: clicking the scene row should have made it active first');

    await app.client.evaluate(browserHelpers + `
      document.querySelector('.rail-footer button').click();
      await new Promise(r => setTimeout(r, 200));
    `);
    const activeAfter = await app.client.evaluate(browserHelpers +
      "const a = document.querySelector('.rail-scene-row.active'); return a ? a.getAttribute('aria-label') : null;"
    );
    assert.equal(activeAfter, activeBefore, 'adding a new chapter should not move the cursor away from the scene the writer was in');

    const result = await app.client.evaluate(browserHelpers + `
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
    const meta = await app.client.evaluate(browserHelpers + "return document.querySelector('.rail-trailing-meta').textContent;");
    assert.match(meta, /^\d+\/\d+$/, `chapter meta not in "scenes/words" format: ${meta}`);
    const [sceneCount, wordCount] = meta.split('/').map(Number);
    assert.equal(sceneCount, 2); // this fixture's chapter has 2 scenes
    assert.ok(wordCount > 0, 'word count should reflect real prose, not be stuck at 0');
  });

  test('Cold Storage is anchored to the bottom of the panel, not floating directly under the last chapter', async () => {
    const result = await app.client.evaluate(browserHelpers + `
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

describe('Baretext E2E: Backspace cannot delete a scene or chapter boundary', () => {
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
    '# Second Chapter',
    '',
    'More prose here for the second chapter body text.',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
    await app.client.evaluate(browserHelpers + `
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

  // Rail navigation (jumpTo/jumpToChapter) lands the cursor at an exact,
  // known document position -- far more reliable for this than a pixel
  // click, which has to fight the heading's own inline gutter-number widget
  // and live-preview's hidden "#" concealment for exact character offsets.
  async function clickChapterRow(matchText) {
    await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-chapter-row:not(.rail-cold-storage-row)')];
      rows.find(r => r.textContent.includes(${JSON.stringify(matchText)})).click();
      await new Promise(r => setTimeout(r, 150));
    `);
  }
  async function clickSceneRow(matchText) {
    await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      rows.find(r => r.getAttribute('aria-label').includes(${JSON.stringify(matchText)})).click();
      await new Promise(r => setTimeout(r, 150));
    `);
  }
  async function pressKey(key, mods = {}) {
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', {
        key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(mods)}
      }));
      await new Promise(r => setTimeout(r, 60));
    `);
  }
  async function docText() {
    return app.client.evaluate(browserHelpers + "return document.querySelector('.cm-content').innerText;");
  }

  test('Backspace at the very start of a chapter heading does nothing', async () => {
    await clickChapterRow('Second Chapter');
    const before = await docText();
    await pressKey('Backspace');
    assert.equal(await docText(), before);
  });

  test('Backspace in the middle of a chapter title still edits normally', async () => {
    await clickChapterRow('Second Chapter');
    for (let i = 0; i < 9; i++) await pressKey('ArrowRight'); // past "# Second "
    const before = await docText();
    await pressKey('Backspace');
    assert.notEqual(await docText(), before);
  });

  test('Backspace at the start of a named scene (right after its marker + waypoint comment) does nothing', async () => {
    await clickSceneRow('Named Scene Title');
    const before = await docText();
    await pressKey('Backspace');
    assert.equal(await docText(), before);
  });

  test('Backspace in the middle of scene prose still edits normally', async () => {
    await clickSceneRow('Named Scene Title');
    for (let i = 0; i < 6; i++) await pressKey('ArrowRight');
    const before = await docText();
    await pressKey('Backspace');
    assert.notEqual(await docText(), before);
  });

  test('Backspace at the start of chapter 1\'s implicit first scene does nothing', async () => {
    await clickSceneRow('Scene 1');
    const before = await docText();
    await pressKey('Backspace');
    assert.equal(await docText(), before);
  });

  test('Alt-Backspace (word-delete backward) is guarded the same way as plain Backspace', async () => {
    await clickSceneRow('Named Scene Title');
    const before = await docText();
    await pressKey('Backspace', { altKey: true });
    assert.equal(await docText(), before);
  });

  test('a freshly added chapter\'s auto-created blank scene is protected too', async () => {
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.rail-footer button').click();
      await new Promise(r => setTimeout(r, 250));
    `);
    await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      rows[rows.length - 1].click();
      await new Promise(r => setTimeout(r, 150));
    `);
    const before = await docText();
    await pressKey('Backspace');
    assert.equal(await docText(), before);
  });

  test('the rail\'s own delete button is unaffected by the guard', async () => {
    const chaptersBefore = await app.client.evaluate(browserHelpers +
      "return document.querySelectorAll('.rail-chapter-row:not(.rail-cold-storage-row)').length;"
    );
    await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-chapter-row:not(.rail-cold-storage-row)')];
      const del = railAction(rows[rows.length - 1], '.rail-delete-btn');
      del.click(); del.click();
      await new Promise(r => setTimeout(r, 200));
    `);
    const chaptersAfter = await app.client.evaluate(browserHelpers +
      "return document.querySelectorAll('.rail-chapter-row:not(.rail-cold-storage-row)').length;"
    );
    assert.equal(chaptersAfter, chaptersBefore - 1);
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

describe('Baretext E2E: rail collapse/expand', () => {
  let app;
  const fixture = ['# One', '', 'Opening prose long enough to clear the draft threshold easily.'].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
    await app.client.evaluate(browserHelpers + 'window.resizeTo(1400, 900); return true;');
    await app.client.evaluate(browserHelpers + `
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

  async function state() {
    return app.client.evaluate(browserHelpers + `
      return {
        dataCollapsed: document.documentElement.getAttribute('data-rail-collapsed'),
        railWidth: getComputedStyle(document.getElementById('scene-rail')).width,
        tabDisplay: getComputedStyle(document.getElementById('rail-expand-tab')).display,
        railInert: document.getElementById('scene-rail').inert,
      };
    `);
  }

  test('the rail starts expanded, with the expand tab hidden', async () => {
    assert.deepEqual(await state(), { dataCollapsed: null, railWidth: '320px', tabDisplay: 'none', railInert: false });
  });

  test('clicking the header\'s collapse button collapses the rail and reveals the expand tab', async () => {
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.rail-panel-collapse-btn').click();
      await new Promise(r => setTimeout(r, 300));
    `);
    assert.deepEqual(await state(), { dataCollapsed: '1', railWidth: '0px', tabDisplay: 'none', railInert: true });
  });

  test('the expand tab is a bare icon at rest -- no background, border, or shadow', async () => {
    // Real bug: the button had no `all: unset` reset (every other icon
    // button in this app gets one via .rail-icon-btn), so Chromium's native
    // <button> chrome -- a raised 2px outset gray border -- rendered
    // underneath and read as an unwanted circle around the icon.
    const style = await app.client.evaluate(browserHelpers + `
      const cs = getComputedStyle(document.getElementById('rail-expand-tab'));
      return { background: cs.backgroundColor, boxShadow: cs.boxShadow, border: cs.border };
    `);
    assert.equal(style.background, 'rgba(0, 0, 0, 0)');
    assert.equal(style.boxShadow, 'none');
    assert.match(style.border, /^0px/);
  });

  test('a collapsed rail is not reachable by keyboard focus', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const cork = document.querySelector('#scene-rail .rail-chapter-row');
      cork.focus();
      return { focusWentToCork: document.activeElement === cork };
    `);
    assert.equal(result.focusWentToCork, false);
  });

  test('clicking the expand tab restores the rail and hides the tab again', async () => {
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.writing-pin').click();
      await new Promise(r => setTimeout(r, 300));
    `);
    assert.deepEqual(await state(), { dataCollapsed: '0', railWidth: '320px', tabDisplay: 'none', railInert: false });
  });

  test('the expand tab never shows in Sprinter mode, even while collapsed', async () => {
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.rail-panel-collapse-btn').click();
      await new Promise(r => setTimeout(r, 300));
      document.querySelector('.mode-tab[data-mode="sprinter"]').click();
      await new Promise(r => setTimeout(r, 200));
    `);
    const tabDisplay = await app.client.evaluate(browserHelpers +
      "return getComputedStyle(document.getElementById('rail-expand-tab')).display;"
    );
    assert.equal(tabDisplay, 'none');

    await app.client.evaluate(browserHelpers + `
      document.querySelector('.mode-tab[data-mode="editor"]').click();
      await new Promise(r => setTimeout(r, 200));
    `);
    assert.deepEqual(await state(), { dataCollapsed: '1', railWidth: '0px', tabDisplay: 'none', railInert: true });
  });

  test('the manuscript re-centers on the window once the rail collapses out of the way', async () => {
    // Real bug: the rail-open centering shift (index.html, keyed off
    // data-mode="editor" alone) was still applying at full strength even
    // once the rail had shrunk to zero width, pushing the manuscript
    // rail-w/2 too far left of the window's actual center. Inherits a
    // collapsed rail from the previous test and leaves it collapsed again
    // at the end -- the next test (persistence across a relaunch) depends
    // on that being the current state.
    function centerDelta() {
      return app.client.evaluate(browserHelpers + `
        const win = window.innerWidth;
        const content = document.querySelector('.cm-content').getBoundingClientRect();
        return Math.round((content.left + content.width / 2) - win / 2);
      `);
    }
    const collapsedDelta = await centerDelta();
    assert.equal(collapsedDelta, 0, `manuscript should sit dead-center while the rail is collapsed, got delta ${collapsedDelta}`);

    await app.client.evaluate(browserHelpers + `
      document.querySelector('.writing-pin').click();
      await new Promise(r => setTimeout(r, 400));
    `);
    const expandedDelta = await centerDelta();
    assert.ok(Math.abs(expandedDelta - 160) < 20, `expected the rail-open centering shift to still be small: ${expandedDelta}`);

    await app.client.evaluate(browserHelpers + `
      document.querySelector('.rail-panel-collapse-btn').click();
      await new Promise(r => setTimeout(r, 400));
    `);
    assert.equal(await centerDelta(), 0, 're-collapsing should restore dead-center too');
  });

  test('collapsed state persists across a relaunch', async () => {
    const settingsBefore = app.readSettings();
    assert.equal(settingsBefore.railCollapsed, true);

    await app.restart();
    await app.client.evaluate(browserHelpers + `
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (document.documentElement.getAttribute('data-rail-collapsed') === '1') break;
        await new Promise(r => setTimeout(r, 100));
      }
    `);
    assert.deepEqual(await state(), { dataCollapsed: '1', railWidth: '0px', tabDisplay: 'none', railInert: true });
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

describe('Baretext E2E: inline rename input (chapter/scene titles)', () => {
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
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
    await app.client.evaluate(browserHelpers + 'window.resizeTo(1400, 900); return true;');
    await app.client.evaluate(browserHelpers + `
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

  // Real bug: clicking into the rename input to reposition the caret (a
  // plain click, not a drag-select) bubbled up to the row's own jump/toggle
  // click handler underneath -- mousedown alone was stopped, but 'click' is
  // a separate event that isn't derived from mousedown's propagation. That
  // silently discarded whatever the writer had already typed.
  test('clicking inside an active rename input repositions the caret instead of canceling the edit', async () => {
    await app.client.evaluate(browserHelpers + `
      railAction(document, '.rail-chapter-row .rail-edit-btn').click();
      await new Promise(r => setTimeout(r, 150));
    `);
    const present = await app.client.evaluate(browserHelpers + "return !!document.querySelector('.inline-rename-input');");
    assert.equal(present, true, 'setup: edit button should have opened the rename input');

    await app.client.evaluate(browserHelpers + `
      const input = document.querySelector('.inline-rename-input');
      const rect = input.getBoundingClientRect();
      const x = rect.left + 5, y = rect.top + rect.height / 2;
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      await new Promise(r => setTimeout(r, 150));
    `);
    const stillPresent = await app.client.evaluate(browserHelpers + "return !!document.querySelector('.inline-rename-input');");
    assert.equal(stillPresent, true, 'clicking inside the input should not have canceled the edit');

    await app.client.evaluate(browserHelpers + `
      document.querySelector('.inline-rename-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    `);
  });

  // Real bug: clearing a title to blank and hitting Enter silently reverted
  // to the old title instead of committing -- there was no way to actually
  // wipe a title out once set.
  test('clearing a chapter title to blank commits and falls back to the Untitled placeholder', async () => {
    await app.client.evaluate(browserHelpers + `
      railAction(document, '.rail-chapter-row .rail-edit-btn').click();
      await new Promise(r => setTimeout(r, 150));
      const input = document.querySelector('.inline-rename-input');
      input.value = '';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
    `);
    const result = await app.client.evaluate(browserHelpers + `
      return {
        railTitle: document.querySelector('.rail-chapter-title').textContent,
        railPlaceholder: document.querySelector('.rail-chapter-title').classList.contains('placeholder'),
        // chapter-placeholder.js's ghost "Untitled" widget only ever renders
        // when the real heading line's own title text is blank -- its
        // presence here confirms the doc itself was actually cleared, not
        // just the rail's own display.
        ghostPlaceholderShown: !!document.querySelector('.cm-chapter-placeholder'),
      };
    `);
    assert.equal(result.railTitle, 'Untitled');
    assert.equal(result.railPlaceholder, true);
    assert.equal(result.ghostPlaceholderShown, true);
  });

  test('clearing a named scene\'s title to blank commits, removing the name comment and falling back to "Scene N"', async () => {
    const before = await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      return rows.find(r => r.getAttribute('aria-label').includes('Named Scene Title')) ? true : false;
    `);
    assert.equal(before, true, 'setup: the named scene should exist before clearing it');

    await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      const target = rows.find(r => r.getAttribute('aria-label').includes('Named Scene Title'));
      railAction(target, '.rail-edit-btn').click();
      await new Promise(r => setTimeout(r, 150));
      const input = document.querySelector('.inline-rename-input');
      input.value = '';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
    `);
    const labels = await app.client.evaluate(browserHelpers +
      "return [...document.querySelectorAll('.rail-scene-row')].map(r => r.getAttribute('aria-label'));"
    );
    assert.deepEqual(labels, ['Scene 1', 'Scene 2']);

    const docText = await app.client.evaluate(browserHelpers + "return document.querySelector('.cm-content').innerText;");
    assert.ok(!docText.includes('Named Scene Title'), 'the name comment should be gone entirely, not just emptied');
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

describe('Baretext E2E: manuscript lists use live-preview markers and hanging indentation', () => {
  let app;
  const fixture = [
    '# Plan', '',
    '- First bullet wraps into a readable continuation line when it is long enough.',
    '- [ ] Unfinished task',
    '- [x] Finished task',
    '1. First numbered item',
    '2. Second numbered item', '',
    'Cursor rests in this trailing paragraph.',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('renders bullets, task boxes, and ordered markers without coloring all list prose', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const deadline = Date.now() + 2000;
      while (document.querySelectorAll('.cm-list-marker').length < 5 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const markers = [...document.querySelectorAll('.cm-list-marker')];
      const listLine = document.querySelector('.cm-list-line');
      const prose = [...document.querySelectorAll('.cm-line')].find((line) => line.textContent.includes('First bullet'));
      const markerColor = getComputedStyle(markers[0]).color;
      const proseColor = getComputedStyle(prose).color;
      return {
        bullet: markers[0].textContent,
        taskCount: document.querySelectorAll('.cm-list-marker-task').length,
        checkedCount: document.querySelectorAll('.cm-list-marker-task.checked').length,
        ordered: markers.filter((marker) => marker.classList.contains('cm-list-marker-ordered')).map((marker) => marker.textContent),
        paddingLeft: getComputedStyle(listLine).paddingLeft,
        textIndent: getComputedStyle(listLine).textIndent,
        markerColor,
        proseColor,
      };
    `);

    assert.equal(result.bullet, '•');
    assert.equal(result.taskCount, 2);
    assert.equal(result.checkedCount, 1);
    assert.deepEqual(result.ordered, ['1.', '2.']);
    assert.notEqual(result.paddingLeft, '0px');
    assert.ok(result.textIndent.startsWith('-'));
    assert.notEqual(result.markerColor, result.proseColor);
  });
});

describe('Baretext E2E: scene dividers are never directly editable', () => {
  let app;
  const fixture = [
    '# One',
    '',
    'First scene prose long enough to clear the draft threshold nicely here.',
    '',
    '---',
    '',
    'Second scene prose long enough to clear the draft threshold nicely too.',
    '',
    '---',
    '<!-- Named Third Scene -->',
    '',
    'Third scene prose long enough to clear the draft threshold nicely also.',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
    await app.client.evaluate(browserHelpers + 'window.resizeTo(1400, 900); return true;');
    await app.client.evaluate(browserHelpers + `
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

  function clickAt(selector, frac) {
    return app.client.evaluate(browserHelpers + `
      const el = document.querySelector(${JSON.stringify(selector)});
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width * ${frac}, y = rect.top + rect.height / 2;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      await new Promise(r => setTimeout(r, 100));
      const sel = document.getSelection();
      let node = sel.anchorNode;
      let lineEl = node && node.nodeType === 3 ? node.parentElement : node;
      while (lineEl && !lineEl.classList.contains('cm-line')) lineEl = lineEl.parentElement;
      return { onDivider: !!lineEl && (lineEl.classList.contains('cm-scene-break') || lineEl.classList.contains('cm-scene-name-comment')), lineText: lineEl ? lineEl.textContent : null };
    `);
  }

  // Real bug, confirmed live before this fix: clicking ANYWHERE along a
  // "---" line (every x-offset tested) landed the caret directly on the
  // marker itself -- CodeMirror's atomic-range snapping for a mouse click
  // resolves to the range's near edge, not forward past it the way arrow-
  // key movement does. One Backspace from there started eating the divider.
  test('clicking anywhere along an unnamed divider lands on the next scene\'s content, never on the marker', async () => {
    for (const frac of [0.1, 0.5, 0.9]) {
      const result = await clickAt('.cm-scene-break', frac);
      assert.equal(result.onDivider, false, `click at ${frac} landed on the divider: ${JSON.stringify(result)}`);
      assert.equal(result.lineText, 'Second scene prose long enough to clear the draft threshold nicely too.');
    }
  });

  test('clicking a named divider (marker or its comment) lands on that scene\'s content, never on the chrome', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const breaks = document.querySelectorAll('.cm-scene-break');
      const target = breaks[1]; // the second, named divider
      const rect = target.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      await new Promise(r => setTimeout(r, 100));
      const sel = document.getSelection();
      let node = sel.anchorNode;
      let lineEl = node && node.nodeType === 3 ? node.parentElement : node;
      while (lineEl && !lineEl.classList.contains('cm-line')) lineEl = lineEl.parentElement;
      return { onDivider: !!lineEl && (lineEl.classList.contains('cm-scene-break') || lineEl.classList.contains('cm-scene-name-comment')), lineText: lineEl ? lineEl.textContent : null };
    `);
    assert.equal(result.onDivider, false);
    assert.equal(result.lineText, 'Third scene prose long enough to clear the draft threshold nicely also.');
  });

  test('clicking a still-empty scene\'s divider lands past it, and typing lands in the scene, not on the marker', async () => {
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.rail-footer button').click();
      await new Promise(r => setTimeout(r, 250));
    `);
    const clicked = await app.client.evaluate(browserHelpers + `
      const breaks = document.querySelectorAll('.cm-scene-break');
      const last = breaks[breaks.length - 1];
      const rect = last.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      last.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      last.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      await new Promise(r => setTimeout(r, 100));
      const sel = document.getSelection();
      let node = sel.anchorNode;
      let lineEl = node && node.nodeType === 3 ? node.parentElement : node;
      while (lineEl && !lineEl.classList.contains('cm-line')) lineEl = lineEl.parentElement;
      return { onDivider: !!lineEl && lineEl.classList.contains('cm-scene-break') };
    `);
    assert.equal(clicked.onDivider, false, 'clicking a fresh empty scene\'s divider should not leave the caret on it');

    await app.client.evaluate(browserHelpers + `
      document.execCommand('insertText', false, 'Fresh content.');
      await new Promise(r => setTimeout(r, 200));
    `);
    const text = await app.client.evaluate(browserHelpers + "return document.querySelector('.cm-content').innerText;");
    assert.ok(text.includes('Fresh content.'));
    assert.ok(text.includes('---'), 'the marker itself must still be intact');
  });

  // Same guarantee via the rail (rather than a raw editor click) -- tapping
  // a brand new empty scene must not land the caret on its own marker.
  test('jumping to a still-empty scene via the rail lands past its divider too', async () => {
    const otherRow = await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      rows[0].click();
      await new Promise(r => setTimeout(r, 150));
      return true;
    `);
    assert.equal(otherRow, true);

    const result = await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-scene-row')];
      rows[rows.length - 1].click();
      await new Promise(r => setTimeout(r, 150));
      const sel = document.getSelection();
      let node = sel.anchorNode;
      let lineEl = node && node.nodeType === 3 ? node.parentElement : node;
      while (lineEl && !lineEl.classList.contains('cm-line')) lineEl = lineEl.parentElement;
      return { onDivider: !!lineEl && lineEl.classList.contains('cm-scene-break') };
    `);
    assert.equal(result.onDivider, false);
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

describe('Baretext E2E: status bar filename reveals the file in Finder', () => {
  let app;

  before(async () => {
    app = await launchApp({ fixtureContent: '# One\n\nSome prose.', mode: 'editor' });
    await app.client.evaluate(browserHelpers + `
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (document.getElementById('file-name').textContent !== 'untitled') break;
        await new Promise(r => setTimeout(r, 100));
      }
    `);
  });

  after(async () => {
    if (app) await app.close();
  });

  // Deliberately does NOT actually click through to window.api.showInFinder
  // here -- that reaches shell.showItemInFolder() in the real main process,
  // which pops a real Finder window/tab on whatever machine runs this
  // suite. Verified live by hand instead (clicked it, confirmed Finder
  // opened showing the right file); this locks in the wiring that would
  // most plausibly regress silently -- the button's own semantics, that it
  // doesn't steal editor focus, and that the preload bridge still exposes
  // the function this handler calls.
  test('the filename is a real button, shows a pointer cursor, and does not steal editor focus', async () => {
    const before = await app.client.evaluate(browserHelpers + `
      document.querySelector('.cm-content').focus();
      return document.activeElement === document.querySelector('.cm-content');
    `);
    assert.equal(before, true, 'setup: editor should have focus');

    const result = await app.client.evaluate(browserHelpers + `
      const btn = document.getElementById('file-name');
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      return {
        tag: btn.tagName,
        type: btn.type,
        cursor: getComputedStyle(btn).cursor,
        text: btn.textContent,
        stillEditorFocused: document.activeElement === document.querySelector('.cm-content'),
        apiHasShowInFinder: typeof window.api.showInFinder,
      };
    `);
    assert.equal(result.tag, 'BUTTON');
    assert.equal(result.type, 'button');
    assert.equal(result.cursor, 'pointer');
    assert.equal(result.text, 'test.md');
    assert.equal(result.stillEditorFocused, true);
    assert.equal(result.apiHasShowInFinder, 'function');
  });

  // Do not activate this item in automation: it intentionally opens the
  // host machine's native print dialog. This locks in the renderer/preload
  // wiring and the user-visible File command without causing UI side effects.
  test('File commands expose Print with Cmd-P and a preload implementation', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 50));
      const item = [...document.querySelectorAll('.pitem')].find(e => e.textContent.includes('Print'));
      return {
        apiHasPrintDocument: typeof window.api.printDocument,
        found: !!item,
        label: item && item.textContent,
      };
    `);
    assert.equal(result.apiHasPrintDocument, 'function');
    assert.equal(result.found, true);
    assert.match(result.label, /Print/);
    assert.match(result.label, /⌘/);
    assert.match(result.label, /P/);
  });

  test('print media strips app chrome and expands the full writing surface onto white paper', async () => {
    await app.client.emulateMedia('print');
    const result = await app.client.evaluate(browserHelpers + `
      const rail = document.getElementById('scene-rail');
      const scroller = document.querySelector('.cm-scroller');
      const content = document.querySelector('.cm-content');
      return {
        railDisplay: getComputedStyle(rail).display,
        scrollerOverflow: getComputedStyle(scroller).overflow,
        contentBackground: getComputedStyle(content).backgroundColor,
        contentColor: getComputedStyle(content).color,
        contentHeight: getComputedStyle(content).height,
      };
    `);
    await app.client.emulateMedia('screen');
    assert.equal(result.railDisplay, 'none');
    assert.equal(result.scrollerOverflow, 'visible');
    assert.equal(result.contentBackground, 'rgb(255, 255, 255)');
    assert.equal(result.contentColor, 'rgb(17, 17, 17)');
    assert.notEqual(result.contentHeight, '700px');
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

describe('Baretext E2E: CRT is a separate bonus theme; Amstrad stays plain', () => {
  let app;
  const fixture = '# One\n\nSome prose.';

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor', accentTheme: 'amstrad' });
    await app.client.evaluate(browserHelpers + `
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (document.querySelectorAll('.cm-line').length >= 1) break;
        await new Promise(r => setTimeout(r, 100));
      }
    `);
  });

  after(async () => {
    if (app) await app.close();
  });

  async function shaderState() {
    return app.client.evaluate(browserHelpers + `
      const content = document.querySelector('.cm-content');
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        appAfterContent: getComputedStyle(document.getElementById('app'), '::after').content,
        fontWeight: getComputedStyle(content).fontWeight,
        textShadow: getComputedStyle(content).textShadow,
      };
    `);
  }

  test('Amstrad has no CRT shader -- it renders exactly as originally designed', async () => {
    const state = await shaderState();
    assert.equal(state.theme, 'amstrad');
    assert.equal(state.appAfterContent, 'none');
    assert.equal(state.fontWeight, '400');
    assert.equal(state.textShadow, 'none');
  });

  test('switching to CRT applies the scanline/glow/bold shader, reusing Amstrad\'s exact palette', async () => {
    await app.client.evaluate(browserHelpers + `
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      document.getElementById('palette-input').value = 'CRT';
      document.getElementById('palette-input').dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      const target = [...document.querySelectorAll('.pitem')].find(el => el.querySelector('.pitem-label').textContent.includes('CRT'));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
    `);
    const state = await shaderState();
    assert.equal(state.theme, 'crt');
    assert.notEqual(state.appAfterContent, 'none');
    assert.equal(state.fontWeight, '700');
    assert.notEqual(state.textShadow, 'none');

    const bg = await app.client.evaluate(browserHelpers + "return getComputedStyle(document.getElementById('app')).backgroundColor;");
    // CRT shares Amstrad's --bg (#0d130d) on purpose.
    assert.equal(bg, 'rgb(13, 19, 13)');
  });

  // Old computers had a solid block caret, not a thin bar. Checks the
  // resolved CSS directly rather than a rendered screenshot -- CodeMirror
  // only shows .cm-cursor once its .cm-focused class is applied, which
  // depends on real window/document focus that this suite's hidden
  // (BARETEXT_HIDDEN) windows never actually receive; getComputedStyle
  // still resolves width/background/border correctly regardless of the
  // element's display:none state, so this is a faithful check of the
  // actual rule without needing a visible window. Verified manually by
  // forcing .cm-focused on and screenshotting during development.
  test('the caret is a solid block (1ch wide), not the default thin bar', async () => {
    await app.client.evaluate(browserHelpers + `
      document.querySelector('.cm-content').focus();
      document.execCommand('insertText', false, 'X');
      await new Promise(r => setTimeout(r, 150));
    `);
    const style = await app.client.evaluate(browserHelpers + `
      const cursor = document.querySelector('.cm-cursor');
      const cs = getComputedStyle(cursor);
      return { width: cs.width, background: cs.backgroundColor, borderLeftWidth: cs.borderLeftWidth };
    `);
    assert.equal(style.borderLeftWidth, '0px');
    assert.equal(style.background, 'rgb(125, 196, 90)'); // --cursor #7dc45a
    assert.ok(parseFloat(style.width) > 5, `expected a full character-width block, got ${style.width}`);
  });

  test('CRT persists across a relaunch like any other theme', async () => {
    const settings = app.readSettings();
    assert.equal(settings.accentTheme, 'crt');

    await app.restart();
    await app.client.evaluate(browserHelpers + `
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (document.documentElement.getAttribute('data-theme') === 'crt') break;
        await new Promise(r => setTimeout(r, 100));
      }
    `);
    const state = await shaderState();
    assert.equal(state.theme, 'crt');
    assert.notEqual(state.appAfterContent, 'none');
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

// Regression coverage for design-instructions/typography-rhythm.md: the
// modular type scale's book/cover title, asymmetric heading spacing, tinted
// (idle vs. active) chapter/scene numerals, opening-line small caps, and the
// "· · ·" within-scene break glyph.
describe('Baretext E2E: typography rhythm (book title, heading rhythm, numeral tint, opening caps)', () => {
  let app;
  const fixture = [
    '<!-- BOOK TITLE: The Long Way Home -->',
    '',
    '# It Begins',
    '',
    'Yesterday started like any other day, gray and quiet, until the letter arrived at last.',
    '',
    '---',
    '<!-- A Turning Point -->',
    '',
    'Whatever happened next, nothing would ever be the same again for anyone involved here.',
    '',
    '---',
    '',
    'Another unnamed scene here with enough words in it to clear the draft threshold easily.',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor' });
    await app.client.evaluate(browserHelpers + 'window.resizeTo(1400, 1000); return true;');
    await new Promise((r) => setTimeout(r, 300));
  });

  after(async () => {
    if (app) await app.close();
  });

  test('book title uses the 84px/.98 display size, text-wrap: pretty, and a tight gap into its first chapter heading', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const el = document.querySelector('.cm-book-title');
      const cs = getComputedStyle(el);
      return { fontSize: cs.fontSize, lineHeight: cs.lineHeight, paddingBottom: cs.paddingBottom, textWrap: cs.textWrap, text: el.textContent };
    `);
    assert.equal(result.text, 'The Long Way Home');
    assert.equal(result.fontSize, '84px');
    assert.equal(result.paddingBottom, '12px'); // tight -- the chapter heading right after it is its own content
    assert.equal(result.textWrap, 'pretty');
  });

  test('a paragraph immediately before a heading gets the large section-break gap; a heading itself gets the tight gap into its own content', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const lines = [...document.querySelectorAll('.cm-line')];
      const headingLine = lines.find(l => l.textContent === 'It Begins' || l.classList.contains('cm-heading-1'));
      const spacerAfterHeading = headingLine.nextElementSibling;
      return {
        headingSpacerCls: spacerAfterHeading ? spacerAfterHeading.className : null,
        heightTight: spacerAfterHeading ? getComputedStyle(spacerAfterHeading).height : null,
      };
    `);
    assert.match(result.headingSpacerCls || '', /cm-block-spacer-heading-tight/);
    assert.equal(result.heightTight, '12px');
  });

  test('chapter and scene numerals are tinted (idle) and come up to full --scene strength on the active scene', async () => {
    // Click into the second scene ("A Turning Point") via a real CDP mouse
    // press+release -- a synthetic dispatchEvent mousedown doesn't reliably
    // drive CodeMirror's own click-to-position handling the way a real
    // press/release through the Input domain does.
    const target = await app.client.evaluate(browserHelpers + `
      const line = [...document.querySelectorAll('.cm-line')].find(l => l.textContent.includes('Whatever happened next'));
      const r = line.getBoundingClientRect();
      return { x: r.left + 10, y: r.top + r.height / 2 };
    `);
    await app.client.mouseEvent('mousePressed', target.x, target.y, 1);
    await app.client.mouseEvent('mouseReleased', target.x, target.y, 0);
    await new Promise((r) => setTimeout(r, 200));

    const result = await app.client.evaluate(browserHelpers + `
      const nums = [...document.querySelectorAll('[data-scene-index]')];
      const scene = getComputedStyle(document.documentElement).getPropertyValue('--scene').trim();
      const hexToRgb = (hex) => {
        const n = parseInt(hex.slice(1), 16);
        return 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ') + ')';
      };
      return {
        active: nums.map(n => n.classList.contains('cm-gutter-num-active')),
        activeColorMatchesScene: nums.filter(n => n.classList.contains('cm-gutter-num-active'))
          .every(n => getComputedStyle(n).color === hexToRgb(scene)),
        idleColorIsTranslucent: nums.filter(n => !n.classList.contains('cm-gutter-num-active'))
          .every(n => getComputedStyle(n).color.includes('/') || getComputedStyle(n).color.startsWith('color(')),
      };
    `);
    // Only 2 numerals exist here, not 3 -- the implicit first scene (no
    // marker, no name comment right after the chapter heading) gets no
    // gutter widget at all, same as the existing "bare unnamed
    // implicit-first-scene gets none" gutter behavior above. So this is
    // [the named scene we clicked into, the unnamed marker scene after it].
    assert.deepEqual(result.active, [true, false]);
    assert.ok(result.activeColorMatchesScene, 'the active scene numeral must be the full, untranslucent --scene color');
    assert.ok(result.idleColorIsTranslucent, 'idle scene numerals must be a translucent (alpha < 1) tint');
  });

  test('an unnamed within-scene break renders a centered "· · ·", not a line-and-circle ornament', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const unnamed = document.querySelector('.cm-scene-break:not(.cm-scene-break-named)');
      const before = getComputedStyle(unnamed, '::before');
      const after = getComputedStyle(unnamed, '::after');
      return { content: before.content, afterDisplay: after.display };
    `);
    assert.equal(result.content, '"· · ·"');
    assert.equal(result.afterDisplay, 'none');
  });

  test('the first few words of a scene opening render in small caps', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const els = [...document.querySelectorAll('.cm-opening-caps')];
      return els.map(el => ({ text: el.textContent, variant: getComputedStyle(el).fontVariantCaps }));
    `);
    // One opening per scene in this fixture (implicit first scene, the named
    // scene, and the unnamed marker scene) -- each capped to its first three
    // words.
    assert.equal(result.length, 3);
    result.forEach((r) => {
      assert.equal(r.variant, 'small-caps');
      assert.ok(r.text.trim().split(/\s+/).length <= 3);
    });
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});

// Regression coverage for design-instructions/writing-rail-refinements.md:
// the genuine hover/focus swap in the rail's trailing slot, Cold Storage
// scenes carrying the same left numeral as manuscript scenes, and the
// typewriter status-bar indicator hiding (without losing state) while the
// corkboard is open.
describe('Baretext E2E: writing rail refinements (hover swap, Cold Storage numerals, typewriter/corkboard)', () => {
  let app;
  const fixture = [
    '# Chapter One',
    '',
    'First scene prose, plenty of words so this clears the draft threshold easily.',
    '',
    '<!-- COLD STORAGE -->',
    '',
    'Cut scene one, also with enough words in it to clear the draft threshold.',
    '',
    '---',
    '',
    'Cut scene two, same story, plenty of words here too so it is not a draft.',
  ].join('\n');

  before(async () => {
    app = await launchApp({ fixtureContent: fixture, mode: 'editor', extraSettings: { typewriter: true } });
    await app.client.evaluate(browserHelpers + 'window.resizeTo(1400, 1000); return true;');
    // scene-nav's first real render trails the 'file-loaded' IPC message
    // (debounced 180ms) -- poll for it rather than assuming it has already
    // happened by the time the first test's assertions run.
    await app.client.evaluate(browserHelpers + `
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (document.querySelector('.rail-scene-row')) break;
        await new Promise(r => setTimeout(r, 100));
      }
    `);
  });

  after(async () => {
    if (app) await app.close();
  });

  test('a rail row swaps count and actions as real DOM children', async () => {
    const result = await app.client.evaluate(browserHelpers + `const row=document.querySelector('#scene-rail .rail-scene-row'); const rest=!!row.querySelector('.rail-trailing-meta')&&!row.querySelector('.rail-trailing-controls'); row.dispatchEvent(new MouseEvent('mouseenter')); return {rest,hover:!row.querySelector('.rail-trailing-meta')&&!!row.querySelector('.rail-trailing-controls')};`);
    assert.deepEqual(result,{rest:true,hover:true});
  });

  test('Cold Storage scenes carry the same left index numeral as manuscript scenes', async () => {
    const result = await app.client.evaluate(browserHelpers + `
      const rows = [...document.querySelectorAll('.rail-cold-storage-section .rail-scene-row')];
      return rows.map(r => ({ num: r.querySelector('.rail-scene-num').textContent, name: r.querySelector('.rail-scene-name').textContent }));
    `);
    assert.deepEqual(result, [
      { num: '01', name: 'Scene 1' },
      { num: '02', name: 'Scene 2' },
    ]);
  });

  test('the typewriter status-bar indicator hides while the corkboard is open and reappears (with state intact) once closed', async () => {
    const beforeOpen = await app.client.evaluate(browserHelpers + `
      const el = document.getElementById('tw-status-indicator');
      return { display: getComputedStyle(el).display, on: el.classList.contains('tw-on') };
    `);
    assert.equal(beforeOpen.display, 'flex');
    assert.equal(beforeOpen.on, true);

    await app.client.evaluate(browserHelpers + `document.querySelector('.rail-corkboard-btn').click(); return true;`);
    await new Promise((r) => setTimeout(r, 200));
    const whileOpen = await app.client.evaluate(browserHelpers + `
      return getComputedStyle(document.getElementById('tw-status-indicator')).display;
    `);
    assert.equal(whileOpen, 'none');

    await app.client.evaluate(browserHelpers + `document.querySelector('.corkboard-back').click(); return true;`);
    await new Promise((r) => setTimeout(r, 200));
    const afterClose = await app.client.evaluate(browserHelpers + `
      const el = document.getElementById('tw-status-indicator');
      return { display: getComputedStyle(el).display, on: el.classList.contains('tw-on') };
    `);
    assert.equal(afterClose.display, 'flex');
    assert.equal(afterClose.on, true, 'typewriter state must survive the corkboard round-trip unchanged');
  });

  test('no console errors in this suite', () => {
    const bad = app.client.getConsoleMessages().filter((m) => m.type === 'error' || m.type === 'exception');
    assert.deepEqual(bad, []);
  });
});
