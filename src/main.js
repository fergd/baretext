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

// Accent theme (command palette: dark / light / ayu / dracula) — validated
// against the current theme set so a stale saved value (e.g. a removed
// theme) can't leave the app stuck on an unknown data-theme.
const VALID_ACCENT_THEMES = ['dark', 'light', 'ayu', 'dracula'];
const accentTheme = VALID_ACCENT_THEMES.includes(settings.accentTheme) ? settings.accentTheme : 'dark';

// Mode (Sprinter / Editor) — same validate-then-persist pattern as accent theme.
const VALID_MODES = ['sprinter', 'editor'];
const mode = VALID_MODES.includes(settings.mode) ? settings.mode : 'sprinter';

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
    backgroundColor: '#1a1a1a',
    icon: path.join(__dirname, process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
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
  mainWindow.loadFile(path.join(__dirname, 'index.html'), { query: { theme: accentTheme, mode } });
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

// Manual save
ipcMain.on('save-now', (event, content) => {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveToFile(content);
  event.reply('save-confirmed');
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

// Export / Save As
ipcMain.handle('export-file', async (event, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(defaultDir, 'export.md'),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (!result.canceled) {
    fs.writeFileSync(result.filePath, content, 'utf8');
    return result.filePath;
  }
  return null;
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

// Spellcheck ignore list (names, jargon, ...) — global, not per-file, so it
// persists across whatever document is open next.
ipcMain.on('ignored-words-changed', (event, words) => {
  settings.ignoredWords = Array.isArray(words) ? words : [];
  saveSettings(settings);
});

function saveToFile(content) {
  if (!currentFilePath) currentFilePath = getDefaultFilePath();
  try {
    fs.writeFileSync(currentFilePath, content, 'utf8');
    // Remember this file so next launch reopens it
    settings.lastFilePath = currentFilePath;
    saveSettings(settings);
    backup.onSave(defaultDir, currentFilePath);
    mainWindow.webContents.send('auto-saved', currentFilePath);
  } catch (e) {
    console.error('Save failed:', e);
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
