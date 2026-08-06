import { getManuscript, findActiveScene } from './model.js';
import { reorderScenes } from './reorder.js';

let ctx = null;
let boardEl = null;
let open = false;
let dragSource = null; // { chapterIndex, sceneIndex } while a card drag is in progress

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
  if (document.getElementById('corkboard-style')) return;
  const style = document.createElement('style');
  style.id = 'corkboard-style';
  style.textContent = `
#corkboard { font-family: var(--font-mono); }
.corkboard-toolbar {
  height: 42px; flex: none; background: var(--bg-alt); border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between; padding: 0 20px;
}
.corkboard-toolbar-left { display: flex; align-items: center; gap: 10px; }
.corkboard-toolbar-left .ti-layout-grid { font-size: 15px; color: var(--syntax-2, var(--accent)); }
.corkboard-label { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--syntax-2, var(--accent)); font-weight: 600; }
.corkboard-meta { font-size: 12px; color: var(--text-dimmer); }
.corkboard-back {
  all: unset; box-sizing: border-box; cursor: pointer; padding: 4px 6px; margin: -4px -6px;
  display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-dim);
}
.corkboard-back:hover { color: var(--text); }
.corkboard-back kbd { background: var(--kbd-bg); border: 1px solid var(--kbd-border); border-bottom-width: 2px; border-radius: 4px; padding: 1px 6px; font-size: 10px; color: var(--text-dim); }
.corkboard-toolbar-right { display: flex; align-items: center; gap: 16px; }
.corkboard-tool-btn {
  all: unset; box-sizing: border-box; cursor: pointer; padding: 4px 6px; margin: -4px -6px;
  display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-dim);
  transition: color .15s ease;
}
.corkboard-tool-btn:hover { color: var(--syntax-2, var(--accent)); }
.corkboard-body { flex: 1; overflow: auto; padding: 22px 26px; }
.corkboard-chapter { margin-bottom: 24px; }
.corkboard-chapter-header { display: flex; align-items: center; gap: 11px; margin-bottom: 13px; }
.corkboard-chapter-header .ti-chevron-down { font-size: 15px; color: var(--text-dim); cursor: pointer; }
.corkboard-chapter-title-group { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.corkboard-chapter-num { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--syntax-2, var(--accent)); font-weight: 700; white-space: nowrap; }
.corkboard-chapter-title-text { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-dim); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.corkboard-chapter-title-text.placeholder { font-style: italic; opacity: .55; font-weight: 600; }
.corkboard-edit-btn {
  all: unset; box-sizing: border-box; position: relative;
  font-size: 12px; color: var(--text-dimmer); opacity: .5; cursor: pointer; flex-shrink: 0;
  transition: opacity .12s ease, color .12s ease;
}
.corkboard-edit-btn::before { content: ''; position: absolute; inset: -8px; }
/* Rename/delete/open are core scene-management actions -- hover-only
   visibility would make them permanently unreachable by keyboard, touch, or
   screen reader. Stay visually quiet by default, come to full strength on
   hover AND :focus-within (so tabbing to a button inside a card reveals it
   too, not just mouse hover). */
.corkboard-chapter-header:hover .corkboard-edit-btn, .scene-card:hover .corkboard-edit-btn,
.corkboard-chapter-header:focus-within .corkboard-edit-btn, .scene-card:focus-within .corkboard-edit-btn { opacity: 1; }
.corkboard-edit-btn:hover { color: var(--syntax-2, var(--accent)); }
.corkboard-delete-btn {
  all: unset; box-sizing: border-box; position: relative;
  font-size: 12px; color: var(--text-dimmer); opacity: .5; cursor: pointer; flex-shrink: 0;
  padding: 2px 5px; border-radius: 4px; display: flex; align-items: center; gap: 4px;
  transition: opacity .12s ease, color .12s ease, background .12s ease;
}
.corkboard-delete-btn::before { content: ''; position: absolute; inset: -6px; }
.corkboard-chapter-header:hover .corkboard-delete-btn, .scene-card:hover .corkboard-delete-btn,
.corkboard-chapter-header:focus-within .corkboard-delete-btn, .scene-card:focus-within .corkboard-delete-btn { opacity: 1; }
.corkboard-delete-btn:hover { color: #e05c5c; }
.corkboard-delete-btn.confirm {
  opacity: 1; color: #e05c5c; font-weight: 600;
  background: color-mix(in srgb, #e05c5c 15%, transparent);
}
.corkboard-chapter-rule { flex: 1; height: 1px; background: var(--border); }
.corkboard-chapter-meta { font-size: 11px; color: var(--text-dimmer); letter-spacing: .04em; white-space: nowrap; }
.corkboard-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; padding-left: 26px; }
.scene-card {
  background: var(--bg-alt); border: 1px solid var(--border); border-radius: var(--radius-card, 10px);
  padding: 13px; display: flex; flex-direction: column; gap: 7px; min-height: 120px; cursor: grab;
  user-select: none;
}
.scene-card:hover { border-color: color-mix(in srgb, var(--syntax-2, var(--accent)) 50%, var(--border)); }
.scene-card.active { border-color: var(--syntax-2, var(--accent)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--syntax-2, var(--accent)) 12%, transparent); }
.scene-card.draft { opacity: .7; }
.scene-card.dragging { opacity: .35; cursor: grabbing; }
.scene-card.drag-over { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent); }
.corkboard-grid.drag-over-grid { background: var(--wash-accent); border-radius: var(--radius-card, 10px); }
.scene-card .scene-card-title { font-size: 13px; color: var(--text); font-weight: 700; display: flex; align-items: baseline; gap: 4px; }
.scene-card.draft .scene-card-title { color: var(--text-dim); }
.scene-card-title-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-card .scene-card-synopsis { font-size: 11px; line-height: 1.55; color: var(--text-dim); flex: 1; }
.scene-card.draft .scene-card-synopsis { font-style: italic; color: var(--text-dimmer); }
.scene-card .scene-card-meta { font-size: 10px; color: var(--text-dimmer); letter-spacing: .05em; }
.inline-rename-input {
  flex: 1; min-width: 0; background: color-mix(in srgb, var(--bg) 55%, transparent);
  border: 1px solid var(--syntax-2, var(--accent)); border-radius: 4px; padding: 2px 6px;
  color: var(--text); font-family: var(--font-mono); font-size: 12px; outline: none;
}
.scene-card-new {
  all: unset; box-sizing: border-box; width: 100%; cursor: pointer;
  border: 1px dashed color-mix(in srgb, var(--text-dim) 50%, transparent); border-radius: var(--radius-card, 10px);
  padding: 13px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; min-height: 120px; color: var(--text-dim);
}
.scene-card-new:hover { color: var(--text); border-color: var(--text-dim); }
.scene-card-new .ti-plus { font-size: 18px; }
.scene-card-new span { font-size: 11px; }
`;
  document.head.appendChild(style);
}

// Two-click confirm: first click arms it (icon turns danger-colored, shows
// "delete?"), a second click on the SAME button within 3s actually deletes.
// Clicking elsewhere, arming a different delete button, or the timeout
// disarms it — no native confirm() dialog, consistent with the rest of this
// app never using one, but still real friction against a stray click, on
// top of undo already being available as the last line of defense.
function makeDeleteButton(label, onConfirm) {
  const button = btn('corkboard-delete-btn');
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
    document.querySelectorAll('.corkboard-delete-btn').forEach((b) => { if (b !== button && b._disarm) b._disarm(); });
    armed = true;
    paint();
    timer = setTimeout(disarm, 3000);
  });

  paint();
  return button;
}

function jumpTo(scene) {
  ctx.editor.setCursorPos(ctx.view, scene.pos);
  ctx.editor.centerCursor(ctx.view);
  close();
  ctx.refreshNav();
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

export function render() {
  if (!boardEl) return;
  const chapters = getManuscript(ctx.view);
  const cursorPos = ctx.editor.getCursorPos(ctx.view);
  const active = findActiveScene(chapters, cursorPos);
  const totalScenes = chapters.reduce((sum, c) => sum + c.scenes.length, 0);

  boardEl.innerHTML = '';

  const toolbar = el('div', 'corkboard-toolbar');
  const left = el('div', 'corkboard-toolbar-left');
  left.append(icon('ti-layout-grid'), el('span', 'corkboard-label', 'corkboard'), el('span', 'corkboard-meta', totalScenes + ' scenes'));

  const right = el('div', 'corkboard-toolbar-right');
  const undoBtn = btn('corkboard-tool-btn');
  undoBtn.appendChild(icon('ti-arrow-back-up'));
  undoBtn.appendChild(document.createTextNode(' undo'));
  undoBtn.title = 'undo (⌘Z)';
  undoBtn.addEventListener('click', () => { ctx.editor.undo(ctx.view); ctx.refreshNav(); });
  const redoBtn = btn('corkboard-tool-btn');
  redoBtn.appendChild(icon('ti-arrow-forward-up'));
  redoBtn.appendChild(document.createTextNode(' redo'));
  redoBtn.title = 'redo (⌘⇧Z)';
  redoBtn.addEventListener('click', () => { ctx.editor.redo(ctx.view); ctx.refreshNav(); });

  const back = btn('corkboard-back');
  const kbd = document.createElement('kbd');
  kbd.textContent = 'esc';
  back.append(kbd, document.createTextNode(' back to writing'));
  back.addEventListener('click', () => close());

  right.append(undoBtn, redoBtn, back);
  toolbar.append(left, right);
  boardEl.appendChild(toolbar);

  const body = el('div', 'corkboard-body');
  chapters.forEach((chapter, ci) => {
    const section = el('div', 'corkboard-chapter');
    const header = el('div', 'corkboard-chapter-header');
    const chapterWords = chapter.scenes.reduce((sum, s) => sum + s.wordCount, 0);

    const chHasTitle = chapter.title.trim() !== '';
    // The number badge already reads "Chapter N" in full — echoing that
    // again as the title when there isn't one yet would just duplicate it,
    // so this gets its own distinct placeholder wording instead.
    const chLabel = chHasTitle ? chapter.title : 'Chapter ' + chapter.number;
    const chTitleText = el('span', 'corkboard-chapter-title-text' + (chHasTitle ? '' : ' placeholder'), chHasTitle ? chapter.title : 'untitled');
    const chEditBtn = btn('corkboard-edit-btn');
    chEditBtn.appendChild(icon('ti-pencil'));
    chEditBtn.title = 'rename chapter';
    chEditBtn.setAttribute('aria-label', 'Rename ' + chLabel);
    chEditBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    chEditBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      beginEdit(chTitleText, chapter.title, (newTitle) => ctx.renameTitle(chapter, newTitle));
    });
    const chDeleteBtn = makeDeleteButton(chLabel, () => ctx.deleteChapter(ci, chapters));
    const chTitleGroup = el('div', 'corkboard-chapter-title-group');
    chTitleGroup.append(el('span', 'corkboard-chapter-num', 'Chapter ' + chapter.number), chTitleText, chEditBtn, chDeleteBtn);

    header.append(
      icon('ti-chevron-down'),
      chTitleGroup,
      el('span', 'corkboard-chapter-rule'),
      el('span', 'corkboard-chapter-meta', chapter.scenes.length + ' scenes · ' + chapterWords + ' words')
    );
    section.appendChild(header);

    const grid = el('div', 'corkboard-grid');
    chapter.scenes.forEach((scene, si) => {
      const isActive = !!(active && active.chapterIndex === ci && active.sceneIndex === si);
      const card = el('div', 'scene-card' + (isActive ? ' active' : '') + (scene.isDraft ? ' draft' : ''));

      const titleTextSpan = el('span', 'scene-card-title-text', scene.title);
      const editBtn = btn('corkboard-edit-btn');
      editBtn.appendChild(icon('ti-pencil'));
      editBtn.title = 'rename scene';
      editBtn.setAttribute('aria-label', 'Rename ' + scene.title);
      editBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        beginEdit(titleTextSpan, scene.title, (newTitle) => ctx.renameTitle(scene, newTitle));
      });
      // Explicit, deliberate navigation control — double-click also jumps,
      // but this is the discoverable version so no interaction with a card
      // (editing, dragging, adding) ever navigates away by surprise.
      const openBtn = btn('corkboard-edit-btn');
      openBtn.appendChild(icon('ti-arrow-up-right'));
      openBtn.title = 'open in manuscript';
      openBtn.setAttribute('aria-label', 'Open ' + scene.title + ' in manuscript');
      openBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      openBtn.addEventListener('click', (e) => { e.stopPropagation(); jumpTo(scene); });
      const deleteBtn = makeDeleteButton(scene.title, () => ctx.deleteScene(ci, si, chapters));
      const titleRow = el('div', 'scene-card-title');
      titleRow.append(el('span', undefined, (si + 1) + ' · '), titleTextSpan, editBtn, openBtn, deleteBtn);

      card.append(
        titleRow,
        el('div', 'scene-card-synopsis', scene.isDraft ? (scene.synopsis || 'empty') : scene.synopsis),
        el('div', 'scene-card-meta', scene.isDraft ? 'draft' : scene.wordCount + ' words')
      );
      card.title = 'double-click to jump to this scene · drag to reorder';
      card.addEventListener('dblclick', (e) => { e.preventDefault(); jumpTo(scene); });

      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        dragSource = { chapterIndex: ci, sceneIndex: si };
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', scene.id);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        dragSource = null;
      });
      card.addEventListener('dragover', (e) => {
        if (!dragSource) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', () => { card.classList.remove('drag-over'); });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (!dragSource) return;
        const moved = reorderScenes(chapters, {
          fromChapterIndex: dragSource.chapterIndex,
          fromSceneIndex: dragSource.sceneIndex,
          toChapterIndex: ci,
          toSceneIndex: si,
        });
        dragSource = null;
        if (moved !== null) { ctx.setDoc(moved); ctx.refreshNav(); }
      });

      grid.appendChild(card);
    });

    const newTile = btn('scene-card-new');
    newTile.append(icon('ti-plus'), el('span', undefined, 'new scene'));
    newTile.setAttribute('aria-label', 'Add a scene to ' + chLabel);
    newTile.addEventListener('click', () => ctx.addNewScene(ci, chapters));
    grid.appendChild(newTile);

    grid.addEventListener('dragover', (e) => {
      if (!dragSource || e.target !== grid) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      grid.classList.add('drag-over-grid');
    });
    grid.addEventListener('dragleave', (e) => {
      if (e.target === grid) grid.classList.remove('drag-over-grid');
    });
    grid.addEventListener('drop', (e) => {
      if (e.target !== grid) return;
      e.preventDefault();
      grid.classList.remove('drag-over-grid');
      if (!dragSource) return;
      const moved = reorderScenes(chapters, {
        fromChapterIndex: dragSource.chapterIndex,
        fromSceneIndex: dragSource.sceneIndex,
        toChapterIndex: ci,
        toSceneIndex: chapter.scenes.length,
      });
      dragSource = null;
      if (moved !== null) { ctx.setDoc(moved); ctx.refreshNav(); }
    });

    section.appendChild(grid);
    body.appendChild(section);
  });
  boardEl.appendChild(body);
}

export function isOpen() { return open; }

export function toggle() {
  if (open) close(); else show();
}

export function show() {
  open = true;
  document.getElementById('content-row').style.display = 'none';
  boardEl.style.display = 'flex';
  render();
}

export function close() {
  open = false;
  boardEl.style.display = 'none';
  document.getElementById('content-row').style.display = 'flex';
  ctx.focusEditor();
}

export function mount(localCtx) {
  ctx = localCtx;
  injectStyle();
  boardEl = document.getElementById('corkboard');
  open = false;
}

export function unmount() {
  if (open) close();
  boardEl = null;
  ctx = null;
}
