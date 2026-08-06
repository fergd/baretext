import { getManuscript, findActiveScene } from './model.js';
import { reorderScenes, reorderChapters } from './reorder.js';

let ctx = null;
let railEl = null;
let collapsed = new Set(); // chapter indices
// { type: 'chapter', chapterIndex } or { type: 'scene', chapterIndex, sceneIndex }
// while a drag is in progress -- set on dragstart, read by whatever row the
// drop lands on, cleared on dragend/drop regardless of outcome.
let dragSource = null;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
// Real <button>s instead of span/div+mousedown: focusable, keyboard-operable
// (Enter/Space fire click for free), announced with a role by default.
// mousedown still gets preventDefault() (keeps editor focus from being
// stolen); bind the actual action to click.
function btn(className, text) {
  const b = document.createElement('button');
  b.type = 'button';
  if (className) b.className = className;
  if (text !== undefined) b.textContent = text;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  return b;
}
function icon(cls) {
  const i = document.createElement('i');
  i.className = 'ti ' + cls;
  return i;
}

function injectStyle() {
  if (document.getElementById('scene-rail-style')) return;
  const style = document.createElement('style');
  style.id = 'scene-rail-style';
  style.textContent = `
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
.rail-chapter-row.drag-over { background: var(--wash-accent); box-shadow: inset 0 0 0 1px var(--syntax-2, var(--accent)); }
.rail-scene-row.drag-over { background: var(--wash-accent-strong); box-shadow: inset 2px 0 0 var(--syntax-2, var(--accent)); }
`;
  document.head.appendChild(style);
}

// Swaps a title's display span for an inline <input>. Enter or blur commits
// (only if the value actually changed and isn't blank); Escape cancels. On
// either path a re-render restores the row — via ctx.refreshNav() after a
// real commit, or a plain local render() when nothing changed.
function beginEdit(displayEl, currentValue, onCommit) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-rename-input';
  input.value = currentValue;
  displayEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  function finish(shouldCommit) {
    if (done) return;
    done = true;
    input.removeEventListener('blur', onBlur);
    const v = input.value.trim();
    if (shouldCommit && v && v !== currentValue) { onCommit(v); return; }
    render();
  }
  function onBlur() { finish(true); }
  input.addEventListener('blur', onBlur);
  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
}

// Two-click confirm: first click arms it (icon turns danger-colored, shows
// "delete?"), a second click on the SAME button within 3s actually deletes.
// Clicking elsewhere, arming a different delete button, or the timeout
// disarms it — no native confirm() dialog, consistent with the rest of this
// app never using one, but still real friction against a stray click, on
// top of undo already being available as the last line of defense.
function makeDeleteButton(label, onConfirm) {
  const button = btn('rail-delete-btn');
  let armed = false;
  let timer = null;

  function paint() {
    button.innerHTML = '';
    button.appendChild(icon('ti-trash'));
    if (armed) {
      button.appendChild(document.createTextNode(' delete?'));
      button.title = 'click again to delete ' + label;
      button.setAttribute('aria-label', 'Confirm delete ' + label);
    } else {
      button.title = 'delete ' + label;
      button.setAttribute('aria-label', 'Delete ' + label);
    }
    button.classList.toggle('confirm', armed);
  }

  function disarm() {
    clearTimeout(timer);
    armed = false;
    paint();
  }
  button._disarm = disarm;

  button.addEventListener('mousedown', (e) => e.stopPropagation());
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (armed) {
      disarm();
      onConfirm();
      return;
    }
    document.querySelectorAll('.rail-delete-btn').forEach((b) => { if (b !== button && b._disarm) b._disarm(); });
    armed = true;
    paint();
    timer = setTimeout(disarm, 3000);
  });

  paint();
  return button;
}

// Scopes native HTML5 drag-and-drop to a small handle icon instead of the
// whole row: `row` only becomes draggable while the mouse is down on the
// handle, and reverts right after (mouseup fires whether or not a drag
// actually started) -- otherwise the whole row would initiate a drag on any
// press+move, stealing the gesture from click-to-toggle/click-to-jump/
// click-to-rename.
function makeDragHandle(row, label) {
  const handle = btn('rail-drag-handle');
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
  ctx.editor.setCursorPos(ctx.view, scene.pos);
  ctx.editor.centerCursor(ctx.view);
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
  const targetCi = ci + dir;
  if (targetCi < 0 || targetCi >= chapters.length) return;
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

export function render() {
  if (!railEl) return;
  const chapters = getManuscript(ctx.view);
  const cursorPos = ctx.editor.getCursorPos(ctx.view);
  const active = findActiveScene(chapters, cursorPos);

  railEl.innerHTML = '';

  const totalScenes = chapters.reduce((sum, c) => sum + c.scenes.length, 0);
  const header = el('div', 'rail-header');
  const headerRight = el('div', 'rail-header-right');
  const corkBtn = btn('rail-corkboard-btn');
  corkBtn.title = 'open corkboard (⌘⇧C)';
  corkBtn.setAttribute('aria-label', 'Open corkboard');
  corkBtn.appendChild(icon('ti-layout-grid'));
  corkBtn.addEventListener('click', () => ctx.openCorkboard());
  headerRight.append(corkBtn, el('span', 'rail-dim', chapters.length + ' ch · ' + totalScenes));
  header.append(el('span', 'rail-label', 'manuscript'), headerRight);
  railEl.appendChild(header);

  const list = el('div', 'rail-list');
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Manuscript');
  chapters.forEach((chapter, ci) => {
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
      beginEdit(chTitle, chapter.title, (newTitle) => ctx.renameTitle(chapter, newTitle));
    });
    const chDeleteBtn = makeDeleteButton(chLabel, () => ctx.deleteChapter(ci, chapters));
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
    });
    // Accepts either drag type: a chapter drop here reorders chapters; a
    // scene drop here moves that scene into this chapter, appended at the
    // end -- the chapter header is a much easier target to hit than a
    // specific scene row, and it's the only drop target an empty chapter has.
    chRow.addEventListener('dragover', (e) => {
      if (!dragSource) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      chRow.classList.add('drag-over');
    });
    chRow.addEventListener('dragleave', () => chRow.classList.remove('drag-over'));
    chRow.addEventListener('drop', (e) => {
      e.preventDefault();
      chRow.classList.remove('drag-over');
      if (!dragSource) return;
      const moved = dragSource.type === 'chapter'
        ? reorderChapters(chapters, { fromIndex: dragSource.chapterIndex, toIndex: ci })
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
          beginEdit(nameSpan, scene.title, (newTitle) => ctx.renameTitle(scene, newTitle));
        });
        const deleteBtn = makeDeleteButton(scene.title, () => ctx.deleteScene(ci, si, chapters));
        const nameGroup = el('div', 'rail-scene-name-group');
        nameGroup.append(nameSpan, editBtn, deleteBtn);
        const rowHandle = makeDragHandle(row, scene.title);
        row.append(rowHandle, nameGroup, el('span', 'rail-dim', scene.isDraft ? 'draft' : String(scene.wordCount)));
        onActivate(row, () => jumpTo(scene));

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
        });
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
            toChapterIndex: ci,
            toSceneIndex: si,
          });
          dragSource = null;
          if (moved !== null) { ctx.setDoc(moved); ctx.refreshNav(); }
        });

        sceneList.appendChild(row);
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
  railEl.appendChild(list);

  const footer = btn('rail-footer');
  footer.append(icon('ti-plus'), document.createTextNode(' new scene'));
  footer.addEventListener('click', () => {
    ctx.addNewScene(chapters.length ? chapters.length - 1 : 0, chapters);
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
