// The narrow bridge between the UI and the privileged side (spec §14.1).
import type { Manuscript } from '@baretext/format';

export interface OpenedDocument {
  filePath: string;
  manuscript: Manuscript;
  /** Last caret position (document position) for this file, if known. */
  caret: number | null;
  /** Set when another file was imported: the original's path (left untouched). */
  importedFrom?: string;
}

export type SaveResult =
  | { ok: true; bytes: number; skipped?: boolean }
  | { ok: false; reason: 'verify' | 'destructive' | 'io' | 'no-file'; message: string };

/** Space between paragraphs: a full line, half a line, or none (first lines indented). */
export const PARAGRAPH_SPACINGS = ['full', 'half', 'none'] as const;
export type ParagraphSpacing = (typeof PARAGRAPH_SPACINGS)[number];

export interface InitialPrefs {
  theme: string;
  paragraphSpacing: ParagraphSpacing;
  hidden: boolean;
}

export type MenuCommand =
  | 'undo' | 'redo' | 'typewriter' | 'focus' | 'bold' | 'italic' | 'link' | 'quote' | 'split-scene' | 'pause' | 'name-scene' | 'save' | 'palette' | 'goto';

export interface BaretextBridge {
  initial: InitialPrefs;
  loadInitial(): Promise<OpenedDocument>;
  save(filePath: string, manuscript: Manuscript, caret: number): Promise<SaveResult>;
  setPrefs(patch: Partial<Omit<InitialPrefs, 'hidden'>>): void;
  revealInFinder(filePath: string): void;
  /** File commands the main process owns (they may show a dialog or switch documents). */
  fileCommand(command: 'new' | 'open'): void;
  onMenu(cb: (command: MenuCommand) => void): void;
  /** Main changed a formatting preference (from the native menu). */
  onParagraphSpacing(cb: (spacing: ParagraphSpacing) => void): void;
  onDocumentOpened(cb: (doc: OpenedDocument) => void): void;
  /** Main asks the UI to save everything now (before quit or switching files). */
  onFlushRequest(cb: () => Promise<boolean>): void;
}

export const CHANNELS = {
  loadInitial: 'doc:load-initial',
  save: 'doc:save',
  opened: 'doc:opened',
  setPrefs: 'prefs:set',
  reveal: 'shell:reveal',
  fileCommand: 'file:command',
  menu: 'menu:command',
  paragraphSpacing: 'prefs:paragraph-spacing',
  flush: 'app:flush',
  flushed: 'app:flushed',
} as const;
