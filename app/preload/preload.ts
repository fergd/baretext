import { contextBridge, ipcRenderer } from 'electron';
import type { Manuscript } from '@baretext/format';
import { CHANNELS, DEFAULT_APPEARANCE, type BaretextBridge, type InitialPrefs, type MenuCommand, type OpenedDocument } from '../shared/bridge';

function readInitial(): InitialPrefs {
  const arg = process.argv.find((a) => a.startsWith('--bt-initial='));
  const fallback: InitialPrefs = { ...DEFAULT_APPEARANCE, outline: 'hidden', hidden: false };
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
  fileCommand: (command) => ipcRenderer.send(CHANNELS.fileCommand, command),
  listSnapshots: (filePath) => ipcRenderer.invoke(CHANNELS.snapshotsList, filePath),
  readSnapshot: (filePath, id) => ipcRenderer.invoke(CHANNELS.snapshotsRead, filePath, id),
  takeSnapshot: (filePath, manuscript, kind, reason, label) => ipcRenderer.invoke(CHANNELS.snapshotsTake, filePath, manuscript, kind, reason, label),
  removeSnapshot: (filePath, id) => ipcRenderer.invoke(CHANNELS.snapshotsRemove, filePath, id),
  onMenu: (cb) => { ipcRenderer.on(CHANNELS.menu, (_e, command: MenuCommand) => cb(command)); },
  onDocumentOpened: (cb) => { ipcRenderer.on(CHANNELS.opened, (_e, doc: OpenedDocument) => cb(doc)); },
  onFlushRequest: (cb) => {
    ipcRenderer.on(CHANNELS.flush, async (_e, token: string) => {
      let ok = false;
      try { ok = await cb(); } catch { ok = false; }
      ipcRenderer.send(CHANNELS.flushed, token, ok);
    });
  },
};

contextBridge.exposeInMainWorld('baretext', bridge);
