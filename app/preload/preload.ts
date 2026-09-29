import { contextBridge, ipcRenderer } from 'electron';
import type { Manuscript } from '@baretext/format';
import { CHANNELS, type BaretextBridge, type InitialPrefs, type MenuCommand, type OpenedDocument, type ParagraphSpacing } from '../shared/bridge';

function readInitial(): InitialPrefs {
  const arg = process.argv.find((a) => a.startsWith('--bt-initial='));
  const fallback: InitialPrefs = { theme: 'dracula', paragraphSpacing: 'full', hidden: false };
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
  save: (filePath: string, manuscript: Manuscript, caret: number) => ipcRenderer.invoke(CHANNELS.save, filePath, manuscript, caret),
  setPrefs: (patch) => ipcRenderer.send(CHANNELS.setPrefs, patch),
  revealInFinder: (filePath: string) => ipcRenderer.send(CHANNELS.reveal, filePath),
  onMenu: (cb) => { ipcRenderer.on(CHANNELS.menu, (_e, command: MenuCommand) => cb(command)); },
  onParagraphSpacing: (cb) => { ipcRenderer.on(CHANNELS.paragraphSpacing, (_e, spacing: ParagraphSpacing) => cb(spacing)); },
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
