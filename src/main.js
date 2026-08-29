const { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const backup = require('./backup');

// Set the app name BEFORE anything else — this controls the menu bar label
// (next to the Apple logo) and the name shown in Activity Monitor / Force Quit.
// In dev mode (electron .) this overrides the default "Electron" label.
app.setName('Baretext');

let mainWindow;
let currentFilePath = null;
let saveTimeout = null;

// Default save location: ~/Documents/Barebones/
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch(e) {}
  return {};
}

function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf8');
}

let settings = loadSettings();
let defaultDir = settings.saveDir || path.join(os.homedir(), 'Documents', 'Barebones');
if (!fs.existsSync(defaultDir)) {
  fs.mkdirSync(defaultDir, { recursive: true });
}
backup.init(defaultDir);

// Mirrors each theme's --bg token (src/index.html) — used as the native
// BrowserWindow backgroundColor, not just a pre-paint flash guard. On
// macOS, entering fullscreen with titleBarStyle: 'hiddenInset' leaves a
// thin strip at the very top of the screen (reserved for the auto-hide
// menu bar) that's outside the web content entirely; that strip renders as
// this raw backgroundColor. A single hardcoded value could never match
// whichever theme is actually active, so it's kept in sync with the
// current accent theme instead (set here at launch, updated at runtime in
// the 'accent-theme-changed' handler below).
//
// This is main.js's own CommonJS module graph, separate from the renderer's
// ESM one (src/themes.js, imported by theme-picker.js/core.js) — it can't
// import that file directly, so the theme *id* list is necessarily
// duplicated across the process boundary. What's NOT duplicated anymore:
// the id list here used to be its own separate array (VALID_ACCENT_THEMES)
// independently listing the same 5 ids — now derived from this object's
// keys instead of kept in sync by hand.
const THEME_BG = {
  dark: '#242424',
  light: '#f5f0e8',
  amstrad: '#0d130d',
  grove: '#2f383e',
  dracula: '#282a36',
};

// Accent theme (command palette: dark / light / amstrad / grove / dracula) —
// validated against the current theme set so a stale saved value (e.g. a
// removed theme) can't leave the app stuck on an unknown data-theme.
const VALID_ACCENT_THEMES = Object.keys(THEME_BG);
const accentTheme = VALID_ACCENT_THEMES.includes(settings.accentTheme) ? settings.accentTheme : 'dark';

// Mode (Sprinter / Editor) — same validate-then-persist pattern as accent theme.
const VALID_MODES = ['sprinter', 'editor'];
const mode = VALID_MODES.includes(settings.mode) ? settings.mode : 'sprinter';

// Rail collapsed (Editor mode) — persisted the same way.
const railCollapsed = !!settings.railCollapsed;

function getDefaultFilePath() {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return path.join(defaultDir, `${stamp}.md`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 500,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    backgroundColor: THEME_BG[accentTheme],
    icon: path.join(__dirname, process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
    // CDP-driven E2E/scratch-verification launches (test/e2e/harness.js) set
    // this so the window never shows or steals focus — DevTools Protocol
    // drives the renderer directly and doesn't need the native window
    // visible. Normal `npm start` / packaged-app launches are unaffected.
    show: process.env.BARETEXT_HIDDEN !== '1',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Pass the saved accent theme via query string so index.html can apply
  // it synchronously on first paint — no flash of the default theme while
  // waiting on an IPC round-trip.
  mainWindow.loadFile(path.join(__dirname, 'index.html'), { query: { theme: accentTheme, mode, railCollapsed: railCollapsed ? '1' : '0' } });
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  session.defaultSession.setSpellCheckerEnabled(true);
  session.defaultSession.setSpellCheckerLanguages(['en-US']);

  // In dev mode (electron .) the Dock icon defaults to Electron's icon.
  // app.dock.setIcon() overrides it at runtime — only needed pre-packaging;
  // a proper `npm run build` bakes the icon into the .app bundle permanently.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, 'icon.png'));
  }

  createWindow();

  // Send initial theme
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

    // Restore last opened file, falling back to today's date file
    const lastPath = settings.lastFilePath;
    const defaultPath = getDefaultFilePath();

    let filePath = null;
    let content = '';

    if (lastPath && fs.existsSync(lastPath)) {
      // Last session's file still exists — open it
      filePath = lastPath;
      content = fs.readFileSync(lastPath, 'utf8');
    } else if (fs.existsSync(defaultPath)) {
      // No last file, but today's date file exists
      filePath = defaultPath;
      content = fs.readFileSync(defaultPath, 'utf8');
    } else {
      // Fresh start — create today's date file
      filePath = defaultPath;
      content = '';
    }

    currentFilePath = filePath;
    // Restore cursor position too — only meaningful if it's the SAME file as last session
    const cursorPos = (lastPath && filePath === lastPath) ? (settings.lastCursorPos || null) : null;
    mainWindow.webContents.send('file-loaded', {
      content, filePath, cursorPos, typewriter: !!settings.typewriter,
      ignoredWords: Array.isArray(settings.ignoredWords) ? settings.ignoredWords : [],
    });
  });

  nativeTheme.on('updated', () => {
    mainWindow.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Flush a final backup commit before actually quitting, so the last few
// minutes of a session (inside the normal commit interval) aren't lost.
// Bounded by a timeout so a stuck git process can never hang app quit.
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  let finished = false;
  const finish = () => { if (finished) return; finished = true; app.quit(); };
  backup.flush(defaultDir, currentFilePath, finish);
  setTimeout(finish, 2500);
});

// Auto-save: debounced 500ms after last keystroke
ipcMain.on('content-changed', (event, content) => {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveToFile(content);
  }, 500);
});

// Cursor position — saved alongside content, lightweight enough to not debounce separately
ipcMain.on('cursor-changed', (event, pos) => {
  settings.lastCursorPos = pos;
  saveSettings(settings);
});

// Manual save. Only replies save-confirmed on an actual successful write —
// this used to fire unconditionally right after calling saveToFile(), so a
// failed Cmd+S (disk full, permissions, path gone) told the renderer the
// save had succeeded (clearing any error indicator and showing "saved")
// even though nothing was written. saveToFile() itself sends 'save-error'
// on failure, so the false-success reply here was the only thing standing
// between a write failure and the user believing their work was safe.
ipcMain.on('save-now', (event, content) => {
  if (saveTimeout) clearTimeout(saveTimeout);
  if (saveToFile(content)) event.reply('save-confirmed');
});

// Open file
ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: defaultDir,
    filters: [{ name: 'Markdown', extensions: ['md', 'txt'] }],
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf8');
    currentFilePath = filePath;
    settings.lastFilePath = filePath;
    saveSettings(settings);
    return { content, filePath };
  }
  return null;
});

// Export / Save As. Result is discriminated ({ok:true,filePath} / {ok:false,
// error} / null-for-canceled) rather than a bare filePath|null — the write
// here had no try/catch at all before, so a failure would have thrown out
// of the handler into an unhandled rejection on the renderer's invoke()
// promise: no crash, but also no feedback, same silent-failure shape as
// saveToFile above.
ipcMain.handle('export-file', async (event, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(defaultDir, 'export.md'),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (result.canceled) return null;
  try {
    fs.writeFileSync(result.filePath, content, 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    console.error('Export failed:', e);
    return { ok: false, error: e.message };
  }
});

// New file
ipcMain.handle('new-file', async () => {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${Date.now()}`;
  const newPath = path.join(defaultDir, `${stamp}.md`);
  currentFilePath = newPath;
  settings.lastFilePath = newPath;
  saveSettings(settings);
  return { content: '', filePath: newPath };
});

// Toggle system theme override
ipcMain.on('set-theme', (event, theme) => {
  nativeTheme.themeSource = theme; // 'dark' | 'light' | 'system'
});

// Accent theme — persisted so the app reopens in the same theme
ipcMain.on('accent-theme-changed', (event, theme) => {
  if (!VALID_ACCENT_THEMES.includes(theme)) return;
  settings.accentTheme = theme;
  saveSettings(settings);
  // Keep the native window backgroundColor matched to the new theme (see
  // THEME_BG above) — otherwise the fullscreen menu-bar-strip gap would
  // switch back to showing the theme active at launch, not the current one.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(THEME_BG[theme]);
});

// Mode — persisted so the app reopens in the same mode (Sprinter/Editor)
ipcMain.on('mode-changed', (event, newMode) => {
  if (!VALID_MODES.includes(newMode)) return;
  settings.mode = newMode;
  saveSettings(settings);
});

// Typewriter mode — persisted so the app reopens with it in the same state
ipcMain.on('typewriter-changed', (event, on) => {
  settings.typewriter = !!on;
  saveSettings(settings);
});

// Rail collapsed (Editor mode) — persisted so the app reopens with it in the same state
ipcMain.on('rail-collapsed-changed', (event, on) => {
  settings.railCollapsed = !!on;
  saveSettings(settings);
});

// Spellcheck ignore list (names, jargon, ...) — global, not per-file, so it
// persists across whatever document is open next.
ipcMain.on('ignored-words-changed', (event, words) => {
  settings.ignoredWords = Array.isArray(words) ? words : [];
  saveSettings(settings);
});

// Returns true/false so callers (manual save above) know whether the write
// actually happened, not just whether it was attempted.
function saveToFile(content) {
  if (!currentFilePath) currentFilePath = getDefaultFilePath();
  try {
    fs.writeFileSync(currentFilePath, content, 'utf8');
    // Remember this file so next launch reopens it
    settings.lastFilePath = currentFilePath;
    saveSettings(settings);
    backup.onSave(defaultDir, currentFilePath);
    mainWindow.webContents.send('auto-saved', currentFilePath);
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    // Previously this was the only thing that happened on a write failure —
    // console.error is invisible unless DevTools is open, so the app kept
    // behaving as if everything were fine while silently failing to persist
    // the user's work. #save-error already existed in index.html/app.js
    // (a status-bar indicator, cleared on every successful save) but nothing
    // ever set it — this is the missing other half.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('save-error', { message: e.message, filePath: currentFilePath });
    }
    return false;
  }
}

ipcMain.handle('choose-save-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: defaultDir,
    message: 'Choose where Baretext saves your files'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    defaultDir = result.filePaths[0];
    settings.saveDir = defaultDir;
    saveSettings(settings);
    backup.init(defaultDir);

    // Repoint the current file into the new directory using its existing filename
    const fileName = currentFilePath ? path.basename(currentFilePath) : path.basename(getDefaultFilePath());
    currentFilePath = path.join(defaultDir, fileName);

    // Tell the renderer the new path so the status bar + future saves match
    mainWindow.webContents.send('file-loaded', {
      content: null,        // null = keep current editor content, just update the path
      filePath: currentFilePath
    });

    return defaultDir;
  }
  return null;
});
