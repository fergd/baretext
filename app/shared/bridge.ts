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

/** Color themes (Appearance). Dracula is the default. */
export const THEMES = ['dark', 'light', 'grove', 'dracula', 'contrast'] as const;
export type Theme = (typeof THEMES)[number];

/** The prose face (IBM Plex Mono, Sans or Serif); headings on the page follow it. */
export const PROSE_FONTS = ['mono', 'sans', 'serif'] as const;
export type ProseFont = (typeof PROSE_FONTS)[number];

/** Whether the outline is kept open as a column (⌘\). */
export const OUTLINE_STATES = ['hidden', 'pinned'] as const;
export type OutlineState = (typeof OUTLINE_STATES)[number];

/** Prose column width: Narrow (~55 characters) or Wide (~70). */
export const PROSE_WIDTHS = ['narrow', 'wide'] as const;
export type ProseWidth = (typeof PROSE_WIDTHS)[number];

/** Prose size: Small 14/24 · Medium 15/24 · Large 17/28 · Extra large 19/32. */
export const FONT_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export type FontSize = (typeof FONT_SIZES)[number];

/** Everything the Appearance panel sets, saved together. */
export interface AppearancePrefs {
  theme: Theme;
  proseFont: ProseFont;
  paragraphSpacing: ParagraphSpacing;
  proseWidth: ProseWidth;
  fontSize: FontSize;
}

export const DEFAULT_APPEARANCE: AppearancePrefs = { theme: 'dracula', proseFont: 'mono', paragraphSpacing: 'full', proseWidth: 'narrow', fontSize: 'medium' };

export interface InitialPrefs {
  theme: Theme;
  paragraphSpacing: ParagraphSpacing;
  proseFont: ProseFont;
  proseWidth: ProseWidth;
  fontSize: FontSize;
  outline: OutlineState;
  hidden: boolean;
}

export type MenuCommand =
  | 'undo' | 'redo' | 'typewriter' | 'focus' | 'bold' | 'italic' | 'link' | 'quote' | 'split-scene' | 'pause' | 'name-scene' | 'save' | 'palette' | 'goto' | 'find' | 'find-replace' | 'find-next' | 'find-prev' | 'history' | 'snapshot' | 'outline' | 'outline-focus' | 'new-scene' | 'new-chapter' | 'appearance';

/** A local snapshot of a manuscript (DECISIONS §6). */
export interface SnapshotInfo {
  id: string;
  kind: 'point' | 'daily' | 'manual';
  reason: string;
  label?: string;
  time: number;
  words: number;
}

export interface BaretextBridge {
  initial: InitialPrefs;
  loadInitial(): Promise<OpenedDocument>;
  save(filePath: string, manuscript: Manuscript, caret: number): Promise<SaveResult>;
  setPrefs(patch: Partial<Omit<InitialPrefs, 'hidden'>>): void;
  revealInFinder(filePath: string): void;
  listSnapshots(filePath: string): Promise<SnapshotInfo[]>;
  readSnapshot(filePath: string, id: string): Promise<Manuscript>;
  /** A snapshot of the manuscript as it is in the window now (before a risky change, or by hand). */
  takeSnapshot(filePath: string, manuscript: Manuscript, kind: 'point' | 'manual', reason: string, label?: string): Promise<SnapshotInfo | null>;
  removeSnapshot(filePath: string, id: string): Promise<void>;
  /** File commands the main process owns (they may show a dialog or switch documents). */
  fileCommand(command: 'new' | 'open'): void;
  onMenu(cb: (command: MenuCommand) => void): void;
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
  snapshotsList: 'snapshots:list',
  snapshotsRead: 'snapshots:read',
  snapshotsTake: 'snapshots:take',
  snapshotsRemove: 'snapshots:remove',
  menu: 'menu:command',
  flush: 'app:flush',
  flushed: 'app:flushed',
} as const;
