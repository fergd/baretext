import { el, btn, icon } from '../../dom.js';
import { makeDeleteButton, beginEdit, markSceneGroup } from './ui-helpers.js';
import { reorderScenes } from './reorder.js';

let toolbar, spine, peek, observer, closeTimer;
let localCtx;
function hidePeek() { clearTimeout(closeTimer); if (peek) peek.hidden = true; }
function scheduleHide() { clearTimeout(closeTimer); closeTimer = setTimeout(hidePeek, 250); }
function showPeek() {
  clearTimeout(closeTimer);
  if (!peek || !localCtx.state.railCollapsed) return;
  const opening = peek.hidden;
  peek.hidden = false;
  if (opening) {
    const current = peek.querySelector('.peek-scene-row.active');
    if (current) current.scrollIntoView({ block: 'nearest' });
  }
}
function navigate(item, chapter = false) {
  hidePeek();
  if (chapter) localCtx.jumpToChapter(item); else localCtx.jumpToScene(item);
}
function navigationButton(className, label, item, chapter = false) {
  const button = btn(className);
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('mousedown', e => e.preventDefault());
  button.addEventListener('click', () => navigate(item, chapter));
  return button;
}
function action(label, glyph, fn, cls = '') {
  const button = btn('writing-tool ' + cls);
  button.title = label; button.setAttribute('aria-label', label);
  button.append(icon(glyph));
  button.addEventListener('click', fn);
  return button;
}

// Same trailing-slot swap as rail.js's own wireTrailingHover (word count at
// rest, replaced -- not layered -- by icon buttons on hover/focus): the peek
// panel is read-only in the original spec, but the user wants row-level
// archive/rename/delete parity with the pinned rail even while un-anchored,
// so this is a deliberate duplicate of that small helper rather than a
// shared import — rail.js keeps it module-private and the two panels' row
// markup differs enough (no drag-and-drop here) that a shared helper would
// need its own parameterization anyway.
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
  row.addEventListener('btconfirmchange', apply);
  apply();
}

// mousedown gets preventDefault() (don't steal focus from the editor on a
// plain click, same trick as rail.js's non-draggable rows); the actual jump
// still binds to click. Enter/Space on the row itself also navigates, since
// the row is a non-button treeitem (nested icon buttons can't live inside a
// real <button>) — same composite-widget shape as rail.js's tree rows.
function onActivateRow(row, handler) {
  row.addEventListener('mousedown', (e) => e.preventDefault());
  row.addEventListener('click', handler);
  row.addEventListener('keydown', (e) => {
    if (e.target !== row) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
  });
}

function buildPeekSceneRow(chapters, ci, si, active) {
  const chapter = chapters[ci];
  const scene = chapter.scenes[si];
  const isActive = active?.chapterIndex === ci && active?.sceneIndex === si;
  const row = el('div', 'peek-scene-row' + (isActive ? ' active' : ''));
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-label', scene.title);
  if (isActive) row.setAttribute('aria-current', 'true');
  row.tabIndex = 0;

  const nameSpan = el('span', 'peek-scene-name', scene.title);
  const editBtn = btn('rail-icon-btn rail-edit-btn');
  editBtn.append(icon('lucide-pencil'));
  editBtn.title = 'rename scene';
  editBtn.setAttribute('aria-label', 'Rename ' + scene.title);
  editBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    beginEdit(nameSpan, scene.title, (newTitle) => localCtx.renameTitle(scene, newTitle), localCtx.refreshNav);
  });
  const deleteBtn = makeDeleteButton('rail-icon-btn rail-delete-btn', scene.title, () => localCtx.deleteScene(ci, si, chapters));
  const metaSpan = el('span', 'peek-dim', String(scene.wordCount));
  const controls = el('span', 'rail-trailing-controls');
  const archive = btn('rail-icon-btn rail-archive-btn');
  archive.append(icon(chapter.coldStorage ? 'lucide-corner-up-left' : 'lucide-archive'));
  archive.title = chapter.coldStorage ? 'restore to manuscript' : 'send to cold storage';
  archive.setAttribute('aria-label', archive.title);
  archive.addEventListener('mousedown', (e) => e.stopPropagation());
  archive.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = chapter.coldStorage ? 0 : chapters.length - 1;
    const moved = reorderScenes(chapters, { fromChapterIndex: ci, fromSceneIndex: si, toChapterIndex: target, toSceneIndex: chapters[target].scenes.length });
    if (moved !== null) { localCtx.setDoc(moved); localCtx.refreshNav(); }
  });
  controls.append(archive, editBtn, deleteBtn);
  const trailing = el('span', 'rail-trailing');
  trailing.append(metaSpan, controls);

  row.append(el('span', 'peek-scene-num', String(si + 1).padStart(2, '0')), nameSpan, trailing);
  wireTrailingHover(row, metaSpan, controls);
  markSceneGroup(row, chapter.scenes, si);
  onActivateRow(row, () => navigate(scene));
  return row;
}

function buildPeekChapterRow(chapters, ci) {
  const chapter = chapters[ci];
  const label = chapter.title || 'Untitled';
  const row = el('div', 'peek-chapter-row');
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-label', 'Chapter ' + chapter.number + ' · ' + label);
  row.tabIndex = 0;

  const titleSpan = el('span', 'peek-chapter-title', label);
  const editBtn = btn('rail-icon-btn rail-edit-btn');
  editBtn.append(icon('lucide-pencil'));
  editBtn.title = 'rename chapter';
  editBtn.setAttribute('aria-label', 'Rename chapter ' + chapter.number);
  editBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    beginEdit(titleSpan, chapter.title, (newTitle) => localCtx.renameTitle(chapter, newTitle), localCtx.refreshNav);
  });
  const deleteBtn = makeDeleteButton('rail-icon-btn rail-delete-btn', label, () => localCtx.deleteChapter(ci, chapters));
  const metaSpan = el('span', 'peek-dim', chapter.scenes.length + '/' + chapter.scenes.reduce((n, s) => n + s.wordCount, 0));
  const controls = el('span', 'rail-trailing-controls');
  controls.append(editBtn, deleteBtn);
  const trailing = el('span', 'rail-trailing');
  trailing.append(metaSpan, controls);

  row.append(icon('lucide-chevron-down'), el('span', 'peek-chapter-num', String(chapter.number).padStart(2, '0')), titleSpan, trailing);
  wireTrailingHover(row, metaSpan, controls);
  onActivateRow(row, () => navigate(chapter, true));
  return row;
}

export function mountShell(ctx) {
  localCtx = ctx;
  toolbar = el('div', 'writing-toolbar');
  document.getElementById('titlebar').append(toolbar);
  spine = el('div', 'writing-spine');
  spine.setAttribute('aria-label', 'Preview outline'); spine.tabIndex = 0;
  spine.addEventListener('mouseenter', showPeek);
  spine.addEventListener('mouseleave', scheduleHide);
  spine.addEventListener('focus', showPeek);
  spine.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === spine) ctx.toggleRailCollapsed(); if (e.key === 'Escape') hidePeek(); });
  peek = el('div', 'writing-peek'); peek.hidden = true;
  peek.setAttribute('aria-label', 'Outline preview');
  peek.addEventListener('mouseenter', showPeek);
  peek.addEventListener('mouseleave', scheduleHide);
  peek.addEventListener('focusin', showPeek);
  peek.addEventListener('focusout', e => { if (!peek.contains(e.relatedTarget)) scheduleHide(); });
  peek.addEventListener('keydown', e => { if (e.key === 'Escape') { hidePeek(); ctx.focusEditor(); } });
  document.getElementById('editor-host').append(spine, peek);
  observer = new MutationObserver(() => { hidePeek(); updateToggle(); });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-rail-collapsed'] });
  observer.observe(ctx.dom.app, { attributes: true, attributeFilter: ['class'] });
}

function updateToggle() {
  const pin = toolbar?.querySelector('.writing-pin');
  if (!pin) return;
  const collapsed = localCtx.state.railCollapsed;
  pin.replaceChildren(icon(collapsed ? 'lucide-panel-left-open' : 'lucide-panel-left-close'));
  pin.title = collapsed ? 'Pin outline (⌘\\)' : 'Collapse outline (⌘\\)';
  pin.setAttribute('aria-label', pin.title);
  pin.setAttribute('aria-expanded', String(!collapsed));
  const cb = toolbar.querySelector('.rail-corkboard-btn');
  const open = localCtx.dom.app.classList.contains('corkboard-open');
  cb.replaceChildren(icon(open ? 'lucide-file-text' : 'lucide-panels-top-left'));
  cb.title = open ? 'Back to manuscript' : 'Open corkboard';
  cb.setAttribute('aria-label', cb.title);
}

export function renderShell(chapters, active, titleEl) {
  if (!toolbar) return;
  const ctx = localCtx;
  const current = chapters[active?.chapterIndex ?? 0];
  const scene = current?.scenes[active?.sceneIndex ?? 0];
  const pin = action('Pin outline', 'lucide-panel-left-open', () => ctx.toggleRailCollapsed(), 'writing-pin rail-panel-collapse-btn');
  const cork = action('Open corkboard', 'lucide-panels-top-left', () => ctx.toggleCorkboard(), 'rail-corkboard-btn');
  const crumb = el('span', 'writing-breadcrumb', current && !current.coldStorage ? 'chapter ' + current.number + (scene ? ' · ' + scene.title : '') : 'cold storage');
  const search = action('Find & replace (⌘F)', 'lucide-search', () => ctx.openFind(), 'writing-search');
  toolbar.replaceChildren(pin, cork, titleEl, crumb, search);
  updateToggle();
  spine.replaceChildren();
  chapters.forEach((ch, ci) => {
    if (ch.coldStorage) return;
    const group = el('div', 'writing-tick-group');
    ch.scenes.forEach((sc, si) => {
      const selected = active?.chapterIndex === ci && active?.sceneIndex === si;
      const tick = navigationButton('writing-tick' + (selected ? ' active' : ''), 'Chapter ' + ch.number + ' · ' + sc.title, sc);
      if (selected) tick.setAttribute('aria-current', 'true');
      group.append(tick);
    });
    if (!ch.scenes.length) group.append(navigationButton('writing-tick', 'Chapter ' + ch.number + ' · ' + (ch.title || 'Untitled'), ch, true));
    spine.append(group);
  });
  const head = el('div', 'writing-peek-header');
  head.append(el('span', '', 'OUTLINE'), action('Pin outline', 'lucide-panel-left-open', () => ctx.toggleRailCollapsed()));
  const body = el('div', 'writing-peek-body');
  chapters.forEach((ch, ci) => {
    if (ch.coldStorage) return;
    body.append(buildPeekChapterRow(chapters, ci));
    ch.scenes.forEach((sc, si) => body.append(buildPeekSceneRow(chapters, ci, si, active)));
  });
  peek.replaceChildren(head, body);
}
export function unmountShell() {
  hidePeek(); observer?.disconnect(); toolbar?.remove(); spine?.remove(); peek?.remove();
  toolbar = spine = peek = observer = localCtx = null;
}
