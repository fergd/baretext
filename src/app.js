import { MODES, DEFAULT_MODE } from './modes.js';
import core from './features/core.js';
import sprintTimer from './features/sprint-timer.js';
import findReplace from './features/find-replace.js';
import sceneNav from './features/scene-nav/index.js';
import * as themePicker from './theme-picker.js';
import { makeDeleteButton } from './features/scene-nav/ui-helpers.js';

const FEATURES = { core, 'sprint-timer': sprintTimer, 'find-replace': findReplace, 'scene-nav': sceneNav };

const app        = document.getElementById('app');
const host       = document.getElementById('editor-host');
const elWord     = document.getElementById('word-count');
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
const railExpandTab = document.getElementById('rail-expand-tab');
const aiSettingsOverlay = document.getElementById('ai-settings-overlay');
const aiKeyInput = document.getElementById('ai-key-input');
const aiKeyStatus = document.getElementById('ai-key-status');
const aiKeyRemove = document.getElementById('ai-key-remove');
const aiTitleStyle = document.getElementById('ai-title-style');
const backupSettingsOverlay = document.getElementById('backup-settings-overlay');
const backupClientId = document.getElementById('backup-client-id');
const backupClientSecret = document.getElementById('backup-client-secret');
const backupPickerKey = document.getElementById('backup-picker-key');
const backupKeyStatus = document.getElementById('backup-key-status');
const backupConnectBtn = document.getElementById('backup-connect-btn');
const backupSaveBtn = document.getElementById('backup-save-btn');
const backupNowBtn = document.getElementById('backup-now-btn');
const backupFolderName = document.getElementById('backup-folder-name');
const backupChooseFolderBtn = document.getElementById('backup-choose-folder-btn');
const backupUseDefaultBtn = document.getElementById('backup-use-default-btn');
const backupStatusIndicator = document.getElementById('backup-status-indicator');
// Built once here (not static markup) so it gets the shared two-click
// arm/confirm behavior from makeDeleteButton() — same helper rail.js and
// corkboard.js use for scene/chapter deletion, this app's only "destructive
// action" pattern (never a native confirm() dialog).
const backupDisconnectBtn = makeDeleteButton('backup-disconnect-btn ai-settings-btn danger', 'Google Drive connection', async () => {
  const result = await window.api.backupDisconnect();
  if (!result.ok) {
    backupKeyStatus.className = 'error';
    backupKeyStatus.textContent = result.error;
    return;
  }
  updateBackupUI(result.status);
  showToast('Google Drive disconnected');
});
document.getElementById('backup-disconnect-slot').replaceWith(backupDisconnectBtn);

const state = {
  theme: document.documentElement.getAttribute('data-theme'),
  font: 'mono',
  typewriter: false,
  focusMode: false,
  filePath: null,
  sourceMode: false,
  mode: document.documentElement.getAttribute('data-mode') || DEFAULT_MODE,
  railCollapsed: document.documentElement.getAttribute('data-rail-collapsed') === '1',
  wordCount: 0,
};
// Matches the `inert` toggle in setRailCollapsed() below, applied once
// up front for whatever state was restored synchronously at boot (see
// index.html's early script) -- without this, a launch that restores
// already-collapsed keeps the panel's own buttons reachable by Tab until
// the first actual toggle ever runs.
if (state.railCollapsed) document.getElementById('scene-rail').setAttribute('inert', '');

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
const cmContent = host.querySelector('.cm-content');
if (cmContent) cmContent.setAttribute('spellcheck', 'false');
host.dataset.editorView = 'pretty';

function getDoc()      { return window.BaretextEditor.getDoc(view); }
// window.BaretextEditor.setDoc() deliberately suppresses the editor's own
// onChange listener (see api.js) so a programmatic rewrite — scene-nav's
// drag reorder/delete/rename, all routed through this same ctx.setDoc — never
// fires it as if the user had typed the whole document at once. That also
// means updateCounts() never ran after any of those actions until this call
// was added here: the status bar word count would just go stale (frozen at
// its last real value) the moment you dragged a scene into or out of Cold
// Storage, silently defeating the "excluded from the word count" promise.
function setDoc(text, { persist = true, addToHistory = true } = {}) {
  window.BaretextEditor.setDoc(view, text, { addToHistory });
  updateCounts(text);
  // Structural scene-nav operations rebuild the document programmatically,
  // so CodeMirror's normal onChange callback is deliberately suppressed.
  // They are still real edits and must enter the same 500 ms autosave path
  // as typing. File loads opt out below: loading is neither an edit nor an
  // undo step, and recording the initial empty -> manuscript replacement in
  // history was the cause of the September 2026 whole-document disappearance.
  if (persist) window.api.contentChanged(text);
}
function focusEditor() { window.BaretextEditor.focus(view); }

// ── IPC from main ──
window.api.onThemeChanged(() => {});
window.api.onFileLoaded(({ content, filePath, cursorPos, typewriter }) => {
  if (content !== null && content !== undefined) setDoc(content, { persist: false, addToHistory: false });
  state.filePath = filePath;
  setFileName(filePath);
  updateCounts(getDoc());
  if (typeof typewriter === 'boolean') setTypewriter(typewriter, { silent: true });
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
// #save-error already existed (a status-bar dot, cleared above on every
// successful save) but nothing ever set it — a write failure just logged to
// the main process console, invisible unless DevTools was open, while the
// app kept behaving as if the save had gone through. Toast is throttled to
// the moment the indicator first lights up, not every failed attempt — a
// persistently unwritable disk would otherwise re-toast on every 500ms
// autosave debounce tick for as long as the user kept typing.
window.api.onSaveError((data) => {
  const alreadyShowing = elSaveErr.classList.contains('visible');
  elSaveErr.classList.add('visible');
  elSaveErr.title = 'save failed: ' + ((data && data.message) || 'unknown error');
  if (!alreadyShowing) {
    const message = data && data.blocked
      ? 'destructive save blocked — your manuscript is safe on disk'
      : 'save failed — your changes are not being saved';
    showToast(message, { icon: 'ti-alert-triangle', tone: 'error' });
  }
});

async function refreshAiSettingsStatus() {
  const [status, preferences] = await Promise.all([window.api.aiStatus(), window.api.aiTitlePreferences()]);
  aiTitleStyle.value = preferences.styleExamples || '';
  aiKeyStatus.className = status.configured ? 'ready' : '';
  aiKeyStatus.textContent = status.configured ? `ready · ${status.model}` : 'no key saved';
  aiKeyRemove.hidden = !status.credentialStored;
  return status;
}

async function openAiSettings() {
  aiKeyInput.value = '';
  aiKeyStatus.className = '';
  aiSettingsOverlay.classList.add('open');
  await refreshAiSettingsStatus();
  aiKeyInput.focus();
}

function closeAiSettings() {
  aiKeyInput.value = '';
  aiSettingsOverlay.classList.remove('open');
  focusEditor();
}

document.getElementById('ai-key-save').addEventListener('click', async () => {
  const apiKey = aiKeyInput.value.trim();
  const preferenceResult = await window.api.aiSaveTitlePreferences({ styleExamples: aiTitleStyle.value });
  const result = apiKey ? await window.api.aiSaveKey(apiKey) : { ok: true, status: await window.api.aiStatus() };
  aiKeyInput.value = '';
  if (!result.ok || !preferenceResult.ok) {
    aiKeyStatus.className = 'error';
    aiKeyStatus.textContent = result.error || preferenceResult.error;
    return;
  }
  aiKeyStatus.className = 'ready';
  aiKeyStatus.textContent = result.status.configured ? `saved · ${result.status.model}` : 'title style saved · no API key';
  aiKeyRemove.hidden = !result.status.credentialStored;
  showToast('AI settings saved');
});
document.getElementById('ai-key-cancel').addEventListener('click', closeAiSettings);
aiKeyRemove.addEventListener('click', async () => {
  const result = await window.api.aiRemoveKey();
  if (!result.ok) {
    aiKeyStatus.className = 'error';
    aiKeyStatus.textContent = result.error;
    return;
  }
  await refreshAiSettingsStatus();
  showToast('AI key removed');
});
aiKeyInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeAiSettings();
  if (event.key === 'Enter') document.getElementById('ai-key-save').click();
});
aiSettingsOverlay.addEventListener('mousedown', (event) => {
  if (event.target === aiSettingsOverlay) closeAiSettings();
});
window.api.onOpenAiSettings(openAiSettings);

function relativeTime(iso) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Paints every backup UI surface (settings panel + status-bar indicator)
// from a status object — kept separate from refreshBackupStatus() below so
// the periodic background poll can repaint without ever touching the
// credential input fields (those are only ever cleared when the panel opens
// or closes, never mid-poll, or a poll landing while the user is mid-paste
// would wipe unsaved input).
function updateBackupUI(status) {
  backupKeyStatus.className = status.lastError ? 'error' : (status.connected ? 'ready' : '');
  backupKeyStatus.textContent = status.lastError
    ? status.lastError
    : status.connected
      ? `connected as ${status.accountEmail}` + (status.lastBackupAt ? ` · last backup ${relativeTime(status.lastBackupAt)}` : '')
      : (status.hasClientCredentials ? 'not connected' : 'no client credentials saved');
  backupConnectBtn.hidden = status.connected;
  backupNowBtn.hidden = !status.connected;
  backupDisconnectBtn.hidden = !status.connected;
  backupStatusIndicator.className = status.lastError ? 'error' : (status.connected ? 'connected' : '');
  backupStatusIndicator.title = status.connected
    ? `Google Drive backup: ${status.accountEmail}` + (status.lastBackupAt ? ` · last backup ${relativeTime(status.lastBackupAt)}` : '')
    : 'Google Drive backup — not connected';

  document.getElementById('backup-folder-row').hidden = !status.connected;
  backupFolderName.textContent = status.destinationFolder
    ? `folder: ${status.destinationFolder.name}`
    : 'folder: Baretext Backups (default)';
  backupChooseFolderBtn.hidden = !status.hasPickerApiKey;
  backupUseDefaultBtn.hidden = !status.destinationFolder;
}

async function refreshBackupStatus() {
  const status = await window.api.backupStatus();
  updateBackupUI(status);
  return status;
}

async function openBackupSettings() {
  backupClientId.value = '';
  backupClientSecret.value = '';
  backupPickerKey.value = '';
  backupKeyStatus.className = '';
  backupSettingsOverlay.classList.add('open');
  await refreshBackupStatus();
  backupClientId.focus();
}

function closeBackupSettings() {
  backupClientId.value = '';
  backupClientSecret.value = '';
  backupPickerKey.value = '';
  backupSettingsOverlay.classList.remove('open');
  focusEditor();
}

// Saves whichever of Client ID/Secret and Picker API key are non-blank —
// no network call, safe to run without also starting the browser sign-in
// flow. Separate from the Connect button below so credentials can be saved
// now and connected later, and so a later "just add the picker key" visit
// doesn't require re-pasting the OAuth fields (never re-shown once saved).
async function saveTypedCredentials() {
  const clientId = backupClientId.value.trim();
  const clientSecret = backupClientSecret.value.trim();
  const pickerKey = backupPickerKey.value.trim();
  let status = null;

  if (clientId || clientSecret) {
    const result = await window.api.backupSaveClientCredentials({ clientId, clientSecret });
    if (!result.ok) return { ok: false, error: result.error };
    status = result.status;
  }
  if (pickerKey) {
    const result = await window.api.backupSavePickerKey({ apiKey: pickerKey });
    if (!result.ok) return { ok: false, error: result.error };
    status = result.status;
  }
  backupClientId.value = '';
  backupClientSecret.value = '';
  backupPickerKey.value = '';
  return { ok: true, status };
}

backupSaveBtn.addEventListener('click', async () => {
  const result = await saveTypedCredentials();
  if (!result.ok) {
    backupKeyStatus.className = 'error';
    backupKeyStatus.textContent = result.error;
    return;
  }
  if (!result.status) {
    backupKeyStatus.className = 'error';
    backupKeyStatus.textContent = 'Enter a Client ID + Secret and/or a Picker API key to save';
    return;
  }
  updateBackupUI(result.status);
  showToast('Google Drive credentials saved');
});
backupConnectBtn.addEventListener('click', async () => {
  const saveResult = await saveTypedCredentials();
  if (!saveResult.ok) {
    backupKeyStatus.className = 'error';
    backupKeyStatus.textContent = saveResult.error;
    return;
  }
  backupKeyStatus.className = '';
  backupKeyStatus.textContent = 'opening Google sign-in…';
  const result = await window.api.backupConnect();
  if (!result.ok) {
    backupKeyStatus.className = 'error';
    backupKeyStatus.textContent = result.error;
    return;
  }
  updateBackupUI(result.status);
  showToast('Google Drive connected');
});
backupChooseFolderBtn.addEventListener('click', async () => {
  backupChooseFolderBtn.disabled = true;
  backupKeyStatus.className = '';
  backupKeyStatus.textContent = 'opening the folder picker…';
  try {
    const result = await window.api.backupChooseFolder();
    if (result.status) updateBackupUI(result.status);
    if (result.ok) {
      backupKeyStatus.className = '';
      backupKeyStatus.textContent = '';
      showToast(`backup folder set to "${result.folder.name}"`);
    } else if (!result.canceled) {
      backupKeyStatus.className = 'error';
      backupKeyStatus.textContent = result.error;
    } else {
      backupKeyStatus.className = '';
      backupKeyStatus.textContent = '';
    }
  } finally {
    backupChooseFolderBtn.disabled = false;
  }
});
backupUseDefaultBtn.addEventListener('click', async () => {
  const result = await window.api.backupClearFolder();
  updateBackupUI(result.status);
  showToast('backup folder reset to default');
});
backupNowBtn.addEventListener('click', async () => {
  backupKeyStatus.className = '';
  backupKeyStatus.textContent = 'backing up…';
  const result = await window.api.backupNow();
  updateBackupUI(result.status);
  if (result.ok) showToast('backup complete');
  else if (!result.skipped) showToast('backup failed', { icon: 'ti-alert-triangle', tone: 'error' });
});
document.getElementById('backup-settings-cancel').addEventListener('click', closeBackupSettings);
[backupClientId, backupClientSecret].forEach((input) => {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeBackupSettings();
    if (event.key === 'Enter' && !backupConnectBtn.hidden) backupConnectBtn.click();
  });
});
backupPickerKey.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeBackupSettings();
  if (event.key === 'Enter') backupSaveBtn.click();
});
backupSettingsOverlay.addEventListener('mousedown', (event) => {
  if (event.target === backupSettingsOverlay) closeBackupSettings();
});
backupStatusIndicator.addEventListener('click', openBackupSettings);
window.api.onOpenBackupSettings(openBackupSettings);
refreshBackupStatus();
// Backups happen on their own timer in the main process (autosave-driven,
// not user-driven), so the status-bar indicator polls rather than waiting
// for a push — cheap, since status() is just an in-memory read.
setInterval(refreshBackupStatus, 60000);

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

// Typewriter mode recenters when text is actually edited (the create()
// onChange callback above), when the mode is enabled, and on explicit
// navigation commands. Ordinary caret movement, selection, wheel input,
// and scrollbar dragging remain browser-controlled. Treating keyup or
// mouseup as a recenter request made innocent navigation gestures capable
// of launching the manuscript back to a distant caret/scene.

// ── Status ──
// Cold Storage (see scene-nav/model.js) is cut material parked outside the
// manuscript on purpose — it lives in the same file (reorder.js always
// serializes it last, after this marker) but shouldn't inflate the word
// count the way real manuscript prose does.
const COLD_STORAGE_MARKER = '<!-- COLD STORAGE -->';
function stripColdStorage(text) {
  const idx = text.indexOf(COLD_STORAGE_MARKER);
  return idx === -1 ? text : text.slice(0, idx);
}
function stripBookTitle(text) {
  return String(text || '').replace(/^<!--\s*BOOK TITLE:\s*.*?\s*-->\s*/, '');
}
function updateCounts(doc) {
  const t = stripBookTitle(stripColdStorage(doc || ''));
  const w = t.trim() === '' ? 0 : t.trim().split(/\s+/).length;
  state.wordCount = w;
  elWord.textContent = w + (w === 1 ? ' word' : ' words');
}
function setFileName(fp) { elFile.textContent = fp ? fp.split('/').pop() : 'untitled'; }
elFile.addEventListener('mousedown', (e) => e.preventDefault());
elFile.addEventListener('click', () => { if (state.filePath) window.api.showInFinder(state.filePath); });

// ── Toast ──
let toastTimer = null;
function showToast(msg, opts) {
  const icon = opts && opts.icon;
  // 'error' matches the delete-button/save-error red (#e05c5c) already used
  // elsewhere for danger states, instead of the default accent color.
  const iconColor = opts && opts.tone === 'error' ? '#e05c5c' : 'var(--accent)';
  toastEl.innerHTML = '';
  if (icon) {
    const i = document.createElement('i');
    i.className = `ti ${icon}`;
    i.style.cssText = `font-size:13px;color:${iconColor};margin-right:8px;`;
    toastEl.appendChild(i);
  }
  toastEl.appendChild(document.createTextNode(msg));
  if (opts && opts.actionLabel && typeof opts.onAction === 'function') {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = opts.actionLabel;
    action.addEventListener('click', () => {
      clearTimeout(toastTimer);
      toastEl.classList.remove('show');
      opts.onAction();
    });
    toastEl.appendChild(action);
  }
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), opts && opts.actionLabel ? 6000 : 1600);
}

// ── File commands (shared primitives — used by core.js's command manifest) ──
function cmdSave() { window.api.saveNow(getDoc()); }

async function cmdOpen() {
  closePalette(false);
  const r = await window.api.openFile();
  if (r) {
    setDoc(r.content, { persist: false, addToHistory: false });
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
    setDoc('', { persist: false, addToHistory: false });
    state.filePath = r.filePath;
    setFileName(r.filePath);
    updateCounts('');
  }
  focusEditor();
}

async function cmdExport() {
  closePalette(false);
  const r = await window.api.exportFile(getDoc());
  if (r === null) {
    // user canceled the save dialog — not an error, nothing to report
  } else if (r.ok) {
    showToast('exported');
  } else {
    showToast('export failed: ' + r.error, { icon: 'ti-alert-triangle', tone: 'error' });
  }
  focusEditor();
}

async function cmdPrint() {
  closePalette(false);
  const r = await window.api.printDocument();
  if (r && !r.ok && !r.canceled) {
    showToast('print failed: ' + r.error, { icon: 'ti-alert-triangle', tone: 'error' });
  }
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
  amstrad: '#c8e6b0', grove: '#d3c6aa', dracula: '#f8f8f2', crt: '#c8e6b0',
};
const themeAccentColors = {
  dark: '#f8c537', light: '#b8820a',
  amstrad: '#7dc45a', grove: '#a7c080', dracula: '#bd93f9', crt: '#7dc45a',
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
// mono deliberately references --font-mono itself (not a second copy of the
// stack) so the editor's "mono" prose option always matches whatever the
// app's actual chrome typeface is, rather than drifting out of sync with it.
const fontVars = {
  mono:  'var(--font-mono)',
  serif: "'IBM Plex Serif', 'Georgia', serif",
  sans:  "'IBM Plex Sans', -apple-system, sans-serif",
};
function setFont(f) {
  state.font = f;
  document.documentElement.style.setProperty('--font-editor', fontVars[f]);
  // Drives index.html's html[data-font="mono"] rule, which drops heading
  // weight to regular for mono specifically (see that rule's own comment) —
  // matches the data-theme/data-mode attribute convention already used for
  // CSS overrides keyed off app state.
  document.documentElement.setAttribute('data-font', f);
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
  host.dataset.editorView = state.sourceMode ? 'markdown' : 'pretty';
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
  showToast(state.sourceMode ? 'markdown view' : 'pretty view');
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
function setRailCollapsed(collapsed) {
  state.railCollapsed = collapsed;
  document.documentElement.setAttribute('data-rail-collapsed', collapsed ? '1' : '0');
  // The CSS collapse (width/opacity, see index.html) leaves the panel's own
  // buttons/rows with real (zero-size) layout boxes, not display:none --
  // needed so the width actually transitions -- which means they'd
  // otherwise still sit in the keyboard Tab order and be clickable at their
  // old on-screen position mid-transition. inert removes the whole
  // collapsed subtree from focus and hit-testing regardless.
  document.getElementById('scene-rail').toggleAttribute('inert', collapsed);
  window.api.setRailCollapsed(collapsed);
}
function toggleRailCollapsed() { setRailCollapsed(!state.railCollapsed); }
railExpandTab.addEventListener('mousedown', (e) => e.preventDefault());
railExpandTab.addEventListener('click', () => { setRailCollapsed(false); focusEditor(); });
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
  amstrad: '#0c110c', grove: '#282f34', dracula: '#1e2030', crt: '#0c110c',
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
  cmdSave, cmdOpen, cmdNew, cmdExport, cmdPrint, cmdSaveDir,
  setTheme, setFont, toggleFontPicker,
  setTypewriter, toggleTypewriter, toggleFocus, toggleRenderedMode, insertSceneBreak,
  setRailCollapsed, toggleRailCollapsed,
  openThemePicker: () => themePicker.show(),
  openAiSettings,
  openBackupSettings,
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
  window.BaretextEditor.setEditorMode(view, modeDef.id === 'editor');
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
  window.api.saveNow(content);
});

// ── Init ──
setFont('mono');
activateMode(state.mode);
focusEditor();
updateCounts('');
