// The narrow bridge between the UI and the privileged side (spec §14.1).
import { EXPORT_FORMATS, type Block, type ExportBook, type ExportFormat, type Manuscript } from '@baretext/format';
import type { Note } from './notes';

export interface OpenedDocument {
  filePath: string;
  manuscript: Manuscript;
  /** Last caret position (document position) for this file, if known. */
  caret: number | null;
  /** Set when another file was imported: the original's path (left untouched). */
  importedFrom?: string;
  /** Something the writer should be told on opening (e.g. why the last manuscript didn't reopen). */
  notice?: string;
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

const APPEARANCE_CHOICES: { [K in keyof AppearancePrefs]: readonly AppearancePrefs[K][] } = {
  theme: THEMES, proseFont: PROSE_FONTS, paragraphSpacing: PARAGRAPH_SPACINGS, proseWidth: PROSE_WIDTHS, fontSize: FONT_SIZES,
};

/** The valid appearance values in `raw` (anything unknown or malformed is left out). */
export function validAppearance(raw: Record<string, unknown>): Partial<AppearancePrefs> {
  const out: Record<string, unknown> = {};
  for (const [key, choices] of Object.entries(APPEARANCE_CHOICES)) {
    if ((choices as readonly unknown[]).includes(raw[key])) out[key] = raw[key];
  }
  return out;
}

/** Export choices, remembered between exports (DECISIONS §18). */
export interface ExportPrefs {
  format: ExportFormat;
  coldStorage: boolean;
  notes: boolean;
  /** For Word's title page and running head. */
  author: string;
}

export const DEFAULT_EXPORT: ExportPrefs = { format: 'docx', coldStorage: false, notes: false, author: '' };

/** Export choices from untrusted input (anything malformed falls back to the default). */
export function validExport(raw: unknown): ExportPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    format: EXPORT_FORMATS.includes(r.format as ExportFormat) ? (r.format as ExportFormat) : DEFAULT_EXPORT.format,
    coldStorage: r.coldStorage === true,
    notes: r.notes === true,
    author: typeof r.author === 'string' ? r.author.slice(0, 200) : '',
  };
}

/** The corkboard's layout: chapters as rows of cards, or as columns. */
export const CORKBOARD_LAYOUTS = ['rows', 'columns'] as const;
export type CorkboardLayout = (typeof CORKBOARD_LAYOUTS)[number];
export const validCorkboardLayout = (v: unknown): CorkboardLayout => (CORKBOARD_LAYOUTS.includes(v as CorkboardLayout) ? (v as CorkboardLayout) : 'rows');

/** Sprint setup choices, remembered between sprints. */
export const SPRINT_KINDS = ['time', 'words'] as const;
export type SprintKind = (typeof SPRINT_KINDS)[number];
export interface SprintPrefs {
  /** A sprint runs for a time, or until a word count is reached. */
  kind: SprintKind;
  minutes: number;
  /** The target for a words sprint. */
  words: number;
  /** Sprints in the session. */
  rounds: number;
  /** Minutes between sprints; 0 for none. */
  breakMinutes: number;
}

export const DEFAULT_SPRINT: SprintPrefs = { kind: 'time', minutes: 15, words: 500, rounds: 1, breakMinutes: 5 };
export const SPRINT_LIMITS = { minutes: [1, 180], words: [10, 20000], rounds: [1, 8], breakMinutes: [0, 60] } as const;

/** Sprint choices from untrusted input (anything malformed falls back to the default). */
export function validSprint(raw: unknown): SprintPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const int = (key: keyof typeof SPRINT_LIMITS, fallback: number) => {
    const v = r[key];
    const [min, max] = SPRINT_LIMITS[key];
    return Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : fallback;
  };
  return {
    kind: SPRINT_KINDS.includes(r.kind as SprintKind) ? (r.kind as SprintKind) : DEFAULT_SPRINT.kind,
    minutes: int('minutes', DEFAULT_SPRINT.minutes),
    words: int('words', DEFAULT_SPRINT.words),
    rounds: int('rounds', DEFAULT_SPRINT.rounds),
    breakMinutes: int('breakMinutes', DEFAULT_SPRINT.breakMinutes),
  };
}

/** A sprint page's lifecycle: being written; kept in Sprints; placed in a book; discarded. */
export const SPRINT_STATUSES = ['active', 'kept', 'placed', 'discarded'] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];
export interface SprintRecord {
  id: string;
  status: SprintStatus;
  started: number;
  updated: number;
  words: number;
  /** The manuscript open when it was written. */
  book: string | null;
  prefs: SprintPrefs;
}

/** A kept sprint, as the Sprints library lists it. */
export interface SprintSummary {
  record: SprintRecord;
  /** Its opening words (plain text). */
  opening: string;
}

/** A manuscript the writer can send a sprint to. */
export interface BookInfo {
  path: string;
  title: string;
  /** The one open in the window. */
  current: boolean;
}

export type PrintResult = { ok: true } | { ok: false; canceled: true } | { ok: false; canceled?: false; message: string };

export type ExportResult = { ok: true; path: string } | { ok: false; canceled: true } | { ok: false; canceled?: false; message: string };

export interface InitialPrefs extends AppearancePrefs {
  outline: OutlineState;
  hidden: boolean;
  export: ExportPrefs;
  sprint: SprintPrefs;
  corkboardLayout: CorkboardLayout;
}

export type MenuCommand =
  | 'undo' | 'redo' | 'typewriter' | 'focus' | 'bold' | 'italic' | 'link' | 'quote' | 'split-scene' | 'split-chapter' | 'pause' | 'name-scene' | 'save' | 'palette' | 'goto' | 'find' | 'find-replace' | 'find-next' | 'find-prev' | 'history' | 'snapshot' | 'outline' | 'outline-focus' | 'new-scene' | 'new-chapter' | 'appearance' | 'park-scene' | 'add-note' | 'notes' | 'export' | 'print' | 'corkboard' | 'sprint' | 'sprints' | 'mode' | 'sprint-pause' | 'sprint-hide';

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
  /** `force` overrides the destructive-save guard: only after the writer confirmed (Save anyway). */
  save(filePath: string, manuscript: Manuscript, caret: number, force?: boolean): Promise<SaveResult>;
  setPrefs(patch: Partial<Omit<InitialPrefs, 'hidden'>>): void;
  /** Print the book in standard manuscript format (the macOS print dialog, which can also save a PDF). */
  printBook(book: ExportBook, author: string): Promise<PrintResult>;
  /** Export the book: asks where (macOS save dialog), then writes it. */
  exportBook(filePath: string, format: ExportFormat, book: ExportBook, author: string): Promise<ExportResult>;
  revealInFinder(filePath: string): void;
  /** Save a sprint page (its writing too, when given). Resolves once it is on disk. */
  writeSprint(record: SprintRecord, blocks: Block[] | null): Promise<{ ok: boolean; message?: string }>;
  readSprint(id: string): Promise<Block[]>;
  /** A sprint the app quit or crashed during, if any. */
  unfinishedSprint(): Promise<SprintRecord | null>;
  /** The sprints kept in Sprints, newest first. */
  keptSprints(): Promise<SprintSummary[]>;
  /** The writer's manuscripts: the open one first, then recent ones. */
  listBooks(): Promise<BookInfo[]>;
  /** A listed (or chosen) manuscript's chapter titles; null if it can't be read. */
  bookChapters(filePath: string): Promise<string[] | null>;
  /** Pick another manuscript with the file dialog (it is not opened). */
  chooseBook(): Promise<BookInfo | null>;
  /** Open a listed (or chosen) manuscript in the window, saving the current one first. True once it is open. */
  openBook(filePath: string): Promise<boolean>;
  /** The window's mode, so the menu can say which way the mode item goes. */
  modeChanged(mode: 'manuscript' | 'sprinter'): void;
  listSnapshots(filePath: string): Promise<SnapshotInfo[]>;
  readSnapshot(filePath: string, id: string): Promise<Manuscript>;
  /** A snapshot of the manuscript as it is in the window now (before a risky change, or by hand). */
  takeSnapshot(filePath: string, manuscript: Manuscript, kind: 'point' | 'manual', reason: string, label?: string): Promise<SnapshotInfo | null>;
  removeSnapshot(filePath: string, id: string): Promise<void>;
  /** Notes live beside the manuscript ("<name>.notes.json"); [] when there are none yet. */
  loadNotes(filePath: string): Promise<Note[]>;
  saveNotes(filePath: string, notes: Note[]): Promise<{ ok: boolean; message?: string }>;
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
  mode: 'mode:changed',
  sprintWrite: 'sprint:write',
  sprintRead: 'sprint:read',
  sprintUnfinished: 'sprint:unfinished',
  sprintKept: 'sprint:kept',
  booksList: 'books:list',
  booksChapters: 'books:chapters',
  booksChoose: 'books:choose',
  booksOpen: 'books:open',
  print: 'book:print',
  fileCommand: 'file:command',
  snapshotsList: 'snapshots:list',
  snapshotsRead: 'snapshots:read',
  snapshotsTake: 'snapshots:take',
  snapshotsRemove: 'snapshots:remove',
  notesLoad: 'notes:load',
  notesSave: 'notes:save',
  exportSave: 'export:save',
  menu: 'menu:command',
  flush: 'app:flush',
  flushed: 'app:flushed',
} as const;
