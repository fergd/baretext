import { getManuscript, findActiveScene } from './model.js';
import { reorderScenes, reorderChapters } from './reorder.js';
import { el, btn, icon, injectStyle as injectStyleTag } from '../../dom.js';
import { makeDeleteButton, beginEdit } from './ui-helpers.js';

let ctx = null;
let railEl = null;
let collapsed = new Set(); // chapter indices
// { type: 'chapter', chapterIndex } or { type: 'scene', chapterIndex, sceneIndex }
// while a drag is in progress -- set on dragstart, read by whatever row the
// drop lands on, cleared on dragend/drop regardless of outcome.
let dragSource = null;

// Wipes every row's drag-feedback classes, regardless of which one (if any)
// currently has them -- called on every dragend so a drag that ends outside
// any valid drop target (dropped off the rail entirely, or the whole rail
// re-rendered mid-drag) never leaves a stale indicator line/wash behind on
// a row that's no longer being dragged over.
function clearDropIndicators() {
  if (!railEl) return;
  railEl.querySelectorAll('.drag-over, .drop-before, .drop-after').forEach((r) => {
    r.classList.remove('drag-over', 'drop-before', 'drop-after');
  });
}

function injectStyle() {
  injectStyleTag('scene-rail-style', `
#scene-rail { font-family: var(--font-mono); }
.rail-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 10px;
}
.rail-header-right { display: flex; align-items: center; gap: 10px; }
.rail-label {
  font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--syntax-2, var(--accent)); font-weight: 600; opacity: .85;
}
.rail-dim { font-size: 11px; color: var(--text-dimmer); font-variant-numeric: tabular-nums; }
.rail-corkboard-btn {
  all: unset; box-sizing: border-box; position: relative; cursor: pointer;
  font-size: 13px; color: var(--text-dim); transition: color .15s ease;
}
.rail-corkboard-btn::before { content: ''; position: absolute; inset: -8px; }
.rail-corkboard-btn:hover { color: var(--syntax-2, var(--accent)); }
.rail-list { flex: 1; overflow: auto; padding: 0 8px; }
.rail-chapter-row {
  display: flex; align-items: center; gap: 7px; padding: 8px; border-radius: 7px; cursor: pointer;
}
.rail-chapter-row:hover { background: var(--wash-accent); }
.rail-chevron { font-size: 14px; color: var(--text-dim); flex-shrink: 0; }
.rail-chapter-num { font-size: 11px; color: var(--text-dimmer); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.rail-chapter-title { font-size: 12px; color: var(--text); font-weight: 700; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-chapter-title.placeholder { color: var(--text-dimmer); font-weight: 600; font-style: italic; }
.rail-edit-btn {
  all: unset; box-sizing: border-box; position: relative;
  font-size: 11px; color: var(--text-dimmer); opacity: .5; cursor: pointer; flex-shrink: 0;
  transition: opacity .12s ease, color .12s ease;
}
.rail-edit-btn::before { content: ''; position: absolute; inset: -8px; }
/* Rename/delete/drag are core scene-management actions -- hover-only
   visibility would make them permanently unreachable by keyboard, touch, or
   screen reader. Stay visually quiet by default, come to full strength on
   row hover AND :focus-within (so tabbing to a button inside a row reveals
   it too, not just mouse hover). */
.rail-chapter-row:hover .rail-edit-btn, .rail-scene-row:hover .rail-edit-btn,
.rail-chapter-row:focus-within .rail-edit-btn, .rail-scene-row:focus-within .rail-edit-btn { opacity: 1; }
.rail-edit-btn:hover { color: var(--syntax-2, var(--accent)); }
.rail-delete-btn {
  all: unset; box-sizing: border-box; position: relative;
  font-size: 11px; color: var(--text-dimmer); opacity: .5; cursor: pointer; flex-shrink: 0;
  padding: 2px 5px; border-radius: 4px; display: flex; align-items: center; gap: 4px;
  transition: opacity .12s ease, color .12s ease, background .12s ease;
}
.rail-delete-btn::before { content: ''; position: absolute; inset: -6px; }
.rail-chapter-row:hover .rail-delete-btn, .rail-scene-row:hover .rail-delete-btn,
.rail-chapter-row:focus-within .rail-delete-btn, .rail-scene-row:focus-within .rail-delete-btn { opacity: 1; }
.rail-delete-btn:hover { color: #e05c5c; }
.rail-delete-btn.confirm {
  opacity: 1; color: #e05c5c; font-weight: 600;
  background: color-mix(in srgb, #e05c5c 15%, transparent);
}
.rail-scene-list {
  margin: 1px 0 8px 16px; padding-left: 11px;
  border-left: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 1px;
}
.rail-scene-row {
  padding: 7px 10px; border-radius: 6px; cursor: pointer;
  display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
}
.rail-scene-row:hover { background: var(--wash-accent); }
.rail-scene-row.active { background: var(--wash-accent-strong); box-shadow: inset 2px 0 0 var(--syntax-2, var(--accent)); }
.rail-scene-name-group { display: flex; align-items: baseline; gap: 6px; min-width: 0; flex: 1; }
.rail-scene-row .rail-scene-name { font-size: 12px; color: var(--text-dim); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-scene-row.active .rail-scene-name { color: var(--text); }
.rail-scene-row.draft .rail-scene-name { font-style: italic; opacity: .7; }
.inline-rename-input {
  flex: 1; min-width: 0; background: color-mix(in srgb, var(--bg) 55%, transparent);
  border: 1px solid var(--syntax-2, var(--accent)); border-radius: 4px; padding: 2px 6px;
  color: var(--text); font-family: var(--font-mono); font-size: 12px; outline: none;
}
.rail-footer {
  all: unset; box-sizing: border-box; width: 100%; cursor: pointer;
  display: flex; align-items: center; gap: 8px; padding: 12px 16px; min-height: 44px;
  border-top: 1px solid var(--border); color: var(--text-dim); font-size: 12px;
}
.rail-footer:hover { color: var(--text); }
.rail-scene-add {
  all: unset; box-sizing: border-box; width: 100%; cursor: pointer;
  margin-top: 2px; padding: 6px 10px; border-radius: 6px;
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--text-dimmer); opacity: .75;
  transition: opacity .12s ease, color .12s ease, background .12s ease;
}
.rail-scene-add:hover, .rail-scene-add:focus-visible { opacity: 1; color: var(--syntax-2, var(--accent)); background: var(--wash-accent); }
.rail-scene-add .ti-plus { font-size: 12px; }
.rail-drag-handle {
  all: unset; box-sizing: border-box; position: relative;
  font-size: 12px; color: var(--text-dimmer); opacity: .5; cursor: grab; flex-shrink: 0;
  transition: opacity .12s ease, color .12s ease;
}
.rail-drag-handle::before { content: ''; position: absolute; inset: -8px; }
.rail-chapter-row:hover .rail-drag-handle, .rail-scene-row:hover .rail-drag-handle,
.rail-chapter-row:focus-within .rail-drag-handle, .rail-scene-row:focus-within .rail-drag-handle { opacity: 1; }
.rail-drag-handle:hover { color: var(--syntax-2, var(--accent)); }
.rail-drag-handle:active { cursor: grabbing; }
.rail-chapter-row.dragging, .rail-scene-row.dragging { opacity: .35; }
/* Dropping a scene directly ON a chapter header always appends it to that
   chapter (no "before/after" to choose among scenes) -- the whole-row wash
   reads as "goes in here". Reordering rows (scene-on-scene, chapter-on-
   chapter) instead gets a thin line at the exact edge the drop will land
   on, split via dragover's own cursor-Y-vs-row-midpoint check below --
   previously a drop always landed BEFORE whatever row it was released on
   with no visual telling you that, so "drop near the bottom of a row" and
   "drop near its top" looked identical but did different things. */
.rail-chapter-row.drag-over { background: var(--wash-accent); box-shadow: inset 0 0 0 1px var(--syntax-2, var(--accent)); }
.rail-chapter-row, .rail-scene-row { position: relative; }
.rail-chapter-row.drop-before::before, .rail-scene-row.drop-before::before,
.rail-chapter-row.drop-after::after, .rail-scene-row.drop-after::after {
  content: ''; position: absolute; left: 4px; right: 4px; height: 2px;
  background: var(--syntax-2, var(--accent)); border-radius: 1px; pointer-events: none;
}
.rail-chapter-row.drop-before::before, .rail-scene-row.drop-before::before { top: -2px; }
.rail-chapter-row.drop-after::after, .rail-scene-row.drop-after::after { bottom: -2px; }
.rail-cold-storage-row {
  margin-top: 10px; padding-top: 10px;
  border-top: 1px solid var(--border);
}
.rail-cold-storage-row .ti-snowflake { font-size: 12px; color: var(--syntax-4, var(--text-dim)); flex-shrink: 0; }
.rail-cold-storage-title {
  font-size: 12px; color: var(--text-dim); font-weight: 600; font-style: italic;
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rail-cold-storage-hint {
  padding: 8px 10px; font-size: 11px; color: var(--text-dimmer); font-style: italic; opacity: .7;
}
`);
}

// Scopes native HTML5 drag-and-drop to a small handle icon instead of the
// whole row: `row` only becomes draggable while the mouse is down on the
// handle, and reverts right after (mouseup fires whether or not a drag
// actually started) -- otherwise the whole row would initiate a drag on any
// press+move, stealing the gesture from click-to-toggle/click-to-jump/
// click-to-rename.
//
// Deliberately NOT built from btn(): btn()'s mousedown->preventDefault()
// (the "don't steal focus from the editor" trick used everywhere else)
// silently disables native drag here -- Chromium never starts a drag from a
// mousedown whose default action was prevented, so the handle looked wired
// up correctly but never actually initiated a drag (confirmed live: zero
// drag events of any kind fired on a real mouse-driven press+move+release
// over the handle before this fix). stopPropagation() alone is enough to
// stop the row's own toggle/jump mousedown from also firing.
function makeDragHandle(row, label) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'rail-drag-handle';
  handle.appendChild(icon('ti-grip-vertical'));
  handle.title = 'drag to reorder, or focus the row and use ⌥↑/⌥↓';
  handle.setAttribute('aria-label', 'Reorder ' + label + ' (⌥↑/⌥↓ on the row)');
  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    row.draggable = true;
  });
  // A plain click (press+release with no drag motion) has no action of its
  // own here, but would otherwise bubble up and trigger the row's own
  // toggle/jump click handler -- stop it, same as edit/delete already do.
  handle.addEventListener('click', (e) => e.stopPropagation());
  row.addEventListener('mouseup', () => { row.draggable = false; });
  return handle;
}

// mousedown still gets preventDefault() (preserves "don't steal focus from
// the editor on a mouse click" for the tree rows themselves, same trick as
// btn()); the actual action binds to click, which still fires normally.
function onActivate(element, handler) {
  element.addEventListener('mousedown', (e) => e.preventDefault());
  element.addEventListener('click', handler);
}

function jumpTo(scene) {
  // A real chapter scene's position is only actually visible/reachable
  // once Cold Storage scene view (if active) is exited -- everything
  // outside the isolated scene is hidden while it's on. No-ops if scene
  // view isn't active.
  ctx.exitColdStorageScene();
  ctx.editor.setCursorPos(ctx.view, scene.pos);
  ctx.editor.scrollToTop(ctx.view);
  ctx.focusEditor();
  ctx.refreshNav();
}

function toggleChapter(ci) {
  if (collapsed.has(ci)) collapsed.delete(ci); else collapsed.add(ci);
  render();
}

function rowSelector(type, ci, si) {
  return type === 'chapter'
    ? `.rail-chapter-row[data-ci="${ci}"]`
    : `.rail-scene-row[data-ci="${ci}"][data-si="${si}"]`;
}

function refocusRow(type, ci, si) {
  const target = railEl.querySelector(rowSelector(type, ci, si));
  if (target) target.focus();
}

// Keyboard alternative to drag-and-drop -- reordering the manuscript
// shouldn't require a mouse. ⌥↑/⌥↓ on a focused row moves it by one
// position (chapters among chapters; scenes within their own chapter only
// -- cross-chapter keyboard moves aren't supported, drag remains available
// for that). Mirrors reorderScenes/reorderChapters' "insert before toIndex"
// convention: moving up needs toIndex = index-1; moving down needs
// toIndex = index+2 (the extra +1 accounts for the removal shift the
// functions already apply when fromIndex < toIndex).
function moveChapter(ci, dir) {
  const chapters = getManuscript(ctx.view);
  // chapters.length always includes the trailing Cold Storage entry (see
  // model.js) — bounding against it directly would let ⌥↓ on the last real
  // chapter "swap" it past Cold Storage, which isn't a real chapter and
  // isn't a valid reorder target. Cold Storage's own row also shares
  // dataset.type="chapter" (for arrow-key nav / expand-collapse), so ⌥↑/⌥↓
  // focused there needs its own explicit no-op, not just a bounds miss.
  const realChapterCount = chapters.length - 1;
  if (ci >= realChapterCount) return;
  const targetCi = ci + dir;
  if (targetCi < 0 || targetCi >= realChapterCount) return;
  const toIndex = dir < 0 ? ci - 1 : ci + 2;
  const moved = reorderChapters(chapters, { fromIndex: ci, toIndex });
  if (moved === null) return;
  ctx.setDoc(moved);
  ctx.refreshNav();
  refocusRow('chapter', targetCi, null);
}

function moveScene(ci, si, dir) {
  const chapters = getManuscript(ctx.view);
  const chapter = chapters[ci];
  const targetSi = si + dir;
  if (!chapter || targetSi < 0 || targetSi >= chapter.scenes.length) return;
  const toSceneIndex = dir < 0 ? si - 1 : si + 2;
  const moved = reorderScenes(chapters, {
    fromChapterIndex: ci, fromSceneIndex: si, toChapterIndex: ci, toSceneIndex,
  });
  if (moved === null) return;
  ctx.setDoc(moved);
  ctx.refreshNav();
  refocusRow('scene', ci, targetSi);
}

// Delegated on #scene-rail so it survives re-renders without re-attaching.
// Arrow keys give a fast path between rows without tabbing through every
// inline action button (which stay independently reachable via Tab).
function onTreeKeydown(e) {
  // Only handle keys when the ROW ITSELF has focus, not a nested button
  // (edit/delete/drag-handle) -- those are real buttons with their own
  // native Enter/Space activation; re-interpreting the same keydown here
  // too (it still bubbles) would double-fire both actions.
  if (!e.target.matches('.rail-chapter-row, .rail-scene-row')) return;
  const row = e.target;
  const type = row.dataset.type;
  const ci = Number(row.dataset.ci);
  const si = row.dataset.si !== undefined ? Number(row.dataset.si) : null;

  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? -1 : 1;
    if (type === 'chapter') moveChapter(ci, dir); else moveScene(ci, si, dir);
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = Array.from(railEl.querySelectorAll('.rail-chapter-row, .rail-scene-row'));
    const idx = rows.indexOf(row);
    const nextIdx = e.key === 'ArrowDown' ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0);
    rows[nextIdx].focus();
    return;
  }
  if (type === 'chapter' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const isCollapsed = collapsed.has(ci);
    if ((e.key === 'ArrowRight' && !isCollapsed) || (e.key === 'ArrowLeft' && isCollapsed)) return;
    e.preventDefault();
    toggleChapter(ci);
    refocusRow('chapter', ci, null);
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    // preventDefault matters for Space specifically -- an unhandled Space on
    // a focused non-form element otherwise scrolls the rail.
    e.preventDefault();
    row.click();
    // A chapter's click rebuilds the whole rail (render()), which drops
    // focus since the old row element is gone -- restore it. A scene's
    // click (jumpTo) deliberately moves focus into the editor instead, so
    // leave that alone.
    if (type === 'chapter') refocusRow('chapter', ci, null);
    return;
  }
  if (e.key === 'F2') {
    e.preventDefault();
    const editBtn = row.querySelector('.rail-edit-btn');
    if (editBtn) editBtn.click();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    const deleteBtn = row.querySelector('.rail-delete-btn');
    if (deleteBtn) deleteBtn.click();
    return;
  }
}

// Builds one scene row, fully wired (jump/rename/delete/drag) — shared by a
// real chapter's scene list and Cold Storage's, since reorderScenes/
// deleteScene already work generically on any chapterIndex (Cold Storage's
// included, see model.js/reorder.js). `chapters` is passed through to the
// move/delete calls rather than closed over, so both call sites can hand in
// the exact same array they rendered from.
function buildSceneRow(chapters, ci, si, active) {
  const chapter = chapters[ci];
  const scene = chapter.scenes[si];
  const isActive = !!(active && active.chapterIndex === ci && active.sceneIndex === si);
  const row = el('div', 'rail-scene-row' + (isActive ? ' active' : '') + (scene.isDraft ? ' draft' : ''));
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-label', scene.title);
  if (isActive) row.setAttribute('aria-current', 'true');
  row.tabIndex = 0;
  row.dataset.type = 'scene';
  row.dataset.ci = String(ci);
  row.dataset.si = String(si);

  const nameSpan = el('span', 'rail-scene-name', scene.title);
  const editBtn = btn('rail-edit-btn');
  editBtn.appendChild(icon('ti-pencil'));
  editBtn.title = 'rename scene';
  editBtn.setAttribute('aria-label', 'Rename ' + scene.title);
  editBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    beginEdit(nameSpan, scene.title, (newTitle) => ctx.renameTitle(scene, newTitle), render);
  });
  const deleteBtn = makeDeleteButton('rail-delete-btn', scene.title, () => ctx.deleteScene(ci, si, chapters));
  const nameGroup = el('div', 'rail-scene-name-group');
  nameGroup.append(nameSpan, editBtn, deleteBtn);
  const rowHandle = makeDragHandle(row, scene.title);
  row.append(rowHandle, nameGroup, el('span', 'rail-dim', scene.isDraft ? 'draft' : String(scene.wordCount)));
  // Cold Storage scenes aren't reachable by scrolling the main manuscript
  // at all (see cold-storage-view.js) -- clicking one has to open the
  // isolated scene view instead of the normal jump-and-scroll.
  onActivate(row, () => {
    if (chapter.coldStorage) ctx.enterColdStorageScene(scene, si);
    else jumpTo(scene);
  });

  row.addEventListener('dragstart', (e) => {
    dragSource = { type: 'scene', chapterIndex: ci, sceneIndex: si };
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', scene.id);
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    row.draggable = false;
    dragSource = null;
    clearDropIndicators();
  });
  // Which half of the row the cursor is over decides before-vs-after -- a
  // drop used to always land BEFORE whatever row it was released on, with
  // nothing distinguishing "near its top" from "near its bottom", so it
  // looked like you could drop after a row when you actually couldn't. The
  // line indicator (CSS above) makes the two halves visually distinct and
  // the drop handler below honors it.
  row.addEventListener('dragover', (e) => {
    if (!dragSource || dragSource.type !== 'scene') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    row.classList.toggle('drop-before', before);
    row.classList.toggle('drop-after', !before);
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const droppedBefore = row.classList.contains('drop-before');
    row.classList.remove('drop-before', 'drop-after');
    if (!dragSource || dragSource.type !== 'scene') return;
    const moved = reorderScenes(chapters, {
      fromChapterIndex: dragSource.chapterIndex,
      fromSceneIndex: dragSource.sceneIndex,
      toChapterIndex: ci,
      toSceneIndex: droppedBefore ? si : si + 1,
    });
    dragSource = null;
    if (moved !== null) { ctx.setDoc(moved); ctx.refreshNav(); }
  });

  return row;
}

// Cold Storage (see model.js/reorder.js) is always the LAST entry of
// chapters[] and always present, even with zero scenes -- rendered as its
// own section, never through the real-chapter loop above: no "Ch. N"
// numbering, no chapter-level drag (it's not a reorder target among
// chapters, just a scenes bucket), no rename (its title is fixed).
// Accepts scene drops the same way a chapter header does -- a whole-row
// wash, always appends to the end -- but ignores chapter-type drags
// entirely, unlike a real chapter header.
function buildColdStorageSection(chapters, coldStorageIndex, active) {
  const coldStorage = chapters[coldStorageIndex];
  const isCollapsed = collapsed.has(coldStorageIndex);
  const frag = document.createDocumentFragment();

  const row = el('div', 'rail-chapter-row rail-cold-storage-row');
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-expanded', String(!isCollapsed));
  row.setAttribute('aria-label', 'Cold Storage');
  row.tabIndex = 0;
  row.dataset.type = 'chapter';
  row.dataset.ci = String(coldStorageIndex);

  const chevron = icon(isCollapsed ? 'ti-chevron-right' : 'ti-chevron-down');
  chevron.className += ' rail-chevron';
  if (!isCollapsed) chevron.style.color = 'var(--syntax-2, var(--accent))';
  row.append(
    chevron,
    icon('ti-snowflake'),
    el('span', 'rail-cold-storage-title', 'Cold Storage'),
    el('span', 'rail-dim', String(coldStorage.scenes.length))
  );
  onActivate(row, () => toggleChapter(coldStorageIndex));

  row.addEventListener('dragover', (e) => {
    if (!dragSource || dragSource.type !== 'scene') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drag-over');
    if (!dragSource || dragSource.type !== 'scene') return;
    const moved = reorderScenes(chapters, {
      fromChapterIndex: dragSource.chapterIndex,
      fromSceneIndex: dragSource.sceneIndex,
      toChapterIndex: coldStorageIndex,
      toSceneIndex: coldStorage.scenes.length,
    });
    dragSource = null;
    if (moved !== null) { ctx.setDoc(moved); ctx.refreshNav(); }
  });

  frag.appendChild(row);

  if (!isCollapsed) {
    const sceneList = el('div', 'rail-scene-list');
    sceneList.setAttribute('role', 'group');
    if (coldStorage.scenes.length) {
      coldStorage.scenes.forEach((scene, si) => {
        sceneList.appendChild(buildSceneRow(chapters, coldStorageIndex, si, active));
      });
    } else {
      sceneList.appendChild(el('div', 'rail-cold-storage-hint', 'drag a scene here to park it'));
    }
    frag.appendChild(sceneList);
  }

  return frag;
}

export function render() {
  if (!railEl) return;
  const chapters = getManuscript(ctx.view);
  // Cold Storage is always the last entry (see model.js) — its index also
  // doubles as the count of real chapters before it.
  const coldStorageIndex = chapters.length - 1;
  const realChapterCount = coldStorageIndex;
  const cursorPos = ctx.editor.getCursorPos(ctx.view);
  const active = findActiveScene(chapters, cursorPos);

  railEl.innerHTML = '';

  const totalScenes = chapters.reduce((sum, c, i) => (i === coldStorageIndex ? sum : sum + c.scenes.length), 0);
  const header = el('div', 'rail-header');
  const headerRight = el('div', 'rail-header-right');
  const corkBtn = btn('rail-corkboard-btn');
  corkBtn.title = 'open corkboard (⌘⇧C)';
  corkBtn.setAttribute('aria-label', 'Open corkboard');
  corkBtn.appendChild(icon('ti-layout-grid'));
  corkBtn.addEventListener('click', () => ctx.openCorkboard());
  headerRight.append(corkBtn, el('span', 'rail-dim', realChapterCount + ' ch · ' + totalScenes));
  header.append(el('span', 'rail-label', 'manuscript'), headerRight);
  railEl.appendChild(header);

  const list = el('div', 'rail-list');
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Manuscript');
  chapters.forEach((chapter, ci) => {
    if (chapter.coldStorage) return; // rendered separately below
    const isCollapsed = collapsed.has(ci);
    const chHasTitle = chapter.title.trim() !== '';
    const chLabel = chHasTitle ? chapter.title : chapter.displayTitle;

    const chRow = el('div', 'rail-chapter-row');
    chRow.setAttribute('role', 'treeitem');
    chRow.setAttribute('aria-expanded', String(!isCollapsed));
    chRow.setAttribute('aria-label', chLabel);
    chRow.tabIndex = 0;
    chRow.dataset.type = 'chapter';
    chRow.dataset.ci = String(ci);

    const chevron = icon(isCollapsed ? 'ti-chevron-right' : 'ti-chevron-down');
    chevron.className += ' rail-chevron';
    if (!isCollapsed) chevron.style.color = 'var(--syntax-2, var(--accent))';
    const chTitle = el('span', 'rail-chapter-title' + (chHasTitle ? '' : ' placeholder'), chapter.displayTitle);
    const chEditBtn = btn('rail-edit-btn');
    chEditBtn.appendChild(icon('ti-pencil'));
    chEditBtn.title = 'rename chapter';
    chEditBtn.setAttribute('aria-label', 'Rename ' + chLabel);
    chEditBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    chEditBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      beginEdit(chTitle, chapter.title, (newTitle) => ctx.renameTitle(chapter, newTitle), render);
    });
    const chDeleteBtn = makeDeleteButton('rail-delete-btn', chLabel, () => ctx.deleteChapter(ci, chapters));
    const chHandle = makeDragHandle(chRow, chLabel);
    chRow.append(chHandle, chevron, el('span', 'rail-chapter-num', 'Ch. ' + chapter.number), chTitle, chEditBtn, chDeleteBtn, el('span', 'rail-dim', String(chapter.scenes.length)));
    onActivate(chRow, () => toggleChapter(ci));

    chRow.addEventListener('dragstart', (e) => {
      dragSource = { type: 'chapter', chapterIndex: ci };
      chRow.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'chapter:' + ci);
    });
    chRow.addEventListener('dragend', () => {
      chRow.classList.remove('dragging');
      chRow.draggable = false;
      dragSource = null;
      clearDropIndicators();
    });
    // Accepts either drag type: a chapter drop here reorders chapters
    // (before/after this header, split by which half of it the cursor is
    // over -- a thin line marks which); a scene drop here moves that scene
    // into this chapter, appended at the end -- the chapter header is a
    // much easier target to hit than a specific scene row, and it's the
    // only drop target an empty chapter has, so "always append" (no
    // before/after choice) plus a whole-row wash stays the right feedback
    // for that case specifically.
    chRow.addEventListener('dragover', (e) => {
      if (!dragSource) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragSource.type === 'chapter') {
        const rect = chRow.getBoundingClientRect();
        const before = e.clientY - rect.top < rect.height / 2;
        chRow.classList.toggle('drop-before', before);
        chRow.classList.toggle('drop-after', !before);
        chRow.classList.remove('drag-over');
      } else {
        chRow.classList.add('drag-over');
        chRow.classList.remove('drop-before', 'drop-after');
      }
    });
    chRow.addEventListener('dragleave', () => chRow.classList.remove('drag-over', 'drop-before', 'drop-after'));
    chRow.addEventListener('drop', (e) => {
      e.preventDefault();
      const droppedBefore = chRow.classList.contains('drop-before');
      chRow.classList.remove('drag-over', 'drop-before', 'drop-after');
      if (!dragSource) return;
      const moved = dragSource.type === 'chapter'
        ? reorderChapters(chapters, { fromIndex: dragSource.chapterIndex, toIndex: droppedBefore ? ci : ci + 1 })
        : reorderScenes(chapters, {
            fromChapterIndex: dragSource.chapterIndex,
            fromSceneIndex: dragSource.sceneIndex,
            toChapterIndex: ci,
            toSceneIndex: chapters[ci].scenes.length,
          });
      dragSource = null;
      if (moved !== null) { ctx.setDoc(moved); ctx.refreshNav(); }
    });

    list.appendChild(chRow);

    if (!isCollapsed) {
      const sceneList = el('div', 'rail-scene-list');
      sceneList.setAttribute('role', 'group');
      chapter.scenes.forEach((scene, si) => {
        sceneList.appendChild(buildSceneRow(chapters, ci, si, active));
      });

      const addRow = btn('rail-scene-add');
      addRow.append(icon('ti-plus'), document.createTextNode(' add scene'));
      addRow.title = 'add a scene to ' + chLabel;
      addRow.setAttribute('aria-label', 'Add a scene to ' + chLabel);
      addRow.addEventListener('click', () => ctx.addNewScene(ci, chapters));
      sceneList.appendChild(addRow);

      list.appendChild(sceneList);
    }
  });
  list.appendChild(buildColdStorageSection(chapters, coldStorageIndex, active));
  railEl.appendChild(list);

  const footer = btn('rail-footer');
  footer.append(icon('ti-plus'), document.createTextNode(' new scene'));
  footer.addEventListener('click', () => {
    ctx.addNewScene(realChapterCount ? realChapterCount - 1 : 0, chapters);
  });
  railEl.appendChild(footer);
}

export function mount(localCtx) {
  ctx = localCtx;
  injectStyle();
  railEl = document.getElementById('scene-rail');
  railEl.style.display = 'flex';
  collapsed = new Set();
  railEl.addEventListener('keydown', onTreeKeydown);
  // --editor-measure is a max-width in ch, not a fixed width — it already
  // shrinks to fit whatever room the rail leaves on narrower windows, so no
  // separate rail-open value is needed here anymore.
  render();
}

export function unmount() {
  if (railEl) {
    railEl.style.display = 'none';
    railEl.innerHTML = '';
    railEl.removeEventListener('keydown', onTreeKeydown);
  }
  railEl = null;
  ctx = null;
}
