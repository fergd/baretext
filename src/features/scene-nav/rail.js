import { getManuscript, findActiveScene } from './model.js';
import { reorderScenes, reorderChapters } from './reorder.js';
import { el, btn, icon, injectStyle as injectStyleTag } from '../../dom.js';
import { makeDeleteButton, beginEdit } from './ui-helpers.js';

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
.rail-header {
  display: flex; align-items: center; justify-content: space-between;
  box-sizing: border-box; flex: 0 0 var(--row-min-h);
  min-height: var(--row-min-h); margin: var(--space-4) var(--space-2) var(--space-1);
  padding: var(--space-1); border-radius: var(--radius-row);
}
.rail-header-left { display: flex; flex: 1; min-width: 0; align-items: center; gap: var(--space-2); }
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
   The chapter drag handle swaps into the chevron's exact grid cell on row
   hover/focus; it never consumes a third leading column or collides with
   the disclosure glyph. Cold Storage uses the same geometry, with its
   blue snowflake occupying the node column. */
.rail-chapter-row, .rail-cold-storage-row {
  display: grid; grid-template-columns: var(--rail-node) var(--rail-node) minmax(0, 1fr) 48px; gap: var(--space-2);
}
.rail-chapter-row .rail-drag-handle {
  grid-column: 2; grid-row: 1; border-radius: var(--radius-control);
}
.rail-chapter-row .rail-drag-handle:hover { background: var(--icon-btn-hover); color: var(--accent); }
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
.rail-chapter-row:hover > .rail-chapter-num,
.rail-chapter-row:focus-within > .rail-chapter-num { opacity: 0; }
.rail-chapter-title { font: var(--type-title); color: var(--text-title); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-chapter-title.placeholder { color: var(--text-faint); font-weight: 500; font-style: italic; }

/* Trailing slot: word/scene count at rest, cross-fades into rename/delete
   controls on hover OR :focus-within (so tabbing into a row reveals them
   too, not just mouse hover -- rename/delete/drag are core actions, must
   stay reachable without a mouse). */
.rail-trailing { position: relative; height: var(--space-6); display: flex; align-items: center; justify-content: flex-end; }
.rail-trailing-meta {
  position: absolute; right: 0; transition: var(--motion-swap);
}
.rail-trailing-controls {
  display: flex; gap: var(--space-3);
  opacity: 0; transform: translateX(6px); pointer-events: none;
  transition: var(--motion-swap);
}
.rail-chapter-row:hover .rail-trailing-meta, .rail-scene-row:hover .rail-trailing-meta,
.rail-chapter-row:focus-within .rail-trailing-meta, .rail-scene-row:focus-within .rail-trailing-meta {
  opacity: 0; transform: translateX(6px); pointer-events: none;
}
.rail-chapter-row:hover .rail-trailing-controls, .rail-scene-row:hover .rail-trailing-controls,
.rail-chapter-row:focus-within .rail-trailing-controls, .rail-scene-row:focus-within .rail-trailing-controls {
  opacity: 1; transform: translateX(0); pointer-events: auto;
}
/* An armed (two-click confirm) delete button stays visible/interactive
   regardless of hover state -- disarming happens on a timeout or a second
   click, not on mouseleave. */
.rail-trailing-controls:has(.rail-delete-btn.confirm) { opacity: 1 !important; transform: translateX(0) !important; pointer-events: auto !important; }

.rail-scene-list { display: flex; flex-direction: column; gap: var(--space-1); }

.rail-scene-row {
  display: grid; grid-template-columns: var(--space-4) minmax(0, 1fr) 48px; gap: var(--space-1);
  margin-left: var(--scene-inset);
}
.rail-scene-row .rail-drag-handle { grid-column: 1; }
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

/* Grab handle -- fixed 20x20 hit target of its own (the drag listeners live
   on the ROW, gated by this handle's mousedown; see makeDragHandle below),
   sits in its own grid column so it never has to share space with, or
   overflow into, the chevron next to it (see the .rail-chapter-row comment
   above -- this is the specific fix for that). Reveal-on-hover, same
   hover/focus-within rule as the trailing controls. */
.rail-drag-handle {
  all: unset; box-sizing: border-box; position: relative; cursor: grab;
  width: 100%; height: var(--space-6); display: flex; align-items: center; justify-content: center;
  color: var(--text-faint); opacity: 0;
  transition: opacity var(--dur-1) var(--ease-standard), color var(--dur-1) var(--ease-standard);
}
/* nets >=24px hit target (checked by the hit-target test) on both the
   16px chapter handle and the 20px scene handle. */
.rail-drag-handle::before { content: ''; position: absolute; inset: calc(-1 * var(--space-1)) calc(-1 * (var(--space-1) + var(--space-2xs))); }
.rail-drag-handle .ti { font-size: var(--space-4); }
.rail-chapter-row:hover .rail-drag-handle, .rail-scene-row:hover .rail-drag-handle,
.rail-chapter-row:focus-within .rail-drag-handle, .rail-scene-row:focus-within .rail-drag-handle,
.rail-drag-handle:focus, .rail-drag-handle:focus-visible { opacity: 1; }
.rail-drag-handle:hover { color: var(--accent); }
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
  ctx.editor.setCursorPos(ctx.view, scene.contentPos);
  ctx.editor.scrollToTop(ctx.view, scene.pos);
  ctx.focusEditor();
  ctx.refreshNav();
}

function jumpToChapter(chapter) {
  ctx.exitColdStorageScene();
  ctx.editor.setCursorPos(ctx.view, chapter.pos);
  ctx.editor.scrollToTop(ctx.view, chapter.pos);
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
    // Real chapters and scenes move focus into the editor. Cold Storage
    // still toggles its local disclosure state, which rebuilds the rail.
    if (row.dataset.coldStorage === 'true') refocusRow('chapter', ci, null);
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
  const rowHandle = makeDragHandle(row, scene.title);
  const metaSpan = el('span', 'rail-trailing-meta rail-dim', scene.isDraft ? 'draft' : String(scene.wordCount));
  const controls = el('span', 'rail-trailing-controls');
  controls.append(editBtn, deleteBtn);
  const trailing = el('span', 'rail-trailing');
  trailing.append(metaSpan, controls);
  row.append(rowHandle, nameSpan, trailing);
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
  const headerLeft = el('div', 'rail-header-left');
  const corkBtn = btn('rail-icon-btn rail-corkboard-btn');
  corkBtn.title = 'open corkboard (⌘⇧C)';
  corkBtn.setAttribute('aria-label', 'Open corkboard');
  corkBtn.appendChild(railAssetIcon('cards'));
  corkBtn.addEventListener('click', () => ctx.openCorkboard());
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
  headerLeft.append(corkBtn, titleEl);
  header.append(headerLeft, el('span', 'rail-dim', realChapterCount + 'ch/' + totalScenes));
  railEl.appendChild(header);

  const list = el('div', 'rail-list');
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Manuscript');
  chapters.forEach((chapter, ci) => {
    if (chapter.coldStorage) return; // rendered separately below
    const isCollapsed = collapsed.has(ci);
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
    const chHandle = makeDragHandle(chRow, chLabel);
    const chMetaSpan = el('span', 'rail-trailing-meta rail-dim', chapterMeta(chapter));
    const chControls = el('span', 'rail-trailing-controls');
    chControls.append(chEditBtn, chDeleteBtn);
    const chTrailing = el('span', 'rail-trailing');
    chTrailing.append(chMetaSpan, chControls);
    chRow.append(chevron, chHandle, el('span', 'rail-chapter-num', String(chapter.number)), chTitle, chTrailing);
    onActivate(chRow, () => jumpToChapter(chapter));

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
  // Pushes Cold Storage down to the bottom of whatever room .rail-list has
  // (the panel is always full height now) instead of it sitting directly
  // under the last chapter with empty rail below it. Collapses to zero
  // height on its own when the chapter list already fills or overflows
  // the panel, so Cold Storage's own margin-top (not this spacer) is what
  // keeps a minimum gap above it in that case -- scrolling is never cut
  // short by this.
  list.appendChild(el('div', 'rail-spacer'));
  list.appendChild(buildColdStorageSection(chapters, coldStorageIndex, active));
  railEl.appendChild(list);

  const footer = btn('rail-footer');
  footer.append(icon('ti-plus'), document.createTextNode(' New Chapter'));
  footer.title = 'add a new chapter';
  footer.setAttribute('aria-label', 'Add a new chapter');
  footer.addEventListener('click', () => ctx.addNewChapter(chapters));
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
