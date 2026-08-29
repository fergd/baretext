// Spellcheck — Editor mode only. On by default; toggleable via the palette
// since not everyone wants wavy underlines under names/jargon while writing.
// Right-click (or ctrl-click, which fires the same 'contextmenu' event on
// Mac) a flagged word to see corrections; native OS spellcheck can't see
// these errors at all (CodeMirror 6 owns its own DOM/typing pipeline,
// confirmed earlier), so this popup is the only way to get suggestions.
import { el, injectStyle as injectStyleTag } from '../dom.js';

let ctx = null;
let enabled = true;
let panelEl = null;
let contextMenuHandler = null;
let dismissHandler = null;

function injectStyle() {
  injectStyleTag('spell-suggest-style', `
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
.spell-suggest-divider { height: 1px; margin: 4px 2px; background: var(--glass-border); }
.spell-suggest-ignore { color: var(--text-dim); }
.spell-suggest-ignore:hover { background: var(--wash-accent); color: var(--text); }
`);
}

// Two independent spellcheck layers exist here, and both need to move
// together or toggling "off" is a lie: this app's own Hunspell-backed
// checker (spellcheckField/.cm-spellError, toggled via setSpellcheck above)
// AND Chromium's native as-you-type spellchecker (the plain `spellcheck`
// DOM attribute + its ::spelling-error pseudo-element, styled in
// index.html). app.js's applyNativeSpellcheck() only ever keys that
// attribute off the current MODE, with no idea this toggle exists -- so
// turning this off used to leave native spellcheck running untouched,
// meaning the very next freshly-typed typo got flagged anyway and looked
// exactly like spellcheck "turning itself back on". Setting the attribute
// here too keeps them in lockstep regardless of which one changes it:
// mode switches still go through applyNativeSpellcheck() first (see
// activateMode()), and this runs again right after via init()'s own
// apply() call, so entering Editor mode still ends with both correctly on.
function apply() {
  ctx.editor.setSpellcheck(ctx.view, enabled);
  ctx.dom.host.querySelector('.cm-content').setAttribute('spellcheck', String(enabled));
}

function toggle() {
  enabled = !enabled;
  apply();
  ctx.showToast(enabled ? 'spellcheck on' : 'spellcheck off');
  if (!enabled) hidePopup();
}

function clearIgnoredWords() {
  const count = ctx.editor.getIgnoredWords().length;
  ctx.editor.clearIgnoredWords(ctx.view);
  ctx.api.setIgnoredWords(ctx.editor.getIgnoredWords());
  ctx.showToast(count ? `cleared ${count} ignored ${count === 1 ? 'word' : 'words'}` : 'no ignored words to clear');
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

// Ignoring persists globally (not per-file) — names and jargon come up
// across whatever you're writing, not just this document.
function ignoreWord(word) {
  ctx.editor.ignoreWord(ctx.view, word);
  ctx.api.setIgnoredWords(ctx.editor.getIgnoredWords());
  hidePopup();
  ctx.showToast(`ignoring "${word}"`);
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

  panelEl.appendChild(el('div', 'spell-suggest-divider'));
  const ignoreItem = el('div', 'spell-suggest-item spell-suggest-ignore', `ignore "${hit.word}"`);
  ignoreItem.addEventListener('mousedown', (e) => { e.preventDefault(); ignoreWord(hit.word); });
  panelEl.appendChild(ignoreItem);

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
          { label: 'Clear ignored words', icon: 'ti-eraser', fn: clearIgnoredWords },
        ]
      },
    ];
  },
};
