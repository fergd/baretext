// Spellcheck — Editor mode only. On by default; toggleable via the palette
// since not everyone wants wavy underlines under names/jargon while writing.
// Right-click (or ctrl-click, which fires the same 'contextmenu' event on
// Mac) a flagged word to see corrections; native OS spellcheck can't see
// these errors at all (CodeMirror 6 owns its own DOM/typing pipeline,
// confirmed earlier), so this popup is the only way to get suggestions.

let ctx = null;
let enabled = true;
let panelEl = null;
let contextMenuHandler = null;
let dismissHandler = null;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function injectStyle() {
  if (document.getElementById('spell-suggest-style')) return;
  const style = document.createElement('style');
  style.id = 'spell-suggest-style';
  style.textContent = `
.spell-suggest-panel {
  position: fixed; z-index: 60; min-width: 140px; max-width: 220px;
  padding: 5px; display: none; flex-direction: column; gap: 1px;
  background: var(--glass-bg);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-item, 6px);
  box-shadow: var(--shadow-panel), var(--glass-highlight);
  font-family: var(--font-mono);
}
.spell-suggest-item {
  padding: 6px 9px; font-size: 12px; color: var(--text);
  border-radius: 4px; cursor: pointer;
}
.spell-suggest-item:hover { background: var(--wash-accent); color: var(--accent); }
.spell-suggest-empty { padding: 6px 9px; font-size: 12px; color: var(--text-dimmer); font-style: italic; }
`;
  document.head.appendChild(style);
}

function apply() {
  ctx.editor.setSpellcheck(ctx.view, enabled);
}

function toggle() {
  enabled = !enabled;
  apply();
  ctx.showToast(enabled ? 'spellcheck on' : 'spellcheck off');
  if (!enabled) hidePopup();
}

function hidePopup() {
  panelEl.style.display = 'none';
  document.removeEventListener('mousedown', dismissHandler, true);
  document.removeEventListener('keydown', onPopupKeydown, true);
}

function onPopupKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); hidePopup(); }
}

function applySuggestion(from, to, suggestion) {
  ctx.view.dispatch({ changes: { from, to, insert: suggestion }, selection: { anchor: from + suggestion.length } });
  hidePopup();
  ctx.focusEditor();
}

function showPopup(x, y, hit) {
  const suggestions = ctx.editor.getSpellingSuggestions(hit.word);
  panelEl.innerHTML = '';

  if (!suggestions.length) {
    panelEl.appendChild(el('div', 'spell-suggest-empty', 'no suggestions'));
  } else {
    suggestions.forEach((s) => {
      const item = el('div', 'spell-suggest-item', s);
      item.addEventListener('mousedown', (e) => { e.preventDefault(); applySuggestion(hit.from, hit.to, s); });
      panelEl.appendChild(item);
    });
  }

  panelEl.style.left = x + 'px';
  panelEl.style.top = y + 'px';
  panelEl.style.display = 'flex';

  // Defer attaching the dismiss listener so the contextmenu's own click
  // doesn't immediately close the panel it just opened.
  setTimeout(() => {
    document.addEventListener('mousedown', dismissHandler, true);
    document.addEventListener('keydown', onPopupKeydown, true);
  }, 0);
}

export default {
  id: 'spellcheck',

  init(localCtx) {
    ctx = localCtx;
    enabled = true;
    injectStyle();

    panelEl = el('div', 'spell-suggest-panel');
    document.body.appendChild(panelEl);

    dismissHandler = (e) => {
      if (!panelEl.contains(e.target)) hidePopup();
    };

    contextMenuHandler = (e) => {
      if (!enabled) return;
      const pos = ctx.view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return;
      const hit = ctx.editor.spellcheckWordAt(ctx.view, pos);
      if (!hit) return;
      e.preventDefault();
      showPopup(e.clientX, e.clientY, hit);
    };
    ctx.dom.host.addEventListener('contextmenu', contextMenuHandler);

    apply();
  },

  destroy() {
    hidePopup();
    if (ctx) {
      ctx.dom.host.removeEventListener('contextmenu', contextMenuHandler);
      ctx.editor.setSpellcheck(ctx.view, false);
    }
    if (panelEl) panelEl.remove();
    panelEl = null;
    contextMenuHandler = null;
    ctx = null;
  },

  keybindings() {
    return { 'Mod-Shift-P': () => toggle() };
  },

  commandGroups() {
    return [
      { group: 'Editor',
        items: [
          { label: 'Toggle spellcheck', icon: 'ti-a-b-2', keys: ['⌘','⇧','P'], checked: enabled, fn: toggle },
        ]
      },
    ];
  },
};
