const { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu, session, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const backup = require('./backup');
const ai = require('./ai');
const googleDrive = require('./google-drive');
const { createCredentialStore } = require('./credential-store');

// Set the app name BEFORE anything else — this controls the menu bar label
// (next to the Apple logo) and the name shown in Activity Monitor / Force Quit.
// In dev mode (electron .) this overrides the default "Electron" label.
app.setName('Baretext');

// Chromium's accelerated compositor can lose the BrowserWindow backing
// surface on macOS while a wheel/trackpad gesture is in flight. When that
// happens the whole window flashes black and then repaints in scattered
// tiles (including the status bar, so this is not CodeMirror viewport
// virtualization). Software compositing avoids that driver-level failure.
// Electron requires this call before the app becomes ready.
app.disableHardwareAcceleration();

let mainWindow;
let currentFilePath = null;
let saveTimeout = null;
let credentialStore = null;

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
  crt: '#0d130d',
};

// Accent theme (command palette: dark / light / amstrad / grove / dracula / crt) —
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

function printDocument(win) {
  if (!win || win.isDestroyed()) return Promise.resolve({ ok: false, error: 'window unavailable' });
  return new Promise((resolve) => {
    win.webContents.print({ printBackground: false }, (success, failureReason) => {
      if (success) resolve({ ok: true });
      else if (/cancel/i.test(failureReason || '')) resolve({ ok: false, canceled: true });
      else resolve({ ok: false, error: failureReason || 'printing failed' });
    });
  });
}

function installApplicationMenu() {
  const template = [];

  if (process.platform === 'darwin') {
    template.push({
      label: 'Baretext',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'AI Settings…', click: () => mainWindow && mainWindow.webContents.send('open-ai-settings') },
        { label: 'Backup Settings…', click: () => mainWindow && mainWindow.webContents.send('open-backup-settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push(
    {
      label: 'File',
      submenu: [
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            printDocument(BrowserWindow.getFocusedWindow() || mainWindow).then((result) => {
              if (!result.ok && !result.canceled) console.error('Print failed:', result.error);
            });
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [] },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
    spellcheck: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Pass the saved accent theme via query string so index.html can apply
  // it synchronously on first paint — no flash of the default theme while
  // waiting on an IPC round-trip.
  mainWindow.loadFile(path.join(__dirname, 'index.html'), { query: { theme: accentTheme, mode, railCollapsed: railCollapsed ? '1' : '0' } });
  installApplicationMenu();
}

// Google's Picker is a hosted web widget, not something a native Electron
// dialog can show — this opens it in a small modal window loading
// src/google-drive-picker.html, and resolves once that window reports a
// folder was picked, was cancelled, or was just closed without a choice.
// event.sender identity guards against cross-talk if this is ever somehow
// called again before a previous picker window finished (each invocation's
// listeners only react to its own window).
function openDrivePickerWindow({ accessToken, apiKey }) {
  return new Promise((resolve) => {
    // Google's Picker backend rejects a file:// embedding origin outright
    // (visible as a 403 fetching docs.google.com/pick..., independent of
    // token/API-key validity — file:// isn't a real web origin Google's
    // postMessage/frame-ancestors security model can validate against). A
    // tiny local HTTP server gives it a real http://127.0.0.1 origin
    // instead, the same fix the OAuth loopback flow already relies on for
    // an analogous reason. Serves the one static file and nothing else.
    const pickerHtml = fs.readFileSync(path.join(__dirname, 'google-drive-picker.html'));
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pickerHtml);
    });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('picker-folder-chosen', onChosen);
      ipcMain.removeListener('picker-cancelled', onCancelled);
      if (!win.isDestroyed()) win.close();
      resolve(result);
    };
    function onChosen(event, folder) {
      if (event.sender !== win.webContents) return;
      finish({ ok: true, folder });
    }
    function onCancelled(event) {
      if (event.sender !== win.webContents) return;
      finish({ ok: false, canceled: true });
    }

    const win = new BrowserWindow({
      width: 640,
      height: 540,
      parent: mainWindow,
      modal: true,
      show: process.env.BARETEXT_HIDDEN !== '1',
      title: 'Choose a backup folder',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'google-drive-picker-preload.js'),
      },
    });
    win.setMenuBarVisibility(false);
    // Google refuses to render any sign-in-adjacent UI inside a webview
    // whose user agent identifies it as an embedded app shell (Electron's
    // default UA includes "Electron/x.x.x") — surfaces as a 403 right after
    // the user enters their password. The Picker widget can hit this even
    // with a valid OAuth token already supplied, apparently as an internal
    // session-verification step. Presenting a plain desktop Chrome UA (same
    // Chromium version Electron ships, just without the Electron marker)
    // is the standard, widely-used workaround. Only this dedicated picker
    // window's UA changes — the main window and its own actual OAuth
    // consent (handled entirely in the system browser, never embedded)
    // are unaffected.
    win.webContents.setUserAgent(
      `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
    );
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('picker-init', { accessToken, apiKey });
    });
    win.on('closed', () => { server.close(); finish({ ok: false, canceled: true }); });

    ipcMain.on('picker-folder-chosen', onChosen);
    ipcMain.on('picker-cancelled', onCancelled);

    server.listen(0, '127.0.0.1', () => {
      win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    });
  });
}

app.whenReady().then(() => {
  credentialStore = createCredentialStore({
    safeStorage,
    filePath: path.join(app.getPath('userData'), 'openai-key.encrypted'),
  });
  const storedKey = credentialStore.get();
  ai.init({
    filePath: path.join(app.getPath('userData'), 'ai-cache.json'),
    apiKey: storedKey || process.env.OPENAI_API_KEY,
  });
  googleDrive.init({
    credentialFilePath: path.join(app.getPath('userData'), 'google-drive.encrypted'),
    syncFilePath: path.join(app.getPath('userData'), 'google-drive-sync.json'),
    safeStorage,
    shell,
  });

  session.defaultSession.setSpellCheckerEnabled(false);

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
// Bounded by a timeout so a stuck git process — or, since the Google Drive
// provider joined, a slow network request — can never hang app quit.
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  let finished = false;
  const finish = () => { if (finished) return; finished = true; app.quit(); };
  backup.flush(defaultDir, currentFilePath, finish);
  setTimeout(finish, 5000);
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

// Print the writing surface through macOS's native print dialog. Print-only
// CSS in index.html strips the app chrome and expands CodeMirror's scroller
// so the whole manuscript (not just the visible viewport) is laid out.
ipcMain.handle('print-document', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return printDocument(win);
});

// AI stays in the main process: credentials and provider-specific request
// details never cross into the renderer. Each handler returns a stable,
// task-shaped result so a future hosted provider can replace OpenAI without
// changing the corkboard.
function aiStatus() {
  return { ...ai.status(), credentialStored: !!(credentialStore && credentialStore.get()) };
}

ipcMain.handle('ai-status', () => aiStatus());
ipcMain.handle('ai-title-preferences', () => ({ styleExamples: String(settings.aiTitleStyleExamples || '') }));
ipcMain.handle('ai-save-title-preferences', (event, payload) => {
  settings.aiTitleStyleExamples = String(payload && payload.styleExamples || '').trim().slice(0, 2000);
  saveSettings(settings);
  return { ok: true };
});
ipcMain.handle('ai-save-key', (event, apiKey) => {
  try {
    credentialStore.set(apiKey);
    ai.configure({ apiKey: credentialStore.get() });
    return { ok: true, status: aiStatus() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('ai-remove-key', () => {
  try {
    credentialStore.remove();
    ai.configure({ apiKey: process.env.OPENAI_API_KEY || null });
    return { ok: true, status: aiStatus() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('ai-cached-summaries', (event, scenes) => ai.getCachedSummaries(scenes));
ipcMain.handle('ai-remove-cached-summaries', (event, scenes) => {
  ai.removeCachedSummaries(scenes);
  return { ok: true };
});
ipcMain.handle('ai-summarize-scenes', async (event, scenes) => {
  try { return { ok: true, ...(await ai.summarizeScenes(scenes)) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('ai-suggest-titles', async (event, payload) => {
  try { return { ok: true, ...(await ai.suggestTitles(payload)) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// Google Drive backup. Client credentials and tokens stay in the main
// process, same guarantee as the OpenAI key above.
ipcMain.handle('backup-status', () => googleDrive.status());
ipcMain.handle('backup-save-client-credentials', (event, payload) => {
  try {
    googleDrive.configure({ clientId: payload && payload.clientId, clientSecret: payload && payload.clientSecret });
    return { ok: true, status: googleDrive.status() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('backup-connect', async () => {
  try {
    await googleDrive.connect();
    return { ok: true, status: googleDrive.status() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('backup-disconnect', async () => {
  try {
    await googleDrive.disconnect();
    return { ok: true, status: googleDrive.status() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('backup-now', async () => {
  const result = await googleDrive.backupDirectory(defaultDir);
  return { ...result, status: googleDrive.status() };
});
ipcMain.handle('backup-save-picker-key', (event, payload) => {
  try {
    googleDrive.configurePicker({ apiKey: payload && payload.apiKey });
    return { ok: true, status: googleDrive.status() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('backup-choose-folder', async () => {
  try {
    const { accessToken, apiKey } = await googleDrive.getPickerCredentials();
    const result = await openDrivePickerWindow({ accessToken, apiKey });
    if (result.ok && result.folder) googleDrive.setDestinationFolder(result.folder);
    return { ...result, status: googleDrive.status() };
  } catch (e) {
    return { ok: false, error: e.message, status: googleDrive.status() };
  }
});
ipcMain.handle('backup-clear-folder', () => {
  googleDrive.clearDestinationFolder();
  return { ok: true, status: googleDrive.status() };
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

// Status bar's filename display doubles as a "reveal in Finder" control --
// it otherwise has no purpose of its own beyond showing the current path.
ipcMain.on('show-in-finder', (event, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
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
