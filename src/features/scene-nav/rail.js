import { mountShell, renderShell, unmountShell, updateShellSelection } from './writing-shell.js';
import { getManuscript, findActiveScene } from './model.js';
import { reorderScenes, reorderChapters } from './reorder.js';
import { sceneGroup } from './links.js';
import { el, btn, icon, injectStyle as injectStyleTag } from '../../dom.js';
import { makeCopyButton, makeDeleteButton, beginEdit, markSceneGroup } from './ui-helpers.js';

let ctx = null;
let railEl = null;
let collapsed = new Set(); // chapter indices

function railAssetIcon(name) {
  const span = el('span', 'rail-svg-icon rail-svg-' + name);
  span.setAttribute('aria-hidden', 'true');
  return span;
}

// "scenes/words" -- e.g. "5/2997" -- a chapter's own trailing meta. Total
// word count across every scene in the chapter, not the chapter's own doc
// length, so it matches what the writer actually cares about (prose
// written), same word-count source scene rows already use individually.
function chapterMeta(chapter) {
  const words = chapter.scenes.reduce((sum, s) => sum + s.wordCount, 0);
  return chapter.scenes.length + '/' + words;
}

// The manuscript belongs to the writer, so its header uses their document
// name rather than an app-owned section label. Files created by Baretext have
// date-based working names; those remain visually "Untitled" until the user
// gives the file a meaningful name.
function novelTitle(filePath) {
  if (!filePath) return { text: 'Untitled', placeholder: true };
  const fileName = filePath.split(/[\\/]/).pop() || '';
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  const generatedName = /^\d{4}-\d{2}-\d{2}(?:-\d+)?$/.test(stem);
  return stem && !generatedName
    ? { text: stem, placeholder: false }
    : { text: 'Untitled', placeholder: true };
}
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
.rail-svg-icon {
  display: block; width: var(--space-4); height: var(--space-4); flex: none;
  background: currentColor; mask: center / contain no-repeat; -webkit-mask: center / contain no-repeat;
}
.rail-svg-cards { mask-image: url('icons/rail-cards.svg'); -webkit-mask-image: url('icons/rail-cards.svg'); }
.rail-svg-chevron-open { mask-image: url('icons/rail-chevron-open.svg'); -webkit-mask-image: url('icons/rail-chevron-open.svg'); }
.rail-svg-chevron-closed { mask-image: url('icons/rail-chevron-closed.svg'); -webkit-mask-image: url('icons/rail-chevron-closed.svg'); }
.rail-svg-panel-collapse { mask-image: url('icons/rail-panel-collapse.svg'); -webkit-mask-image: url('icons/rail-panel-collapse.svg'); }
.rail-svg-panel-expand { mask-image: url('icons/rail-panel-expand.svg'); -webkit-mask-image: url('icons/rail-panel-expand.svg'); }
.rail-header {
  display: flex; align-items: center; justify-content: space-between;
  box-sizing: border-box; flex: 0 0 var(--row-min-h);
  min-height: var(--row-min-h); margin: var(--space-4) var(--space-2) var(--space-1);
  padding: var(--space-1); border-radius: var(--radius-row);
}
.rail-header-left { display: flex; flex: 1; min-width: 0; align-items: center; gap: var(--space-2); }
.rail-header-right { display: flex; flex: none; align-items: center; gap: var(--space-2); }
.rail-label {
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
  font: var(--type-overline); letter-spacing: 0;
  white-space: nowrap;
  color: var(--accent); opacity: .85; cursor: text;
}
.rail-label.rail-label-placeholder { font-style: italic; }
.rail-dim { font: var(--type-meta); color: var(--text-faint); font-variant-numeric: tabular-nums; }
/* overflow-x: hidden, not just overflow:auto -- rows are tightly packed
   grid layouts now, and hit-target ::before pseudo-elements (negative
   inset, meant to expand click area without affecting visible layout) can
   push a row's scrollWidth a few px past its clientWidth. This rail was
   never meant to scroll horizontally at all, only vertically -- clip that
   axis outright rather than chasing exact pixel-perfect pseudo-element
   insets against every possible title length. */
/* A flex column (not just a stack of block children) specifically so Cold
   Storage -- always the last child -- can be pushed to the bottom of
   whatever room is available via margin-top:auto (see
   .rail-cold-storage-section below), instead of sitting directly under the
   last chapter with a stretch of empty rail below it now that the panel is
   always full height. When there's no slack (a long manuscript overflows
   the panel), margin-top:auto collapses to 0 and everything scrolls
   normally -- this only ever pins Cold Storage down, never cuts scrolling
   short. */
/* Left side trimmed tighter than the right (--space-1 vs --space-2) so a
   row's hover highlight reads closer to the panel's own rounded edge --
   the right side keeps its full inset since trailing icon buttons still
   need real breathing room from the panel's other edge. */
.rail-list { flex: 1; display: flex; flex-direction: column; gap: var(--space-1); overflow-x: hidden; overflow-y: auto; padding: 0 var(--space-2); }

/* Shared round icon-button visual (corkboard/rename/delete) — one circular
   hover state-layer instead of each control having its own bespoke hover
   treatment. Layered ON TOP of each control's own existing class (kept
   verbatim: .rail-edit-btn/.rail-delete-btn/.rail-corkboard-btn are real
   selector/test contracts elsewhere), not a replacement for it. */
.rail-icon-btn {
  all: unset; box-sizing: border-box; position: relative; flex-shrink: 0; cursor: pointer;
  width: var(--space-4); height: var(--space-4); border-radius: var(--radius-control);
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-muted);
  transition: var(--motion-hover), color var(--dur-1) var(--ease-standard);
}
.rail-icon-btn::before { content: ''; position: absolute; inset: -6px; } /* 28px hit target around a 16px glyph */
.rail-icon-btn .ti { font-size: var(--space-4); }
.rail-icon-btn:hover, .rail-icon-btn:focus-visible { background: var(--icon-btn-hover); color: var(--text-strong); }
.rail-corkboard-btn.rail-icon-btn { width: var(--space-4); height: var(--space-4); }
.rail-corkboard-btn .ti { font-size: var(--space-4); }
.rail-delete-btn.confirm {
  width: auto; padding: 0 var(--space-2); gap: 4px;
  color: #e05c5c; font-weight: 600;
  background: color-mix(in srgb, #e05c5c 15%, transparent);
}

.rail-chapter-row, .rail-scene-row {
  box-sizing: border-box; position: relative; cursor: pointer;
  height: var(--row-min-h);
  min-height: var(--row-min-h); padding: var(--row-pad-y) var(--row-pad-end) var(--row-pad-y) var(--row-pad-x);
  border-radius: var(--radius-row);
  align-items: center;
  transition: var(--motion-hover);
}
.rail-chapter-row:hover, .rail-scene-row:hover { background: var(--icon-btn-hover); }
/* One disclosure/action column, one 20px chapter-number column, then title.
   Cold Storage uses the same geometry, with its blue snowflake occupying
   the node column. */
.rail-chapter-row, .rail-cold-storage-row {
  display: grid; grid-template-columns: var(--rail-node) var(--rail-node) minmax(0, 1fr) 48px; gap: var(--space-2);
}
.rail-chevron-btn {
  all: unset; box-sizing: border-box; position: relative; grid-column: 1; grid-row: 1;
  width: var(--rail-node); height: var(--rail-node); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-muted); border-radius: var(--radius-control);
}
.rail-chevron-btn::before { content: ''; position: absolute; inset: -6px; }
.rail-chevron-btn:hover, .rail-chevron-btn:focus-visible { background: var(--icon-btn-hover); color: var(--text-strong); }
.rail-chapter-num {
  grid-column: 2; grid-row: 1;
  width: var(--rail-node); height: var(--rail-node); border-radius: var(--space-3);
  display: inline-flex; align-items: center; justify-content: center;
  font: 400 12px/normal var(--font-mono); color: var(--text-muted); background: var(--surface-raised);
  font-variant-numeric: tabular-nums;
}
.rail-chapter-row > .rail-chapter-title { grid-column: 3; }
.rail-chapter-row > .rail-trailing { grid-column: 4; }
.rail-chapter-title { font: var(--type-title); color: var(--text-title); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-chapter-title.placeholder { color: var(--text-faint); font-weight: 500; font-style: italic; }

/* The trailing slot mounts either metadata or actions; hover and keyboard
   focus share the same state-driven swap. */
.rail-trailing { height: var(--space-6); display: flex; align-items: center; justify-content: flex-end; }
.rail-trailing-controls { display: flex; gap: var(--space-3); }

.rail-scene-list { display: flex; flex-direction: column; gap: var(--space-1); }

.rail-scene-row {
  display: grid; grid-template-columns: var(--rail-node) minmax(0, 1fr) 48px; gap: var(--space-2);
  margin-left: var(--scene-inset);
}
.rail-scene-num {
  grid-column: 1; grid-row: 1;
  width: var(--rail-node); height: var(--rail-node);
  display: inline-flex; align-items: center; justify-content: center;
  font: 400 11px/normal var(--font-mono); font-variant-numeric: tabular-nums;
  /* Idle: a translucent tint of the scene color, not flat --text-dimmer;
     full strength once this is the active/current scene -- same rule as
     the manuscript's own gutter numerals (typography-rhythm.md #3), so a
     scene's numeral reads identically in the rail and on the page. */
  color: color-mix(in srgb, var(--scene) 55%, transparent);
}
.rail-scene-row.active .rail-scene-num { color: var(--scene); }
.rail-scene-row .rail-scene-name { grid-column: 2; }
.rail-scene-row .rail-trailing { grid-column: 3; }
.rail-scene-row.active { background: var(--selected-surface); }
.rail-scene-row .rail-scene-name { font: var(--type-body); color: var(--text-title); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-scene-row.active .rail-scene-name { color: var(--selected-text); }
.rail-scene-row.draft .rail-scene-name { font-style: italic; }
.rail-scene-row.draft .rail-trailing-meta { color: var(--accent); font-style: italic; }
.rail-scene-row.active .rail-trailing-meta { color: var(--accent); }

.inline-rename-input {
  flex: 1; min-width: 0; background: color-mix(in srgb, var(--bg) 55%, transparent);
  border: 1px solid var(--accent); border-radius: var(--radius-xs); padding: 2px 6px;
  color: var(--text); font: var(--type-body); outline: none;
}
.rail-footer {
  all: unset; box-sizing: border-box; cursor: pointer;
  display: flex; align-items: center; gap: var(--space-1);
  height: var(--row-min-h); margin: var(--space-1) var(--space-2) var(--space-4);
  padding: var(--row-pad-y) var(--row-pad-end) var(--row-pad-y) var(--row-pad-x); border-radius: var(--radius-row);
  color: var(--text-muted); font: var(--type-meta);
}
.rail-footer:hover { color: var(--text-strong); }
.rail-scene-add {
  all: unset; box-sizing: border-box; cursor: pointer;
  height: var(--row-min-h); margin-left: var(--scene-inset);
  padding: var(--row-pad-y) var(--row-pad-end) var(--row-pad-y) var(--row-pad-x); border-radius: var(--radius-row);
  display: inline-flex; align-items: center; gap: var(--space-1);
  font: var(--type-body); color: var(--text-faint); opacity: .8;
  transition: var(--motion-hover), opacity var(--dur-1) var(--ease-standard), color var(--dur-1) var(--ease-standard);
}
.rail-scene-add:hover, .rail-scene-add:focus-visible { opacity: 1; color: var(--accent); background: var(--icon-btn-hover); }
.rail-scene-add .ti-plus { width: var(--space-4); font-size: var(--space-4); text-align: center; }

.rail-chapter-row.dragging, .rail-scene-row.dragging { opacity: .35; }
/* Dropping a scene directly ON a chapter header always appends it to that
   chapter (no "before/after" to choose among scenes) -- the whole-row wash
   reads as "goes in here". Reordering rows (scene-on-scene, chapter-on-
   chapter) instead gets a thin line at the exact edge the drop will land
   on, split via dragover's own cursor-Y-vs-row-midpoint check below --
   previously a drop always landed BEFORE whatever row it was released on
   with no visual telling you that, so "drop near the bottom of a row" and
   "drop near its top" looked identical but did different things. */
.rail-chapter-row.drag-over { background: var(--icon-btn-hover); box-shadow: inset 0 0 0 1px var(--accent); }
.rail-chapter-row.drop-before::before, .rail-scene-row.drop-before::before,
.rail-chapter-row.drop-after::after, .rail-scene-row.drop-after::after {
  content: ''; position: absolute; left: var(--space-1); right: var(--space-1); height: 2px;
  background: var(--accent); border-radius: 1px; pointer-events: none;
}
.rail-chapter-row.drop-before::before, .rail-scene-row.drop-before::before { top: -2px; }
.rail-chapter-row.drop-after::after, .rail-scene-row.drop-after::after { bottom: -2px; }

.rail-spacer { flex: 1 0 0; }

/* Cold Storage — its own raised, rounded cluster inside the rail panel, so
   it visibly reads as a distinct "parked" region rather than just another
   chapter. --surface-raised (see index.html) is deliberately NOT the same
   token as the rail panel's own --surface-panel background -- an earlier
   pass at this redesign aliased both to the same color and the card had
   zero contrast against its own container. */
.rail-cold-storage-section {
  background: var(--surface-raised); border-radius: var(--radius-lg);
  display: flex; flex-direction: column; gap: var(--space-1);
  padding: var(--space-1) 0; margin-top: var(--space-1);
}
.rail-cold-storage-row .ti-snowflake { font-size: var(--space-4); color: var(--cold-storage-accent); display: flex; justify-content: center; }
.rail-cold-storage-title {
  font: var(--type-title); font-style: italic; color: var(--text-title);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rail-cold-storage-hint {
  margin-left: var(--scene-inset); padding: var(--space-1) 6px;
  font: var(--type-meta); font-style: italic; color: var(--text-faint);
}
`);
}

// mousedown still gets preventDefault() (preserves "don't steal focus from
// the editor on a mouse click" for the tree rows themselves, same trick as
// btn()); the actual action binds to click, which still fires normally.
function onActivate(element, handler) {
  element.addEventListener('mousedown', (e) => e.preventDefault());
  element.addEventListener('click', handler);
}

// Keep detached controls alive so listeners and delete confirmation survive
// the swap. Armed delete buttons stay mounted until confirmed or disarmed.
function wireTrailingHover(row, metaSpan, controls) {
  const slot = metaSpan.parentNode;
  let hovered = false;
  let focused = false;
  function apply() {
    const show = hovered || focused || !!controls.querySelector('.rail-delete-btn.confirm');
    const child = show ? controls : metaSpan;
    if (slot.firstChild !== child || slot.childNodes.length !== 1) slot.replaceChildren(child);
  }
  row.addEventListener('mouseenter', () => { hovered = true; apply(); });
  row.addEventListener('mouseleave', () => { hovered = false; apply(); });
  row.addEventListener('focusin', () => { focused = true; apply(); });
  row.addEventListener('focusout', (e) => {
    if (row.contains(e.relatedTarget)) return;
    focused = false; apply();
  });
  row.showActions = () => { focused = true; apply(); };
  row.addEventListener('btconfirmchange', apply);
  apply();
}

// Chapter/scene rows are draggable directly -- no separate grip-icon handle
// -- same whole-row-draggable approach the corkboard already uses for its
// cards. `row.draggable` is set once and stays true; a plain press+release
// still fires a normal click (jump/toggle), and a press+move starts a
// native drag instead, because that's how the browser's own drag-vs-click
// arbitration already works for a draggable element: dragstart only fires
// once the pointer has actually moved past its internal threshold while the
// button is down, and it suppresses the click that would otherwise follow
// mouseup once a drag has started. So no manual distance/time tracking is
// needed here to tell the two gestures apart.
//
// Deliberately does NOT preventDefault() on mousedown the way onActivate()
// does -- Chromium never starts a drag from a mousedown whose default
// action was prevented (confirmed live: with preventDefault() in place, zero
// drag events fired on a real mouse-driven press+move+release, even with
// draggable already true). Losing that "don't steal focus from the editor"
// guard is fine here specifically because jumpTo/jumpToChapter already
// explicitly call ctx.focusEditor() at the end of the click handler, so
// focus lands back in the editor regardless.
function onActivateDraggable(element, handler) {
  element.addEventListener('click', handler);
}

function jumpTo(scene) { ctx.navigateTo(scene); }
function jumpToChapter(chapter) { ctx.navigateTo(chapter); }

function toggleChapter(ci) {
  const key = getManuscript(ctx.view)[ci]?.stableId ?? ci;
  if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
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
  if (!chapter) return;
  const group = sceneGroup(chapter.scenes, si);
  const neighborIndex = dir < 0 ? group.start - 1 : group.end;
  if (neighborIndex < 0 || neighborIndex >= chapter.scenes.length) return;
  const neighbor = sceneGroup(chapter.scenes, neighborIndex);
  const toSceneIndex = dir < 0 ? neighbor.start : neighbor.end;
  const targetSi = si + dir * (neighbor.end - neighbor.start);
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
  // (edit/delete) -- those are real buttons with their own native
  // Enter/Space activation; re-interpreting the same keydown here too (it
  // still bubbles) would double-fire both actions.
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
    const isCollapsed = collapsed.has(getManuscript(ctx.view)[ci]?.stableId ?? ci);
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
    // Real chapters and scenes move focus into the editor. Cold Storage
    // still toggles its local disclosure state, which rebuilds the rail.
    if (row.dataset.coldStorage === 'true') refocusRow('chapter', ci, null);
    return;
  }
  if (e.key === 'F2') {
    row.showActions?.();
    e.preventDefault();
    const editBtn = row.querySelector('.rail-edit-btn');
    if (editBtn) editBtn.click();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    row.showActions?.();
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
  const editBtn = btn('rail-icon-btn rail-edit-btn');
  editBtn.appendChild(icon('ti-pencil'));
  editBtn.title = 'rename scene';
  editBtn.setAttribute('aria-label', 'Rename ' + scene.title);
  editBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    beginEdit(nameSpan, scene.title, (newTitle) => ctx.renameTitle(scene, newTitle), render);
  });
  const deleteBtn = makeDeleteButton('rail-icon-btn rail-delete-btn', scene.title, () => ctx.deleteScene(ci, si, chapters));
  const metaSpan = el('span', 'rail-trailing-meta rail-dim', String(scene.wordCount));
  const controls = el('span', 'rail-trailing-controls');
  const archive = btn('rail-icon-btn rail-archive-btn');
  archive.append(icon(chapter.coldStorage ? 'ti-corner-up-left' : 'ti-archive'));
  archive.title = chapter.coldStorage ? 'restore to manuscript' : 'send to cold storage';
  archive.setAttribute('aria-label', archive.title);
  archive.addEventListener('mousedown', e => e.stopPropagation());
  archive.addEventListener('click', e => {
    e.stopPropagation();
    const target = chapter.coldStorage ? 0 : chapters.length - 1;
    const moved = reorderScenes(chapters, { fromChapterIndex: ci, fromSceneIndex: si, toChapterIndex: target, toSceneIndex: chapters[target].scenes.length });
    if (moved !== null) { ctx.setDoc(moved); ctx.refreshNav(); }
  });
  controls.append(makeCopyButton('rail-icon-btn', 'scene', ctx, ci, si), archive, editBtn, deleteBtn);
  const trailing = el('span', 'rail-trailing');
  trailing.append(metaSpan, controls);
  // Index within this scene's own bucket (a real chapter or Cold Storage) --
  // same left-numeral treatment everywhere a scene row renders, so Cold
  // Storage reads as the same row type, not a different one (writing-rail-
  // refinements.md #4).
  const numSpan = el('span', 'rail-scene-num', String(si + 1).padStart(2, '0'));
  row.append(numSpan, nameSpan, trailing);
  wireTrailingHover(row, metaSpan, controls);
  row.title = 'drag to reorder, or focus the row and use ⌥↑/⌥↓';
  markSceneGroup(row, chapter.scenes, si);
  // Cold Storage scenes aren't reachable by scrolling the main manuscript
  // at all (see cold-storage-view.js) -- clicking one has to open the
  // isolated scene view instead of the normal jump-and-scroll.
  onActivateDraggable(row, () => {
    if (chapter.coldStorage) ctx.enterColdStorageScene(scene, si);
    else jumpTo(scene);
  });

  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    dragSource = { type: 'scene', chapterIndex: ci, sceneIndex: si };
    const members = scene.groupId ? railEl.querySelectorAll(`.rail-scene-row[data-group-id="${scene.groupId}"]`) : railEl.querySelectorAll(`.rail-scene-row[data-ci="${ci}"][data-group-start="${row.dataset.groupStart}"]`);
    members.forEach(r => r.classList.add('dragging'));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', scene.id);
  });
  row.addEventListener('dragend', () => {
    railEl.querySelectorAll('.dragging').forEach(r => r.classList.remove('dragging'));
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
    clearDropIndicators();
    const group = sceneGroup(chapter.scenes, si);
    const edge = railEl.querySelector(rowSelector('scene', ci, before ? group.start : group.end - 1));
    edge?.classList.add(before ? 'drop-before' : 'drop-after');
  });
  row.addEventListener('dragleave', clearDropIndicators);
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const droppedBefore = e.clientY - rect.top < rect.height / 2;
    clearDropIndicators();
    if (!dragSource || dragSource.type !== 'scene') return;
    const moved = reorderScenes(chapters, {
      fromChapterIndex: dragSource.chapterIndex,
      fromSceneIndex: dragSource.sceneIndex,
      toChapterIndex: ci,
      toSceneIndex: droppedBefore ? sceneGroup(chapter.scenes, si).start : sceneGroup(chapter.scenes, si).end,
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
  const section = el('div', 'rail-cold-storage-section');

  const row = el('div', 'rail-chapter-row rail-cold-storage-row');
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-expanded', String(!isCollapsed));
  row.setAttribute('aria-label', 'Cold Storage');
  row.tabIndex = 0;
  row.dataset.type = 'chapter';
  row.dataset.ci = String(coldStorageIndex);
  row.dataset.coldStorage = 'true';

  const chevron = btn('rail-chevron-btn');
  chevron.appendChild(railAssetIcon(isCollapsed ? 'chevron-closed' : 'chevron-open'));
  chevron.title = isCollapsed ? 'expand Cold Storage' : 'collapse Cold Storage';
  chevron.setAttribute('aria-label', chevron.title);
  chevron.setAttribute('aria-expanded', String(!isCollapsed));
  chevron.addEventListener('mousedown', (event) => event.stopPropagation());
  chevron.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleChapter(coldStorageIndex);
  });
  row.append(
    chevron,
    icon('ti-snowflake'),
    el('span', 'rail-cold-storage-title', 'Cold Storage'),
    el('span', 'rail-dim', chapterMeta(coldStorage))
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

  section.appendChild(row);

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
    section.appendChild(sceneList);
  }

  return section;
}

export function render() {
  if (!railEl) return;
  // Active-scene changes rebuild the rail so its highlight and metadata stay
  // current. Preserve the independent list viewport across that replacement;
  // otherwise clicking any scene below the fold snaps the rail back upward.
  const previousList = railEl.querySelector('.rail-list');
  const previousScrollTop = previousList ? previousList.scrollTop : 0;
  const chapters = getManuscript(ctx.view);
  // Cold Storage is always the last entry (see model.js) — its index also
  // doubles as the count of real chapters before it.
  const coldStorageIndex = chapters.length - 1;
  const cursorPos = ctx.editor.getCursorPos(ctx.view);
  const active = findActiveScene(chapters, cursorPos);

  railEl.innerHTML = '';

  const fallbackTitle = novelTitle(ctx.state.filePath);
  const title = chapters.bookTitle
    ? { text: chapters.bookTitle, placeholder: false }
    : fallbackTitle;
  const titleEl = el('span', 'rail-label' + (title.placeholder ? ' rail-label-placeholder' : ''), title.text);
  titleEl.tabIndex = 0;
  titleEl.setAttribute('role', 'button');
  titleEl.setAttribute('aria-label', 'Edit book title');
  const editBookTitle = () => beginEdit(titleEl, title.text, (newTitle) => {
    ctx.editor.setBookTitle(ctx.view, newTitle);
    render();
  }, render);
  titleEl.addEventListener('click', editBookTitle);
  titleEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      editBookTitle();
    }
  });
  renderShell(chapters, active, titleEl);

  const list = el('div', 'rail-list');
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Manuscript');
  chapters.forEach((chapter, ci) => {
    if (chapter.coldStorage) return; // rendered separately below
    const isCollapsed = collapsed.has(chapter.stableId ?? ci);
    const chHasTitle = chapter.title.trim() !== '';
    const chLabel = chHasTitle ? chapter.title : 'Untitled';

    const chRow = el('div', 'rail-chapter-row');
    chRow.setAttribute('role', 'treeitem');
    chRow.setAttribute('aria-expanded', String(!isCollapsed));
    chRow.setAttribute('aria-label', chLabel);
    chRow.tabIndex = 0;
    chRow.dataset.type = 'chapter';
    chRow.dataset.ci = String(ci);

    const chevron = btn('rail-chevron-btn');
    chevron.appendChild(railAssetIcon(isCollapsed ? 'chevron-closed' : 'chevron-open'));
    chevron.title = isCollapsed ? 'expand ' + chLabel : 'collapse ' + chLabel;
    chevron.setAttribute('aria-label', chevron.title);
    chevron.setAttribute('aria-expanded', String(!isCollapsed));
    chevron.addEventListener('mousedown', (event) => event.stopPropagation());
    chevron.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleChapter(ci);
    });
    const chTitle = el('span', 'rail-chapter-title' + (chHasTitle ? '' : ' placeholder'), chLabel);
    const chEditBtn = btn('rail-icon-btn rail-edit-btn');
    chEditBtn.appendChild(icon('ti-pencil'));
    chEditBtn.title = 'rename chapter';
    chEditBtn.setAttribute('aria-label', 'Rename ' + chLabel);
    chEditBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    chEditBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      beginEdit(chTitle, chapter.title, (newTitle) => ctx.renameTitle(chapter, newTitle), render);
    });
    const chDeleteBtn = makeDeleteButton('rail-icon-btn rail-delete-btn', chLabel, () => ctx.deleteChapter(ci, chapters));
    const chMetaSpan = el('span', 'rail-trailing-meta rail-dim', chapterMeta(chapter));
    const chControls = el('span', 'rail-trailing-controls');
    chControls.append(makeCopyButton('rail-icon-btn', 'chapter', ctx, ci), chEditBtn, chDeleteBtn);
    const chTrailing = el('span', 'rail-trailing');
    chTrailing.append(chMetaSpan, chControls);
    chRow.append(chevron, el('span', 'rail-chapter-num', String(chapter.number).padStart(2, '0')), chTitle, chTrailing);
    wireTrailingHover(chRow, chMetaSpan, chControls);
    chRow.title = 'drag to reorder, or focus the row and use ⌥↑/⌥↓';
    onActivateDraggable(chRow, () => jumpToChapter(chapter));

    chRow.draggable = true;
    chRow.addEventListener('dragstart', (e) => {
      dragSource = { type: 'chapter', chapterIndex: ci };
      chRow.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'chapter:' + ci);
    });
    chRow.addEventListener('dragend', () => {
      chRow.classList.remove('dragging');
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

      sceneList.addEventListener('dragover', e => {
        if (dragSource?.type === 'scene') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
      });
      sceneList.addEventListener('drop', e => {
        if (dragSource?.type !== 'scene') return;
        e.preventDefault();
        const moved = reorderScenes(chapters, { fromChapterIndex: dragSource.chapterIndex, fromSceneIndex: dragSource.sceneIndex, toChapterIndex: ci, toSceneIndex: chapter.scenes.length });
        dragSource = null;
        if (moved !== null) { ctx.setDoc(moved); ctx.refreshNav(); }
      });

      list.appendChild(sceneList);
    }
  });
  // Pushes Cold Storage down to the bottom of whatever room .rail-list has
  // (the panel is always full height now) instead of it sitting directly
  // under the last chapter with empty rail below it. Collapses to zero
  // height on its own when the chapter list already fills or overflows
  // the panel, so Cold Storage's own margin-top (not this spacer) is what
  // keeps a minimum gap above it in that case -- scrolling is never cut
  // short by this.
  railEl.appendChild(list);
  railEl.appendChild(buildColdStorageSection(chapters, coldStorageIndex, active));

  const footer = el('div', 'rail-footer');
  const addChapter = btn('', '+ chapter');
  addChapter.setAttribute('aria-label', 'Add a new chapter');
  addChapter.addEventListener('click', () => ctx.addNewChapter(chapters));
  const addScene = btn('', '+ scene');
  addScene.setAttribute('aria-label', 'Add a new scene');
  addScene.addEventListener('click', () => {
    const currentChapter = chapters.findLastIndex(ch => !ch.coldStorage && ch.pos <= ctx.editor.getCursorPos(ctx.view));
    const ci = Math.max(0, currentChapter);
    ctx.addNewScene(ci, chapters);
  });
  footer.append(addChapter, addScene, el('span', 'rail-footer-hint', '⌘\\ collapses'));
  railEl.appendChild(footer);

  // Restore only after the complete flex layout exists. Setting scrollTop
  // while the footer was still absent temporarily made the list taller,
  // so browsers clamped a near-bottom position to that smaller temporary
  // maximum. Appending the footer afterward shrank the viewport again but
  // left the clamped value in place, visibly jumping Cold Storage upward
  // whenever Enter committed an inline rename.
  list.scrollTop = previousScrollTop;
}

export function mount(localCtx) {
  ctx = localCtx;
  injectStyle();
  railEl = document.getElementById('scene-rail');
  railEl.style.display = 'flex';
  collapsed = new Set();
  mountShell({ ...ctx, jumpToScene: jumpTo, jumpToChapter });
  railEl.addEventListener('keydown', onTreeKeydown);
  // --editor-measure is a max-width in ch, not a fixed width — it already
  // shrinks to fit whatever room the rail leaves on narrower windows, so no
  // separate rail-open value is needed here anymore.
  render();
}

export function unmount() {
  unmountShell();
  if (railEl) {
    railEl.style.display = 'none';
    railEl.innerHTML = '';
    railEl.removeEventListener('keydown', onTreeKeydown);
  }
  railEl = null;
  ctx = null;
}

export function updateSelection() {
  if (!ctx || !railEl) return;
  const chapters = getManuscript(ctx.view);
  const active = findActiveScene(chapters, ctx.editor.getCursorPos(ctx.view));
  for (const row of railEl.querySelectorAll('.rail-scene-row')) {
    const selected = Number(row.dataset.ci) === active?.chapterIndex && Number(row.dataset.si) === active?.sceneIndex;
    row.classList.toggle('active', selected);
    if (selected) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
  }
  updateShellSelection(chapters, active);
}
