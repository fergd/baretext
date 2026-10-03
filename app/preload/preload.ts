import { contextBridge, ipcRenderer } from 'electron';
import type { Manuscript } from '@baretext/format';
import { CHANNELS, DEFAULT_APPEARANCE, DEFAULT_EXPORT, DEFAULT_SPRINT, type BaretextBridge, type InitialPrefs, type MenuCommand, type OpenedDocument } from '../shared/bridge';

function readInitial(): InitialPrefs {
  const arg = process.argv.find((a) => a.startsWith('--bt-initial='));
  const fallback: InitialPrefs = { ...DEFAULT_APPEARANCE, outline: 'hidden', hidden: false, export: DEFAULT_EXPORT, sprint: DEFAULT_SPRINT, corkboardLayout: 'rows', corkboardArc: false };
  if (!arg) return fallback;
  try {
    return { ...fallback, ...JSON.parse(decodeURIComponent(arg.slice('--bt-initial='.length))) };
  } catch {
    return fallback;
  }
}

const bridge: BaretextBridge = {
  initial: readInitial(),
  loadInitial: () => ipcRenderer.invoke(CHANNELS.loadInitial),
  save: (filePath: string, manuscript: Manuscript, caret: number, force?: boolean) => ipcRenderer.invoke(CHANNELS.save, filePath, manuscript, caret, force === true),
  setPrefs: (patch) => ipcRenderer.send(CHANNELS.setPrefs, patch),
  revealInFinder: (filePath: string) => ipcRenderer.send(CHANNELS.reveal, filePath),
  modeChanged: (mode) => ipcRenderer.send(CHANNELS.mode, mode),
  writeSprint: (record, blocks) => ipcRenderer.invoke(CHANNELS.sprintWrite, record, blocks),
  readSprint: (id) => ipcRenderer.invoke(CHANNELS.sprintRead, id),
  unfinishedSprint: () => ipcRenderer.invoke(CHANNELS.sprintUnfinished),
  keptSprints: () => ipcRenderer.invoke(CHANNELS.sprintKept),
  listBooks: () => ipcRenderer.invoke(CHANNELS.booksList),
  bookChapters: (filePath) => ipcRenderer.invoke(CHANNELS.booksChapters, filePath),
  chooseBook: () => ipcRenderer.invoke(CHANNELS.booksChoose),
  openBook: (filePath) => ipcRenderer.invoke(CHANNELS.booksOpen, filePath),
  fileCommand: (command) => ipcRenderer.send(CHANNELS.fileCommand, command),
  listSnapshots: (filePath) => ipcRenderer.invoke(CHANNELS.snapshotsList, filePath),
  readSnapshot: (filePath, id) => ipcRenderer.invoke(CHANNELS.snapshotsRead, filePath, id),
  takeSnapshot: (filePath, manuscript, kind, reason, label) => ipcRenderer.invoke(CHANNELS.snapshotsTake, filePath, manuscript, kind, reason, label),
  removeSnapshot: (filePath, id) => ipcRenderer.invoke(CHANNELS.snapshotsRemove, filePath, id),
  loadNotes: (filePath) => ipcRenderer.invoke(CHANNELS.notesLoad, filePath),
  saveNotes: (filePath, notes) => ipcRenderer.invoke(CHANNELS.notesSave, filePath, notes),
  printBook: (book, author) => ipcRenderer.invoke(CHANNELS.print, book, author),
  copyRich: (html, text) => ipcRenderer.invoke(CHANNELS.clipboard, html, text),
  popupMenu: (items) => ipcRenderer.invoke(CHANNELS.popupMenu, items),
  exportBook: (filePath, format, book, author) => ipcRenderer.invoke(CHANNELS.exportSave, filePath, format, book, author),
  onMenu: (cb) => { ipcRenderer.on(CHANNELS.menu, (_e, command: MenuCommand) => cb(command)); },
  onDocumentOpened: (cb) => { ipcRenderer.on(CHANNELS.opened, (_e, doc: OpenedDocument) => cb(doc)); },
  onFlushRequest: (cb) => {
    const reply = async (token: string) => {
      let ok = false;
      try { ok = await cb(); } catch { ok = false; }
      ipcRenderer.send(CHANNELS.flushed, token, ok);
    };
    ipcRenderer.on(CHANNELS.flush, (_e, token: string) => void reply(token));
  },
};

contextBridge.exposeInMainWorld('baretext', bridge);
