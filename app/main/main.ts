import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { emptyManuscript, parse, type Manuscript } from '@baretext/format';
import { CHANNELS, type InitialPrefs, type MenuCommand, type OpenedDocument, type ParagraphSpacing } from '../shared/bridge';
import { saveManuscript } from './save';
import { SettingsStore } from './settings';

// Test isolation: throwaway data dirs and a hidden window (spec §0.11).
// Otherwise use our own data folder: never share settings with the
// previous Baretext app, which used the same internal name.
app.setPath('userData', process.env.BARETEXT_USER_DATA ?? path.join(app.getPath('appData'), 'Baretext Next'));
const HIDDEN = process.env.BARETEXT_HIDDEN === '1';

const THEME_BACKGROUNDS: Record<string, string> = { dracula: '#21222c' };

let settings: SettingsStore;
let win: BrowserWindow | null = null;
let currentFile: string | null = null;
let quitting = false;

const recoveryRoot = () => path.join(app.getPath('userData'), 'Recovery');
// While developing, documents live in the project's samples/ folder — never
// in the previous app's ~/Documents/Baretext. The packaged app's real
// location is still to be decided.
const defaultSaveDir = () =>
  app.isPackaged ? path.join(app.getPath('documents'), 'Baretext') : path.join(__dirname, '../../samples'); // from build/main
const saveDir = () => settings.get().saveDir ?? process.env.BARETEXT_SAVE_DIR ?? defaultSaveDir();

async function uniqueUntitledPath(): Promise<string> {
  const dir = saveDir();
  await fs.mkdir(dir, { recursive: true });
  for (let i = 1; ; i++) {
    const p = path.join(dir, i === 1 ? 'Untitled.md' : `Untitled ${i}.md`);
    if (!existsSync(p)) return p;
  }
}

async function uniqueSibling(filePath: string, suffix: string): Promise<string> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  for (let i = 1; ; i++) {
    const p = path.join(dir, `${base} (${suffix}${i > 1 ? ` ${i}` : ''}).md`);
    if (!existsSync(p)) return p;
  }
}

async function readDocument(filePath: string): Promise<OpenedDocument> {
  const source = await fs.readFile(filePath, 'utf8');
  const fallbackTitle = path.basename(filePath, path.extname(filePath));
  const result = parse(source, fallbackTitle);
  if (result.native) {
    return { filePath, manuscript: result.manuscript, caret: settings.get().carets[filePath] ?? null };
  }
  // Importing never rewrites the original: the converted manuscript is
  // saved as a new file beside it, and that copy is what we edit.
  const copyPath = await uniqueSibling(filePath, 'Baretext');
  const saved = await saveManuscript(copyPath, result.manuscript, { recoveryRoot: recoveryRoot() });
  if (!saved.ok) throw new Error(saved.message);
  return { filePath: copyPath, manuscript: result.manuscript, caret: null, importedFrom: filePath };
}

async function createDocument(): Promise<OpenedDocument> {
  const filePath = await uniqueUntitledPath();
  const manuscript: Manuscript = emptyManuscript(path.basename(filePath, '.md'));
  const saved = await saveManuscript(filePath, manuscript, { recoveryRoot: recoveryRoot() });
  if (!saved.ok) throw new Error(saved.message);
  return { filePath, manuscript, caret: null };
}

function remember(filePath: string) {
  const recent = [filePath, ...settings.get().recent.filter((p) => p !== filePath)].slice(0, 10);
  settings.update({ lastFile: filePath, recent });
  currentFile = filePath;
  app.addRecentDocument(filePath);
  buildMenu();
}

async function initialDocument(): Promise<OpenedDocument> {
  const last = settings.get().lastFile;
  if (last && existsSync(last)) {
    try {
      const doc = await readDocument(last);
      remember(doc.filePath);
      return doc;
    } catch (e) {
      console.error('could not reopen last file:', e);
    }
  }
  const doc = await createDocument();
  remember(doc.filePath);
  return doc;
}

// ── flush: ask the UI to save before quitting or switching documents ──

function requestFlush(timeoutMs = 10_000): Promise<boolean> {
  if (!win || win.isDestroyed()) return Promise.resolve(true);
  const token = randomBytes(8).toString('hex');
  return new Promise((resolve) => {
    const timer = setTimeout(() => { ipcMain.removeListener(CHANNELS.flushed, onDone); resolve(false); }, timeoutMs);
    const onDone = (_e: unknown, t: string, ok: boolean) => {
      if (t !== token) return;
      clearTimeout(timer);
      ipcMain.removeListener(CHANNELS.flushed, onDone);
      resolve(ok);
    };
    ipcMain.on(CHANNELS.flushed, onDone);
    win!.webContents.send(CHANNELS.flush, token);
  });
}

async function switchTo(load: () => Promise<OpenedDocument>) {
  if (!(await requestFlush())) {
    dialog.showErrorBox('Baretext', 'The current manuscript could not be saved, so nothing else was opened. Your text is still in the window.');
    return;
  }
  try {
    const doc = await load();
    remember(doc.filePath);
    win?.webContents.send(CHANNELS.opened, doc);
  } catch (e) {
    dialog.showErrorBox('Baretext', `Could not open the file: ${(e as Error).message}`);
  }
}

async function openWithDialog() {
  if (!win) return;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    defaultPath: saveDir(),
    filters: [{ name: 'Manuscripts', extensions: ['md', 'markdown', 'txt'] }],
  });
  const file = result.filePaths[0];
  if (!result.canceled && file) await switchTo(() => readDocument(file));
}

// ── menu ──

function send(command: MenuCommand) {
  win?.webContents.send(CHANNELS.menu, command);
}

function setParagraphSpacing(spacing: ParagraphSpacing) {
  settings.update({ paragraphSpacing: spacing });
  win?.webContents.send(CHANNELS.paragraphSpacing, spacing);
  buildMenu();
}

function buildMenu() {
  // Shortcuts handled inside the editor are shown here but not registered,
  // so each key is handled in exactly one place.
  const label = (accelerator: string) => ({ accelerator, registerAccelerator: false });
  const recent = settings.get().recent.filter((p) => existsSync(p));
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => switchTo(createDocument) },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => openWithDialog() },
        {
          label: 'Open Recent',
          submenu: recent.length
            ? recent.map((p) => ({ label: path.basename(p), click: () => switchTo(() => readDocument(p)) }))
            : [{ label: 'No Recent Files', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Save', ...label('CmdOrCtrl+S'), click: () => send('save') },
        { label: 'Reveal in Finder', click: () => currentFile && shell.showItemInFolder(currentFile) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', ...label('CmdOrCtrl+Z'), click: () => send('undo') },
        { label: 'Redo', ...label('Shift+CmdOrCtrl+Z'), click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Format',
      submenu: [
        { label: 'Bold', ...label('CmdOrCtrl+B'), click: () => send('bold') },
        { label: 'Italic', ...label('CmdOrCtrl+I'), click: () => send('italic') },
        { label: 'Link…', click: () => send('link') },
        { label: 'Quote', click: () => send('quote') },
        { type: 'separator' },
        { label: 'Insert Scene Break', ...label('CmdOrCtrl+Enter'), click: () => send('split-scene') },
        { label: 'Insert Pause', ...label('Shift+CmdOrCtrl+Enter'), click: () => send('pause') },
        { type: 'separator' },
        {
          label: 'Paragraph Spacing',
          submenu: ([['full', 'Full Line'], ['half', 'Half Line'], ['none', 'None (Indent First Lines)']] as const).map(([value, text]) => ({
            label: text,
            type: 'radio' as const,
            checked: settings.get().paragraphSpacing === value,
            click: () => setParagraphSpacing(value),
          })),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Typewriter Mode', ...label('Shift+CmdOrCtrl+T'), click: () => send('typewriter') },
        { label: 'Focus Mode', ...label('CmdOrCtrl+.'), click: () => send('focus') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── window ──

function createWindow() {
  const s = settings.get();
  const initial: InitialPrefs = {
    theme: s.theme, paragraphSpacing: s.paragraphSpacing, hidden: HIDDEN,
  };
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 520,
    minHeight: 360,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: THEME_BACKGROUNDS[s.theme] ?? '#21222c',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Hidden test windows must keep rendering at full rate for timing tests.
      backgroundThrottling: !HIDDEN,
      additionalArguments: [`--bt-initial=${encodeURIComponent(JSON.stringify(initial))}`],
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (!HIDDEN) win.once('ready-to-show', () => win?.show());

  // Links in prose never navigate the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', async (e) => {
    if (quitting) return;
    e.preventDefault();
    const ok = await requestFlush();
    if (!ok) {
      dialog.showErrorBox('Baretext', 'The manuscript could not be saved, so the window was kept open. Your text is safe in the window.');
      return;
    }
    quitting = true;
    await settings.flush();
    win?.destroy();
  });
  win.on('closed', () => { win = null; });
}

function registerIpc() {
  ipcMain.handle(CHANNELS.loadInitial, () => initialDocument());
  ipcMain.handle(CHANNELS.save, async (_e, filePath: unknown, manuscript: Manuscript, caret: unknown) => {
    if (typeof filePath !== 'string' || filePath !== currentFile) {
      return { ok: false, reason: 'no-file', message: 'This window is not editing that file.' };
    }
    const result = await saveManuscript(filePath, manuscript, { recoveryRoot: recoveryRoot() });
    if (Number.isInteger(caret)) settings.update({ carets: { ...settings.get().carets, [filePath]: caret as number } });
    return result;
  });
  ipcMain.on(CHANNELS.setPrefs, (_e, patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = {};
    if (typeof patch.theme === 'string') next.theme = patch.theme;
    settings.update(next);
  });
  ipcMain.on(CHANNELS.reveal, (_e, filePath: unknown) => {
    if (typeof filePath === 'string' && filePath === currentFile) shell.showItemInFolder(filePath);
  });
}

app.whenReady().then(() => {
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  registerIpc();
  buildMenu();
  createWindow();
});

app.on('before-quit', () => {
  // Closing the window runs the flush; after that we may quit.
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });
