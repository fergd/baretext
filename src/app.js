import { MODES, DEFAULT_MODE } from './modes.js';
import core from './features/core.js';
import sprintTimer from './features/sprint-timer.js';
import findReplace from './features/find-replace.js';
import spellcheck from './features/spellcheck.js';
import sceneNav from './features/scene-nav/index.js';
import * as themePicker from './theme-picker.js';

const FEATURES = { core, 'sprint-timer': sprintTimer, 'find-replace': findReplace, spellcheck, 'scene-nav': sceneNav };

const app        = document.getElementById('app');
const host       = document.getElementById('editor-host');
const elWord     = document.getElementById('word-count');
const elChar     = document.getElementById('char-count');
const elFile     = document.getElementById('file-name');
const elSaveErr  = document.getElementById('save-error');
const overlay    = document.getElementById('overlay');
const pInput     = document.getElementById('palette-input');
const pList      = document.getElementById('palette-list');
const fontPicker = document.getElementById('font-picker');
const toastEl    = document.getElementById('toast');
const statusbar  = document.getElementById('statusbar');
const statusLeft = statusbar.querySelector('.status-group');
const twIndicator = document.getElementById('tw-status-indicator');
const modeSwitch = document.getElementById('mode-switch');
const modeTabs   = [...modeSwitch.querySelectorAll('.mode-tab')];

const state = {
  theme: document.documentElement.getAttribute('data-theme'),
  font: 'mono',
  typewriter: false,
  focusMode: false,
  filePath: null,
  sourceMode: false,
  mode: document.documentElement.getAttribute('data-mode') || DEFAULT_MODE,
  wordCount: 0,
};

// ── Create the CodeMirror editor ──
let view = window.BaretextEditor.create(
  host,
  '',
  (doc) => {
    updateCounts(doc);
    window.api.contentChanged(doc);
    if (state.typewriter) window.BaretextEditor.centerCursor(view);
  },
  'start writing...'
);
// Force native spellcheck on the editable surface, regardless of what the
// bundle's own extensions set — belt and suspenders alongside webPreferences.
const cmContent = host.querySelector('.cm-content');
if (cmContent) cmContent.setAttribute('spellcheck', 'true');

function getDoc()      { return window.BaretextEditor.getDoc(view); }
function setDoc(text)  { window.BaretextEditor.setDoc(view, text); }
function focusEditor() { window.BaretextEditor.focus(view); }

// ── IPC from main ──
window.api.onThemeChanged(() => {});
window.api.onFileLoaded(({ content, filePath, cursorPos, typewriter, ignoredWords }) => {
  if (content !== null && content !== undefined) setDoc(content);
  state.filePath = filePath;
  setFileName(filePath);
  updateCounts(getDoc());
  if (typeof typewriter === 'boolean') setTypewriter(typewriter, { silent: true });
  if (Array.isArray(ignoredWords)) window.BaretextEditor.setIgnoredWords(view, ignoredWords);
  requestAnimationFrame(() => {
    if (typeof cursorPos === 'number' && cursorPos >= 0) {
      window.BaretextEditor.setCursorPos(view, cursorPos);
    } else {
      window.BaretextEditor.cursorToEnd(view);
    }
    focusEditor();
  });
});
window.api.onAutoSaved(() => { elSaveErr.classList.remove('visible'); });
window.api.onSaveConfirmed(() => { elSaveErr.classList.remove('visible'); showToast('saved'); });

// Persist cursor position, debounced
let cursorSaveTimer = null;
function reportCursorPosition() {
  clearTimeout(cursorSaveTimer);
  cursorSaveTimer = setTimeout(() => {
    window.api.cursorChanged(window.BaretextEditor.getCursorPos(view));
  }, 400);
}
host.addEventListener('keyup', reportCursorPosition);
host.addEventListener('mouseup', reportCursorPosition);

// Typewriter mode: re-center on every caret move, not just doc changes.
// centerCursor() is a no-op scroll when the line is already centered, so
// this doesn't cause motion while typing within a line — only line changes
// (Enter, arrow up/down, wraps, clicks) actually trigger a scroll.
function maybeRecenterTypewriter() {
  if (state.typewriter) window.BaretextEditor.centerCursor(view);
}
host.addEventListener('keyup', maybeRecenterTypewriter);
host.addEventListener('mouseup', maybeRecenterTypewriter);

// ── Status ──
function updateCounts(doc) {
  const t = doc || '';
  const w = t.trim() === '' ? 0 : t.trim().split(/\s+/).length;
  state.wordCount = w;
  elWord.textContent = w + (w === 1 ? ' word' : ' words');
  elChar.textContent = t.length + (t.length === 1 ? ' char' : ' chars');
}
function setFileName(fp) { elFile.textContent = fp ? fp.split('/').pop() : 'untitled'; }

// ── Toast ──
let toastTimer = null;
function showToast(msg, opts) {
  const icon = opts && opts.icon;
  toastEl.innerHTML = '';
  if (icon) {
    const i = document.createElement('i');
    i.className = `ti ${icon}`;
    i.style.cssText = 'font-size:13px;color:var(--accent);margin-right:8px;';
    toastEl.appendChild(i);
  }
  toastEl.appendChild(document.createTextNode(msg));
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

// ── File commands (shared primitives — used by core.js's command manifest) ──
function cmdSave() { window.api.saveNow(getDoc()); }

async function cmdOpen() {
  closePalette(false);
  const r = await window.api.openFile();
  if (r) {
    setDoc(r.content);
    state.filePath = r.filePath;
    setFileName(r.filePath);
    updateCounts(r.content);
  }
  focusEditor();
}

async function cmdNew() {
  closePalette(false);
  const r = await window.api.newFile();
  if (r) {
    setDoc('');
    state.filePath = r.filePath;
    setFileName(r.filePath);
    updateCounts('');
  }
  focusEditor();
}

async function cmdExport() {
  closePalette(false);
  const fp = await window.api.exportFile(getDoc());
  if (fp) showToast('exported');
  focusEditor();
}

async function cmdSaveDir() {
  closePalette(false);
  const dir = await window.api.chooseSaveDir();
  if (dir) showToast('save location set');
  focusEditor();
}

// ── Theme ──
const themeTextColors = {
  dark: '#faf2d6', light: '#2a2218',
  amstrad: '#c8e6b0', grove: '#d3c6aa', dracula: '#f8f8f2',
};
const themeAccentColors = {
  dark: '#f8c537', light: '#b8820a',
  amstrad: '#7dc45a', grove: '#a7c080', dracula: '#bd93f9',
};

function setTheme(t) {
  state.theme = t;
  window.api.setAccentTheme(t);
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;opacity:0.35;z-index:99998;pointer-events:none;transition:opacity 0.3s ease;background:var(--bg);';
  document.body.appendChild(flash);
  requestAnimationFrame(() => {
    document.documentElement.setAttribute('data-theme', t);
    requestAnimationFrame(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), 350);
    });
  });
  window.api.setTheme(t === 'light' ? 'light' : 'dark');
  showToast('theme: ' + t);
  if (overlay.classList.contains('open')) render(pInput.value);
}

// ── Font ──
const fontVars = {
  mono:  "'IBM Plex Mono', 'SF Mono', monospace",
  serif: "'IBM Plex Serif', 'Georgia', serif",
  sans:  "'IBM Plex Sans', -apple-system, sans-serif",
};
function setFont(f) {
  state.font = f;
  document.documentElement.style.setProperty('--font-editor', fontVars[f]);
  document.querySelectorAll('.fbtn').forEach(b => {
    const isActive = b.dataset.font === f;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-checked', String(isActive));
  });
}
let fontPickerOpenedAt = 0;
function toggleFontPicker() {
  if (fontPicker.classList.contains('open')) {
    fontPicker.classList.remove('open');
  } else {
    fontPickerOpenedAt = Date.now();
    fontPicker.classList.add('open');
  }
}
document.querySelectorAll('.fbtn').forEach(btn => {
  btn.addEventListener('mousedown', (e) => e.stopPropagation());
  btn.addEventListener('click', () => {
    setFont(btn.dataset.font);
    fontPicker.classList.remove('open');
    focusEditor();
  });
});
document.addEventListener('mousedown', (e) => {
  if (!fontPicker.contains(e.target) && Date.now() - fontPickerOpenedAt > 100) {
    fontPicker.classList.remove('open');
  }
});
twIndicator.addEventListener('mousedown', (e) => e.preventDefault());
twIndicator.addEventListener('click', () => toggleTypewriter());

// ── Mode-agnostic editor helpers ──
function insertSceneBreak() {
  window.BaretextEditor.insertSceneBreak(view);
  showToast('scene break inserted');
}
function toggleRenderedMode() {
  state.sourceMode = !state.sourceMode;
  window.BaretextEditor.setRenderedMode(view, state.sourceMode);
  const scroller = host.querySelector('.cm-scroller');
  if (scroller) {
    scroller.style.transition = 'none';
    scroller.style.opacity = '0.4';
    requestAnimationFrame(() => {
      scroller.style.transition = 'opacity 0.2s ease';
      scroller.style.opacity = '1';
      setTimeout(() => { scroller.style.transition = ''; }, 220);
    });
  }
  const elMode = document.getElementById('md-mode');
  if (elMode) elMode.textContent = state.sourceMode ? 'source' : 'preview';
  showToast(state.sourceMode ? 'markdown visible' : 'markdown hidden');
}
function setTypewriter(on, opts = {}) {
  state.typewriter = on;
  const apply = () => {
    app.classList.toggle('typewriter', state.typewriter);
    twIndicator.classList.toggle('tw-on', state.typewriter);
    twIndicator.setAttribute('aria-pressed', String(state.typewriter));
    if (state.typewriter) window.BaretextEditor.centerCursor(view);
  };
  const scroller = host.querySelector('.cm-scroller');
  if (scroller) {
    scroller.style.transition = 'opacity 0.2s ease';
    scroller.style.opacity = '0.4';
    setTimeout(() => {
      apply();
      scroller.style.opacity = '1';
      setTimeout(() => { scroller.style.transition = ''; }, 220);
    }, 110);
  } else {
    apply();
  }
  window.api.setTypewriter(state.typewriter);
  if (!opts.silent) {
    showToast(state.typewriter ? 'typewriter on' : 'typewriter off');
    focusEditor();
  }
}
function toggleTypewriter() { setTypewriter(!state.typewriter); }
function toggleFocus() {
  state.focusMode = !state.focusMode;
  statusbar.classList.toggle('hidden', state.focusMode);
  // The sprint timer's minimized edge line lives outside #statusbar (an
  // absolutely-positioned sibling in sprint-timer.js), so hiding the
  // status bar alone leaves it on screen -- add a class features can key
  // off instead of reaching into another feature's private DOM refs.
  app.classList.toggle('focus-mode', state.focusMode);
  showToast(state.focusMode ? 'focus mode on' : 'focus mode off');
}

// ── Command palette engine ──
let commands = [];             // rebuilt by activateMode()
let flatItems = [];
let activeIdx = 0;
let paletteMode = 'commands';  // 'commands' | 'outline'
let paletteClosing = false;

const themePaletteBg = {
  dark: '#1e1e1e', light: '#e8e3db',
  amstrad: '#0c110c', grove: '#282f34', dracula: '#1e2030',
};
function hexLuminance(hex) {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const lin = c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
  return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
}
function contrastRatio(hex1, hex2) {
  const l1 = hexLuminance(hex1), l2 = hexLuminance(hex2);
  const lighter = Math.max(l1,l2), darker = Math.min(l1,l2);
  return (lighter + 0.05) / (darker + 0.05);
}
function safeThemeLabelColor(themeKey) {
  const labelColor  = themeTextColors[themeKey];
  const bgColor     = themePaletteBg[state.theme] || '#1e1e1e';
  if (contrastRatio(labelColor, bgColor) >= 3) return labelColor;
  return themeTextColors[state.theme] || 'var(--text)';
}

function render(q) {
  q = (q || '').toLowerCase();
  pList.innerHTML = '';
  flatItems = [];

  if (paletteMode === 'outline') {
    renderOutline(q);
    return;
  }

  commands.forEach(group => {
    const matched = group.items.filter(item =>
      item.label.toLowerCase().includes(q) ||
      group.group.toLowerCase().includes(q)
    );
    if (!matched.length) return;

    if (!q) {
      const sec = document.createElement('div');
      sec.className = 'p-section';
      sec.textContent = group.group;
      pList.appendChild(sec);
    }

    matched.forEach(item => {
      const idx = flatItems.length;
      flatItems.push(item);

      const isActiveTheme = item.themeKey && item.themeKey === state.theme;
      const isChecked = isActiveTheme || item.checked;
      const el = document.createElement('div');
      el.className = 'pitem' + (idx === 0 ? ' active' : '');
      el.dataset.idx = idx;
      el.id = 'pitem-' + idx;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(idx === 0));

      const left = document.createElement('div');
      left.className = 'pitem-left';

      const icon = document.createElement('i');
      icon.className = `ti ${item.icon} pitem-icon`;
      if (isActiveTheme) icon.style.color = themeAccentColors[item.themeKey];

      const label = document.createElement('span');
      label.className = 'pitem-label';
      label.textContent = item.label;
      if (item.themeKey) label.style.color = safeThemeLabelColor(item.themeKey);

      left.appendChild(icon);
      left.appendChild(label);

      const right = document.createElement('div');
      right.className = 'pitem-kbd';

      if (isChecked) {
        const check = document.createElement('span');
        check.style.cssText = `color:${isActiveTheme ? themeAccentColors[item.themeKey] : 'var(--accent)'};font-size:13px;font-weight:700;`;
        check.textContent = '✓';
        right.appendChild(check);
      } else {
        (item.keys || []).forEach(k => {
          const kbd = document.createElement('kbd');
          kbd.className = 'pkey';
          kbd.textContent = k;
          right.appendChild(kbd);
        });
      }

      el.appendChild(left);
      el.appendChild(right);

      el.addEventListener('mousedown', (ev) => ev.preventDefault());
      el.addEventListener('click', () => { item.fn(); if (!item.keepOpen) closePalette(); });
      el.addEventListener('mousemove', () => { activeIdx = idx; updateActive(); });
      pList.appendChild(el);
    });
  });

  activeIdx = 0;
  updateActive();
}

const outlineTypeMeta = {
  h1:    { icon: 'ti-h-1',   dim: false },
  h2:    { icon: 'ti-h-2',   dim: false },
  h3:    { icon: 'ti-h-3',   dim: true  },
  scene: { icon: 'ti-minus', dim: true  },
};

function renderOutline(q) {
  const allItems = window.BaretextEditor.getOutline(view);
  const filtered = q
    ? allItems.filter(it => it.text.toLowerCase().includes(q))
    : allItems;

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'p-section';
    empty.style.padding = '20px 18px';
    empty.style.opacity = '1';
    empty.textContent = allItems.length
      ? 'No matches'
      : 'No headings or scene breaks yet — use # for chapters, ⌘⇧- for scenes';
    pList.appendChild(empty);
    return;
  }

  const sec = document.createElement('div');
  sec.className = 'p-section';
  sec.textContent = 'Outline';
  pList.appendChild(sec);

  filtered.forEach((item) => {
    const idx = flatItems.length;
    flatItems.push({ fn: () => jumpToOutlineItem(item) });

    const meta = outlineTypeMeta[item.type] || outlineTypeMeta.h3;
    const el = document.createElement('div');
    el.className = 'pitem' + (idx === 0 ? ' active' : '');
    el.dataset.idx = idx;
    el.id = 'pitem-' + idx;
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(idx === 0));

    const left = document.createElement('div');
    left.className = 'pitem-left';

    const icon = document.createElement('i');
    icon.className = `ti ${meta.icon} pitem-icon`;

    const label = document.createElement('span');
    label.className = 'pitem-label';
    label.textContent = item.text;
    if (meta.dim) label.style.opacity = '0.7';
    if (item.type === 'h2') label.style.paddingLeft = '10px';
    if (item.type === 'h3') label.style.paddingLeft = '20px';

    left.appendChild(icon);
    left.appendChild(label);

    const right = document.createElement('div');
    right.className = 'pitem-kbd';
    const lineNum = document.createElement('span');
    lineNum.style.cssText = 'font-size:11px;color:var(--text-dimmer);font-family:var(--font-mono);';
    lineNum.textContent = 'L' + item.line;
    right.appendChild(lineNum);

    el.appendChild(left);
    el.appendChild(right);

    el.addEventListener('mousedown', (ev) => ev.preventDefault());
    el.addEventListener('click', () => { jumpToOutlineItem(item); closePalette(); });
    el.addEventListener('mousemove', () => { activeIdx = idx; updateActive(); });
    pList.appendChild(el);
  });

  activeIdx = 0;
  updateActive();
}

function jumpToOutlineItem(item) {
  window.BaretextEditor.setCursorPos(view, item.pos);
  setTimeout(() => focusEditor(), 0);
}

function openOutline() {
  paletteMode = 'outline';
  pInput.placeholder = 'jump to chapter or scene...';
  overlay.classList.add('open');
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('visible')));
  pInput.value = '';
  render('');
  setTimeout(() => pInput.focus(), 10);
}

function updateActive() {
  [...pList.querySelectorAll('.pitem')].forEach(el => {
    const isActive = Number(el.dataset.idx) === activeIdx;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', String(isActive));
    if (isActive) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      pInput.setAttribute('aria-activedescendant', el.id);
    }
  });
}

function openPalette() {
  paletteMode = 'commands';
  pInput.placeholder = 'type a command...';
  if (paletteClosing) paletteClosing = false;
  overlay.classList.add('open');
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('visible')));
  pInput.value = '';
  render('');
  setTimeout(() => pInput.focus(), 10);
}

function closePalette(refocus = true) {
  overlay.classList.remove('visible');
  paletteClosing = true;
  setTimeout(() => {
    overlay.classList.remove('open');
    paletteClosing = false;
    paletteMode = 'commands';
    pInput.placeholder = 'type a command...';
  }, 200);
  if (refocus) setTimeout(() => focusEditor(), 0);
}

pInput.addEventListener('input', () => render(pInput.value));
pInput.addEventListener('keydown', (e) => {
  // Focus trap: the input is the only real tab stop inside the dialog
  // (options are virtually-selected via aria-activedescendant, not real
  // tab stops) -- keep Tab from escaping to the dimmed content behind it.
  if (e.key === 'Tab') { e.preventDefault(); return; }
  if (e.key === 'Escape') { closePalette(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, flatItems.length - 1); updateActive(); return; }
  if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); updateActive(); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    const it = flatItems[activeIdx];
    if (it) { it.fn(); if (!it.keepOpen) closePalette(); }
  }
});
overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePalette(); });

// Clicking anywhere in the editor area focuses the editor
host.addEventListener('mousedown', (e) => {
  if (e.target === host || e.target.classList.contains('cm-scroller')) {
    focusEditor();
  }
});

// ── Mode switching ──
const ctx = {
  get view() { return view; },
  editor: window.BaretextEditor,
  api: window.api,
  state,
  dom: { app, host, statusbar, statusLeft, overlay, fontPicker },
  showToast,
  getDoc, setDoc, focusEditor,
  openOutline,
  cmdSave, cmdOpen, cmdNew, cmdExport, cmdSaveDir,
  setTheme, setFont, toggleFontPicker,
  setTypewriter, toggleTypewriter, toggleFocus, toggleRenderedMode, insertSceneBreak,
  openThemePicker: () => themePicker.show(),
};

// Mode-agnostic (themes apply in both Sprinter and Editor), so this mounts
// once here rather than through the per-mode feature init/destroy cycle.
themePicker.mount(ctx);

let activeFeatures = [];
let currentKeybindings = {};

// Single choke point for every mode-switch entry point (⌘K palette, ⌘⇧D,
// and the status-bar tabs) so all three always agree and stay in sync.
function switchMode(modeId) {
  // Only actually switch if we're not already there — activateMode()
  // unconditionally destroys/reinits every feature, which would kill
  // an in-progress sprint if the user re-selects the mode they're
  // already in.
  if (state.mode !== modeId) activateMode(modeId);
  // Selecting Sprint means "I want to sprint" — open the duration/goal
  // picker (or bring the active panel forward), the same as ⌘⇧S, instead
  // of leaving an idle Sprinter view that needs a second action.
  if (modeId === 'sprinter' && currentKeybindings['Mod-Shift-S']) {
    currentKeybindings['Mod-Shift-S']();
  }
}

function modeGroup() {
  return {
    group: 'Mode',
    items: Object.values(MODES).map(m => ({
      label: 'Switch to ' + m.label,
      icon: m.id === 'sprinter' ? 'ti-run' : 'ti-layout-columns',
      keys: ['⌘','⇧','D'],
      checked: state.mode === m.id,
      fn: () => switchMode(m.id),
    })),
  };
}

// Keeps the status-bar tabs in sync with state.mode regardless of what
// triggered the change (the tabs themselves, ⌘⇧D, or the palette).
function updateModeSwitch() {
  modeTabs.forEach(tab => {
    const isActive = tab.dataset.mode === state.mode;
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });
}

modeTabs.forEach(tab => {
  tab.addEventListener('mousedown', (e) => e.preventDefault());
  tab.addEventListener('click', () => switchMode(tab.dataset.mode));
});
// Roving tabindex, manual activation: ←/→ only move which tab has focus
// (the whole group is one Tab stop); Enter/Space activates the focused one.
modeSwitch.addEventListener('keydown', (e) => {
  const idx = modeTabs.indexOf(document.activeElement);
  if (idx === -1) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const nextIdx = e.key === 'ArrowRight'
      ? (idx + 1) % modeTabs.length
      : (idx - 1 + modeTabs.length) % modeTabs.length;
    modeTabs.forEach((t, i) => { t.tabIndex = i === nextIdx ? 0 : -1; });
    modeTabs[nextIdx].focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    switchMode(modeTabs[idx].dataset.mode);
  }
});

function activateMode(modeId) {
  const modeDef = MODES[modeId] || MODES[DEFAULT_MODE];

  activeFeatures.forEach(f => { if (f.destroy) f.destroy(ctx); });

  activeFeatures = modeDef.features.map(id => FEATURES[id]).filter(Boolean);
  state.mode = modeDef.id;
  window.api.setMode(modeDef.id);
  document.documentElement.setAttribute('data-mode', modeDef.id);
  updateModeSwitch();

  activeFeatures.forEach(f => { if (f.init) f.init(ctx); });

  currentKeybindings = {
    'Mod-k': () => openPalette(),
    'Mod-Shift-D': () => activateMode(state.mode === 'sprinter' ? 'editor' : 'sprinter'),
  };
  activeFeatures.forEach(f => {
    if (f.keybindings) Object.assign(currentKeybindings, f.keybindings(ctx));
  });
  window.BaretextEditor.registerKeys(currentKeybindings);

  commands = activeFeatures.flatMap(f => f.commandGroups ? f.commandGroups(ctx) : []);
  commands.push(modeGroup());

  if (overlay.classList.contains('open')) render(pInput.value);
}
ctx.activateMode = activateMode;

// ── Global keyboard fallback — fires when CM doesn't have focus ──
function shortcutFor(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return null;
  const key = e.key;
  if (key === '.') return 'Mod-Period';
  if (key === 'Enter') return 'Mod-Enter';
  if (e.shiftKey && e.code === 'Minus') return 'Mod-Shift-Minus';
  if (key.length === 1) {
    return e.shiftKey ? `Mod-Shift-${key.toUpperCase()}` : `Mod-${key.toLowerCase()}`;
  }
  return null;
}
document.addEventListener('keydown', (e) => {
  if (overlay.classList.contains('open')) return;
  const shortcut = shortcutFor(e);
  if (!shortcut) return;
  const fn = currentKeybindings[shortcut];
  if (fn) { e.preventDefault(); fn(); }
});

// ── Save immediately before any reload/close so ⌘R never loses content ──
window.addEventListener('beforeunload', () => {
  const content = getDoc();
  if (content) window.api.saveNow(content);
});

// ── Init ──
setFont('mono');
activateMode(state.mode);
focusEditor();
updateCounts('');
