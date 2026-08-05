// Find & Replace — Editor mode only.
// Search/navigate/replace/highlighting are all real, built on the editor
// bundle's search API (src/editor/search.js — SearchQuery + getCursor(),
// not the panel-opening findNext/findPrevious commands). This module owns
// only the UI chrome; match state and decoration live in the editor.

let ctx = null;
let panelEl = null;
let searchInput = null;
let replaceInput = null;
let countEl = null;
let open = false;

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
  if (document.getElementById('find-replace-style')) return;
  const style = document.createElement('style');
  style.id = 'find-replace-style';
  style.textContent = `
.find-panel {
  position: absolute; top: 16px; right: 22px; width: 300px; z-index: 10;
  padding: 11px 12px; display: none; flex-direction: column; gap: 8px;
  background: var(--glass-bg);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-card, 10px);
  box-shadow: var(--shadow-panel), var(--glass-highlight);
  font-family: var(--font-mono);
}
.find-row { display: flex; align-items: center; gap: 8px; }
.find-field {
  flex: 1; display: flex; align-items: center; gap: 8px;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  border: 1px solid var(--glass-border); border-radius: 6px; padding: 6px 9px;
  min-width: 0;
}
.find-field .ti { font-size: 13px; color: var(--text-dim); flex-shrink: 0; }
.find-input {
  flex: 1; min-width: 0; background: transparent; border: none; outline: none;
  color: var(--text); caret-color: var(--cursor);
  font-family: var(--font-mono); font-size: 12px;
}
.find-input::placeholder { color: var(--text-dimmer); }
.find-count { font-size: 11px; color: var(--text-dimmer); font-variant-numeric: tabular-nums; white-space: nowrap; }
.find-nav { display: flex; gap: 2px; }
.find-nav-btn, .find-close { cursor: pointer; color: var(--text-dim); font-size: 15px; transition: color .1s ease; }
.find-nav-btn:hover, .find-close:hover { color: var(--accent); }
.find-replace-btn {
  font-size: 11px; color: var(--text-dim); padding: 5px 9px;
  border: 1px solid var(--glass-border); border-radius: 6px; cursor: pointer;
  transition: background .1s ease, color .1s ease; white-space: nowrap;
}
.find-replace-btn:hover { background: var(--wash-accent); color: var(--text); }
`;
  document.head.appendChild(style);
}

function updateCount({ count, index }) {
  countEl.textContent = count ? `${index} / ${count}` : '0 / 0';
}

function onQueryInput() {
  updateCount(ctx.editor.setSearchQuery(ctx.view, searchInput.value, { caseSensitive: false }));
}

function next() {
  updateCount(ctx.editor.findNext(ctx.view));
}
function prev() {
  updateCount(ctx.editor.findPrevious(ctx.view));
}

function replaceOne() {
  updateCount(ctx.editor.replaceCurrent(ctx.view, replaceInput.value));
  ctx.focusEditor();
}

function replaceAll() {
  const count = ctx.editor.replaceAll(ctx.view, searchInput.value, replaceInput.value, { caseSensitive: false });
  updateCount({ count: 0, index: 0 });
  if (count) ctx.showToast(`replaced ${count} ${count === 1 ? 'match' : 'matches'}`);
  ctx.focusEditor();
}

function openPanel() {
  open = true;
  panelEl.style.display = 'flex';
  if (searchInput.value) onQueryInput(); else updateCount({ count: 0, index: 0 });
  setTimeout(() => searchInput.focus(), 10);
}
function closePanel() {
  open = false;
  panelEl.style.display = 'none';
  ctx.editor.clearSearch(ctx.view);
  ctx.focusEditor();
}
function togglePanel() {
  if (open) closePanel(); else openPanel();
}

export default {
  id: 'find-replace',

  init(localCtx) {
    ctx = localCtx;
    injectStyle();

    panelEl = el('div', 'find-panel');

    const searchRow = el('div', 'find-row');
    const searchField = el('div', 'find-field');
    searchField.appendChild(icon('ti-search'));
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'find-input';
    searchInput.placeholder = 'find...';
    searchInput.spellcheck = false;
    searchInput.addEventListener('input', onQueryInput);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) prev(); else next(); }
    });
    searchField.appendChild(searchInput);
    searchRow.appendChild(searchField);

    countEl = el('span', 'find-count', '0 / 0');
    searchRow.appendChild(countEl);

    const nav = el('div', 'find-nav');
    const upBtn = el('span', 'find-nav-btn');
    upBtn.appendChild(icon('ti-chevron-up'));
    upBtn.addEventListener('mousedown', (e) => { e.preventDefault(); prev(); });
    const downBtn = el('span', 'find-nav-btn');
    downBtn.appendChild(icon('ti-chevron-down'));
    downBtn.addEventListener('mousedown', (e) => { e.preventDefault(); next(); });
    nav.append(upBtn, downBtn);
    searchRow.appendChild(nav);

    const closeBtn = el('span', 'find-close');
    closeBtn.appendChild(icon('ti-x'));
    closeBtn.addEventListener('mousedown', (e) => { e.preventDefault(); closePanel(); });
    searchRow.appendChild(closeBtn);

    panelEl.appendChild(searchRow);

    const replaceRow = el('div', 'find-row');
    const replaceField = el('div', 'find-field');
    replaceField.appendChild(icon('ti-replace'));
    replaceInput = document.createElement('input');
    replaceInput.type = 'text';
    replaceInput.className = 'find-input';
    replaceInput.placeholder = 'replace with...';
    replaceInput.spellcheck = false;
    replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
    });
    replaceField.appendChild(replaceInput);
    replaceRow.appendChild(replaceField);

    const oneBtn = el('span', 'find-replace-btn', 'one');
    oneBtn.addEventListener('mousedown', (e) => { e.preventDefault(); replaceOne(); });
    const allBtn = el('span', 'find-replace-btn', 'all');
    allBtn.addEventListener('mousedown', (e) => { e.preventDefault(); replaceAll(); });
    replaceRow.append(oneBtn, allBtn);

    panelEl.appendChild(replaceRow);

    panelEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
    });

    ctx.dom.host.appendChild(panelEl);
    open = false;
  },

  destroy() {
    if (ctx) ctx.editor.clearSearch(ctx.view);
    if (panelEl) panelEl.remove();
    panelEl = searchInput = replaceInput = countEl = null;
    open = false;
    ctx = null;
  },

  keybindings() {
    return { 'Mod-f': () => togglePanel() };
  },

  commandGroups() {
    return [
      { group: 'Find',
        items: [
          { label: 'Find & replace', icon: 'ti-search', keys: ['⌘','F'], fn: togglePanel },
        ]
      },
    ];
  },
};
