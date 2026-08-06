import { getManuscript, findActiveScene } from './model.js';

let ctx = null;
let railEl = null;
let collapsed = new Set(); // chapter indices

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
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
.rail-corkboard-btn { font-size: 13px; color: var(--text-dim); cursor: pointer; transition: color .15s ease; }
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
  font-size: 11px; color: var(--text-dimmer); opacity: 0; cursor: pointer; flex-shrink: 0;
  transition: opacity .12s ease, color .12s ease;
}
.rail-chapter-row:hover .rail-edit-btn, .rail-scene-row:hover .rail-edit-btn { opacity: 1; }
.rail-edit-btn:hover { color: var(--syntax-2, var(--accent)); }
.rail-delete-btn {
  font-size: 11px; color: var(--text-dimmer); opacity: 0; cursor: pointer; flex-shrink: 0;
  padding: 2px 5px; border-radius: 4px; display: flex; align-items: center; gap: 4px;
  transition: opacity .12s ease, color .12s ease, background .12s ease;
}
.rail-chapter-row:hover .rail-delete-btn, .rail-scene-row:hover .rail-delete-btn { opacity: 1; }
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
  display: flex; align-items: center; gap: 8px; padding: 12px 16px;
  border-top: 1px solid var(--border); color: var(--text-dim); font-size: 12px; cursor: pointer;
}
.rail-footer:hover { color: var(--text); }
.rail-scene-add {
  margin-top: 2px; padding: 6px 10px; border-radius: 6px; cursor: pointer;
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--text-dimmer); opacity: .75;
  transition: opacity .12s ease, color .12s ease, background .12s ease;
}
.rail-scene-add:hover { opacity: 1; color: var(--syntax-2, var(--accent)); background: var(--wash-accent); }
.rail-scene-add .ti-plus { font-size: 12px; }
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
  const btn = el('span', 'rail-delete-btn');
  let armed = false;
  let timer = null;

  function paint() {
    btn.innerHTML = '';
    btn.appendChild(icon('ti-trash'));
    if (armed) {
      btn.appendChild(document.createTextNode(' delete?'));
      btn.title = 'click again to delete ' + label;
    } else {
      btn.title = 'delete ' + label;
    }
    btn.classList.toggle('confirm', armed);
  }

  function disarm() {
    clearTimeout(timer);
    armed = false;
    paint();
  }
  btn._disarm = disarm;

  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (armed) {
      disarm();
      onConfirm();
      return;
    }
    document.querySelectorAll('.rail-delete-btn').forEach((b) => { if (b !== btn && b._disarm) b._disarm(); });
    armed = true;
    paint();
    timer = setTimeout(disarm, 3000);
  });

  paint();
  return btn;
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

export function render() {
  if (!railEl) return;
  const chapters = getManuscript(ctx.view);
  const cursorPos = ctx.editor.getCursorPos(ctx.view);
  const active = findActiveScene(chapters, cursorPos);

  railEl.innerHTML = '';

  const totalScenes = chapters.reduce((sum, c) => sum + c.scenes.length, 0);
  const header = el('div', 'rail-header');
  const headerRight = el('div', 'rail-header-right');
  const corkBtn = el('span', 'rail-corkboard-btn');
  corkBtn.title = 'open corkboard (⌘⇧C)';
  corkBtn.appendChild(icon('ti-layout-grid'));
  corkBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.openCorkboard(); });
  headerRight.append(corkBtn, el('span', 'rail-dim', chapters.length + ' ch · ' + totalScenes));
  header.append(el('span', 'rail-label', 'manuscript'), headerRight);
  railEl.appendChild(header);

  const list = el('div', 'rail-list');
  chapters.forEach((chapter, ci) => {
    const isCollapsed = collapsed.has(ci);
    const chRow = el('div', 'rail-chapter-row');
    const chevron = icon(isCollapsed ? 'ti-chevron-right' : 'ti-chevron-down');
    chevron.className += ' rail-chevron';
    if (!isCollapsed) chevron.style.color = 'var(--syntax-2, var(--accent))';
    const chHasTitle = chapter.title.trim() !== '';
    const chTitle = el('span', 'rail-chapter-title' + (chHasTitle ? '' : ' placeholder'), chapter.displayTitle);
    const chEditBtn = el('span', 'rail-edit-btn');
    chEditBtn.appendChild(icon('ti-pencil'));
    chEditBtn.title = 'rename chapter';
    chEditBtn.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      beginEdit(chTitle, chapter.title, (newTitle) => ctx.renameTitle(chapter, newTitle));
    });
    const chDeleteBtn = makeDeleteButton(
      chHasTitle ? chapter.title : chapter.displayTitle,
      () => ctx.deleteChapter(ci, chapters)
    );
    chRow.append(chevron, el('span', 'rail-chapter-num', 'Ch. ' + chapter.number), chTitle, chEditBtn, chDeleteBtn, el('span', 'rail-dim', String(chapter.scenes.length)));
    chRow.addEventListener('mousedown', (e) => { e.preventDefault(); toggleChapter(ci); });
    list.appendChild(chRow);

    if (!isCollapsed) {
      const sceneList = el('div', 'rail-scene-list');
      chapter.scenes.forEach((scene, si) => {
        const isActive = !!(active && active.chapterIndex === ci && active.sceneIndex === si);
        const row = el('div', 'rail-scene-row' + (isActive ? ' active' : '') + (scene.isDraft ? ' draft' : ''));
        const nameSpan = el('span', 'rail-scene-name', scene.title);
        const editBtn = el('span', 'rail-edit-btn');
        editBtn.appendChild(icon('ti-pencil'));
        editBtn.title = 'rename scene';
        editBtn.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation();
          beginEdit(nameSpan, scene.title, (newTitle) => ctx.renameTitle(scene, newTitle));
        });
        const deleteBtn = makeDeleteButton(scene.title, () => ctx.deleteScene(ci, si, chapters));
        const nameGroup = el('div', 'rail-scene-name-group');
        nameGroup.append(nameSpan, editBtn, deleteBtn);
        row.append(nameGroup, el('span', 'rail-dim', scene.isDraft ? 'draft' : String(scene.wordCount)));
        row.addEventListener('mousedown', (e) => { e.preventDefault(); jumpTo(scene); });
        sceneList.appendChild(row);
      });

      const addRow = el('div', 'rail-scene-add');
      addRow.append(icon('ti-plus'), document.createTextNode(' add scene'));
      addRow.title = 'add a scene to ' + (chHasTitle ? chapter.title : chapter.displayTitle);
      addRow.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.addNewScene(ci, chapters); });
      sceneList.appendChild(addRow);

      list.appendChild(sceneList);
    }
  });
  railEl.appendChild(list);

  const footer = el('div', 'rail-footer');
  footer.append(icon('ti-plus'), document.createTextNode(' new scene'));
  footer.addEventListener('mousedown', (e) => {
    e.preventDefault();
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
  // --editor-measure is a max-width in ch, not a fixed width — it already
  // shrinks to fit whatever room the rail leaves on narrower windows, so no
  // separate rail-open value is needed here anymore.
  render();
}

export function unmount() {
  if (railEl) { railEl.style.display = 'none'; railEl.innerHTML = ''; }
  railEl = null;
  ctx = null;
}
