import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, type MenuItemConstructorOptions } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { bookTitle, emptyManuscript, ID_PATTERN, type Block, EXPORT_EXTENSIONS, EXPORT_FORMATS, exportMarkdown, exportText, isExportBook, manuscriptWords, parse, serialize, validate, type ExportFormat, type Manuscript } from '@baretext/format';
import { buildDocx } from './export-docx';
import { CHANNELS, OUTLINE_STATES, validAppearance, validExport, validSprint, type ExportResult, type InitialPrefs, type MenuCommand, type OpenedDocument, type OutlineState, type Theme } from '../shared/bridge';
import { atomicWrite, saveManuscript } from './save';
import { notesPathFor, validNotes } from '../shared/notes';
import { SnapshotStore, type SnapshotEntry } from './snapshots';
import { SprintStore, validRecord } from './sprints';
import { bookChapters, bookInfo, listBooks } from './books';
import { SettingsStore } from './settings';
import { MIN_SIZE, placeWindow } from './window';

// Test isolation: throwaway data dirs and a hidden window (spec §0.11).
// Otherwise use our own data folder: never share settings with the
// previous Baretext app, which used the same internal name.
app.setPath('userData', process.env.BARETEXT_USER_DATA ?? path.join(app.getPath('appData'), 'Baretext Next'));
const HIDDEN = process.env.BARETEXT_HIDDEN === '1';
/** The component gallery instead of the app (dev only: `npm run gallery`). */
const GALLERY = process.env.BARETEXT_GALLERY === '1';

// The window's color before the page paints (each theme's page color), so no theme flashes another.
const THEME_BACKGROUNDS: Record<Theme, string> = { dark: '#242424', light: '#f5f0e8', grove: '#2f383e', dracula: '#21222c', contrast: '#0a0a0a' };

let settings: SettingsStore;
let win: BrowserWindow | null = null;
let currentFile: string | null = null;
let quitting = false;

const recoveryRoot = () => path.join(app.getPath('userData'), 'Recovery');
let snapshotStore: SnapshotStore | null = null;
const snapshots = () => (snapshotStore ??= new SnapshotStore(path.join(app.getPath('userData'), 'Snapshots')));
let sprintStore: SprintStore | null = null;
const sprints = () => (sprintStore ??= new SprintStore(path.join(app.getPath('userData'), 'Sprints')));

/** Snapshots never block writing: failures are logged, never thrown at the writer. */
function snapshotOpened(doc: OpenedDocument) {
  const text = serialize(doc.manuscript);
  const words = manuscriptWords(doc.manuscript);
  void snapshots().take(doc.filePath, text, words, 'daily', 'Daily')
    .then(() => snapshots().take(doc.filePath, text, words, 'point', 'Opened'))
    .catch((e) => console.error('snapshot on open failed:', e));
}

const snapshotInfo = ({ hash: _hash, ...info }: SnapshotEntry) => info;
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

function uniqueSibling(filePath: string, suffix: string): string {
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
  const copyPath = uniqueSibling(filePath, 'Baretext');
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
  let notice: string | undefined;
  if (last) {
    const name = `“${path.basename(last)}”`;
    if (!existsSync(last)) {
      notice = `${name} wasn’t found. It may have been moved or renamed; open it with File → Open. This is a new manuscript.`;
    } else {
      try {
        const doc = await readDocument(last);
        remember(doc.filePath);
        snapshotOpened(doc);
        return doc;
      } catch (e) {
        console.error('could not reopen last file:', e);
        notice = `${name} could not be opened (${(e as Error).message}). The file was not changed. This is a new manuscript.`;
      }
    }
  }
  const doc = await createDocument();
  remember(doc.filePath);
  snapshotOpened(doc);
  return { ...doc, notice };
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

/** A sheet on the window (never an app-blocking alert): problems the writer should know about. */
function tell(message: string, detail = '') {
  if (win && !win.isDestroyed()) void dialog.showMessageBox(win, { type: 'warning', message, detail, buttons: ['OK'] });
  else dialog.showErrorBox(message, detail);
}

/** Save the current manuscript, then open another. True once it is open in the window. */
async function switchTo(load: () => Promise<OpenedDocument>): Promise<boolean> {
  if (!(await requestFlush())) {
    tell('The current manuscript could not be saved, so nothing else was opened.', 'Your text is still in the window. The message at the bottom of the window says what to do.');
    return false;
  }
  try {
    const doc = await load();
    remember(doc.filePath);
    snapshotOpened(doc);
    win?.webContents.send(CHANNELS.opened, doc);
    return true;
  } catch (e) {
    tell('Could not open the file.', (e as Error).message);
    return false;
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

const EXPORT_NAMES: Record<ExportFormat, string> = { docx: 'Word Document', markdown: 'Markdown', text: 'Plain Text' };

// ── menu ──

/** The window is in Sprinter (the menu's mode item names the way back). */
let sprinting = false;

function send(command: MenuCommand) {
  win?.webContents.send(CHANNELS.menu, command);
}

function buildMenu() {
  // Shortcuts handled inside the editor are shown here but not registered,
  // so each key is handled in exactly one place.
  const label = (accelerator: string) => ({ accelerator, registerAccelerator: false });
  const recent = settings.get().recent.filter((p) => existsSync(p));
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', ...label('CmdOrCtrl+,'), click: () => send('appearance') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => void switchTo(createDocument) },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => void openWithDialog() },
        {
          label: 'Open Recent',
          submenu: recent.length
            ? recent.map((p) => ({ label: path.basename(p), click: () => switchTo(() => readDocument(p)) }))
            : [{ label: 'No Recent Files', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Save', ...label('CmdOrCtrl+S'), click: () => send('save') },
        { label: 'Export…', ...label('Shift+CmdOrCtrl+E'), click: () => send('export') },
        { type: 'separator' },
        { label: 'Reveal in Finder', click: () => currentFile && shell.showItemInFolder(currentFile) },
        { type: 'separator' },
        { label: 'History…', click: () => send('history') },
        { label: 'Save Snapshot…', click: () => send('snapshot') },
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
        { label: 'Find…', ...label('CmdOrCtrl+F'), click: () => send('find') },
        { label: 'Find and Replace…', ...label('Alt+CmdOrCtrl+F'), click: () => send('find-replace') },
        { label: 'Find Next', ...label('CmdOrCtrl+G'), click: () => send('find-next') },
        { label: 'Find Previous', ...label('Shift+CmdOrCtrl+G'), click: () => send('find-prev') },
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
        { label: 'Add Note', ...label('Shift+CmdOrCtrl+M'), click: () => send('add-note') },
        { type: 'separator' },
        { label: 'Insert Scene Break', ...label('CmdOrCtrl+Enter'), click: () => send('split-scene') },
        { label: 'Insert Pause', ...label('Shift+CmdOrCtrl+Enter'), click: () => send('pause') },
        { label: 'Insert Chapter Break', ...label('Alt+CmdOrCtrl+Enter'), click: () => send('split-chapter') },
        { label: 'Name Scene', click: () => send('name-scene') },
        { label: 'New Scene at End of Chapter', click: () => send('new-scene') },
        { label: 'New Chapter', click: () => send('new-chapter') },
        { label: 'Move Scene to Cold Storage', click: () => send('park-scene') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette…', ...label('CmdOrCtrl+K'), click: () => send('palette') },
        { label: 'Go to Chapter or Scene…', ...label('Shift+CmdOrCtrl+O'), click: () => send('goto') },
        { type: 'separator' },
        { label: 'Outline', type: 'checkbox', checked: settings.get().outline === 'pinned', ...label('CmdOrCtrl+\\'), click: () => send('outline') },
        { label: 'Move to Outline', ...label('Alt+CmdOrCtrl+\\'), click: () => send('outline-focus') },
        { type: 'separator' },
        { label: 'Notes', ...label('Shift+CmdOrCtrl+N'), click: () => send('notes') },
        { label: 'Typewriter Mode', ...label('Shift+CmdOrCtrl+T'), click: () => send('typewriter') },
        { label: 'Focus Mode', ...label('CmdOrCtrl+.'), click: () => send('focus') },
        { type: 'separator' },
        { label: 'Sprint…', ...label('Shift+CmdOrCtrl+S'), click: () => send('sprint') },
        { label: 'Sprints…', enabled: !sprinting, click: () => send('sprints') },
        { label: sprinting ? 'End Sprint…' : 'Switch to Sprinter…', ...label('Shift+CmdOrCtrl+D'), click: () => send('mode') },
        { label: 'Hide Sprint Timer', ...label('Shift+CmdOrCtrl+H'), enabled: sprinting, click: () => send('sprint-hide') },
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
    theme: s.theme, proseFont: s.proseFont, paragraphSpacing: s.paragraphSpacing, proseWidth: s.proseWidth, fontSize: s.fontSize, outline: s.outline, hidden: HIDDEN,
    export: s.export,
    sprint: s.sprint,
  };
  // Where it was last time (if still on a connected display), else a large
  // centered window. Hidden test windows keep a fixed size unless a test sets one.
  const primary = screen.getPrimaryDisplay();
  const areas = [primary.workArea, ...screen.getAllDisplays().filter((d) => d.id !== primary.id).map((d) => d.workArea)];
  const bounds = HIDDEN && !s.window ? { width: 1100, height: 800 } : placeWindow(s.window, areas);
  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    titleBarStyle: 'hiddenInset',
    // Centers the traffic lights on the 36px title bar's midline (18px).
    trafficLightPosition: { x: 12, y: 11 },
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
  win.loadFile(path.join(__dirname, `../renderer/${GALLERY ? 'gallery' : 'index'}.html`)).catch((e) => console.error('the window could not load:', e));
  if (s.window?.maximized) win.maximize();
  if (!HIDDEN) win.once('ready-to-show', () => {
    win?.show();
    if (s.window?.fullscreen) win?.setFullScreen(true);
  });
  // Remember the window as the writer leaves it (debounced while dragging).
  let boundsTimer: NodeJS.Timeout | undefined;
  const rememberBounds = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds();
    settings.update({ window: { ...b, maximized: win.isMaximized(), fullscreen: win.isFullScreen() } });
  };
  const scheduleBounds = () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(rememberBounds, 400); };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
    win.on(event as 'resize', scheduleBounds);
  }

  // Links in prose never navigate the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', () => { clearTimeout(boundsTimer); rememberBounds(); });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); // (synchronously: the window waits for the save)
    void closeOnceSaved();
  });
  win.on('closed', () => { win = null; });
}

/** Close the window once everything in it is saved; if it can't be, it stays open and says why. */
async function closeOnceSaved() {
  if (!GALLERY && !(await requestFlush())) {
    tell('Your latest changes are not saved yet, so the window stays open.', 'Your text is safe in the window. The message at the bottom of the window says what to do.');
    return;
  }
  quitting = true;
  await settings.flush();
  win?.destroy();
}

function registerIpc() {
  ipcMain.handle(CHANNELS.loadInitial, () => {
    // A (re)loaded window starts in Manuscript.
    if (sprinting) { sprinting = false; buildMenu(); }
    return initialDocument();
  });
  ipcMain.handle(CHANNELS.save, async (_e, filePath: unknown, manuscript: Manuscript, caret: unknown, force: unknown) => {
    if (typeof filePath !== 'string' || filePath !== currentFile) {
      return { ok: false, reason: 'no-file', message: 'This window is not editing that file.' };
    }
    const result = await saveManuscript(filePath, manuscript, { recoveryRoot: recoveryRoot(), force: force === true });
    if (Number.isInteger(caret)) settings.update({ carets: { ...settings.get().carets, [filePath]: caret as number } });
    if (result.ok && !result.skipped) {
      void snapshots().auto(filePath, serialize(manuscript), manuscriptWords(manuscript)).catch((e) => console.error('snapshot failed:', e));
    }
    return result;
  });
  const own = (filePath: unknown): filePath is string => typeof filePath === 'string' && filePath === currentFile;
  ipcMain.handle(CHANNELS.snapshotsList, async (_e, filePath: unknown) =>
    own(filePath) ? (await snapshots().list(filePath)).map(snapshotInfo) : []);
  ipcMain.handle(CHANNELS.snapshotsRead, async (_e, filePath: unknown, id: unknown) => {
    if (!own(filePath) || typeof id !== 'string') throw new Error('Not this window’s manuscript.');
    return parse(await snapshots().read(filePath, id)).manuscript;
  });
  ipcMain.handle(CHANNELS.snapshotsTake, async (_e, filePath: unknown, manuscript: Manuscript, kind: unknown, reason: unknown, label: unknown) => {
    if (!own(filePath) || (kind !== 'point' && kind !== 'manual') || typeof reason !== 'string') return null;
    if (validate(manuscript).length) return null; // never store something that isn't a valid manuscript
    const entry = await snapshots().take(filePath, serialize(manuscript), manuscriptWords(manuscript), kind, reason.slice(0, 80),
      typeof label === 'string' ? label : undefined);
    return entry && snapshotInfo(entry);
  });
  ipcMain.handle(CHANNELS.snapshotsRemove, async (_e, filePath: unknown, id: unknown) => {
    if (own(filePath) && typeof id === 'string') await snapshots().remove(filePath, id);
  });
  // Notes beside the manuscript. A missing file is "no notes"; a damaged one
  // is set aside (never overwritten) and its notes left out.
  ipcMain.handle(CHANNELS.notesLoad, async (_e, filePath: unknown) => {
    if (!own(filePath)) return [];
    const file = notesPathFor(filePath);
    let raw: string;
    try { raw = await fs.readFile(file, 'utf8'); } catch { return []; }
    try { return validNotes(JSON.parse(raw)); } catch {
      await fs.rename(file, `${file}.damaged-${Date.now()}`).catch(() => undefined);
      return [];
    }
  });
  ipcMain.handle(CHANNELS.notesSave, async (_e, filePath: unknown, notes: unknown) => {
    if (!own(filePath)) return { ok: false, message: 'This window is not editing that file.' };
    const valid = validNotes({ v: 1, notes });
    const file = notesPathFor(filePath);
    if (!valid.length && !existsSync(file)) return { ok: true }; // no notes, no file
    try {
      await atomicWrite(file, JSON.stringify({ v: 1, notes: valid }, null, 1) + '\n');
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  });
  ipcMain.handle(CHANNELS.exportSave, async (_e, filePath: unknown, format: unknown, book: unknown, author: unknown): Promise<ExportResult> => {
    if (!own(filePath) || !win) return { ok: false, message: 'This window is not editing that file.' };
    if (!EXPORT_FORMATS.includes(format as ExportFormat) || !isExportBook(book)) return { ok: false, message: 'The export could not be prepared.' };
    const f = format as ExportFormat;
    const ext = EXPORT_EXTENSIONS[f];
    // Named for the book (else the manuscript), in the folder the last export went to.
    const title = bookTitle(book);
    const base = (title === 'Untitled' ? path.basename(filePath, path.extname(filePath)) : title).replace(/[/\\:]/g, '-').trim();
    const last = settings.get().exportDir;
    const choice = await dialog.showSaveDialog(win, {
      title: 'Export',
      defaultPath: path.join(last && existsSync(last) ? last : path.dirname(filePath), `${base}.${ext}`),
      filters: [{ name: EXPORT_NAMES[f], extensions: [ext] }],
    });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    try {
      const data = f === 'docx' ? await buildDocx(book, typeof author === 'string' ? author : '')
        : f === 'markdown' ? exportMarkdown(book) : exportText(book);
      await atomicWrite(choice.filePath, data);
      settings.update({ exportDir: path.dirname(choice.filePath) });
      return { ok: true, path: choice.filePath };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  });
  ipcMain.on(CHANNELS.setPrefs, (_e, patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...validAppearance(patch) };
    if ('export' in patch) next.export = validExport(patch.export);
    if ('sprint' in patch) next.sprint = validSprint(patch.sprint);
    if (OUTLINE_STATES.includes(patch.outline as OutlineState)) next.outline = patch.outline;
    settings.update(next);
    if ('outline' in next) buildMenu(); // keep the checked item in step
  });
  ipcMain.handle(CHANNELS.sprintWrite, async (_e, record: unknown, blocks: unknown) => {
    try {
      const r = validRecord(record);
      if (!r) return { ok: false, message: 'Not a sprint.' };
      await sprints().write(r, Array.isArray(blocks) ? (blocks as Block[]) : null);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  });
  ipcMain.handle(CHANNELS.sprintRead, (_e, id: unknown) => (typeof id === 'string' && ID_PATTERN.test(id) ? sprints().read(id) : []));
  ipcMain.handle(CHANNELS.sprintUnfinished, () => sprints().unfinished());
  ipcMain.handle(CHANNELS.sprintKept, () => sprints().kept());
  // Manuscripts a sprint can go to. The window may read or open only what it
  // was offered: the open and recent manuscripts, or one picked in the dialog.
  const offered = new Set<string>();
  ipcMain.handle(CHANNELS.booksList, async () => {
    const books = await listBooks(currentFile, settings.get().recent);
    for (const b of books) offered.add(b.path);
    return books;
  });
  ipcMain.handle(CHANNELS.booksChapters, (_e, filePath: unknown) => (typeof filePath === 'string' && offered.has(filePath) ? bookChapters(filePath) : null));
  ipcMain.handle(CHANNELS.booksChoose, async () => {
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], defaultPath: saveDir(), filters: [{ name: 'Manuscripts', extensions: ['md', 'markdown', 'txt'] }] });
    const file = result.filePaths[0];
    if (result.canceled || !file) return null;
    offered.add(file);
    return bookInfo(file, file === currentFile);
  });
  ipcMain.handle(CHANNELS.booksOpen, (_e, filePath: unknown) => {
    if (typeof filePath !== 'string' || !offered.has(filePath)) return false;
    return filePath === currentFile ? true : switchTo(() => readDocument(filePath));
  });
  ipcMain.on(CHANNELS.mode, (_e, mode: unknown) => {
    const next = mode === 'sprinter';
    if (next !== sprinting) { sprinting = next; buildMenu(); }
  });
  ipcMain.on(CHANNELS.fileCommand, (_e, command: unknown) => {
    if (command === 'new') void switchTo(createDocument);
    else if (command === 'open') void openWithDialog();
  });
  ipcMain.on(CHANNELS.reveal, (_e, filePath: unknown) => {
    if (typeof filePath === 'string' && filePath === currentFile) shell.showItemInFolder(filePath);
  });
}

void app.whenReady().then(() => {
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  registerIpc();
  buildMenu();
  createWindow();
  void sprints().purge().catch(() => undefined);
});

app.on('before-quit', () => {
  // Closing the window runs the flush; after that we may quit.
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });
