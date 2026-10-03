// What is done to the book as a whole (DECISIONS §18, §23, §26): its setup
// (title, author, structure, target), Export and Print. The author is the
// book's; the last one used (remembered with the export choices) is a new
// book's default and the fallback for a book without one.

import { bookSetupOf, docToExport, setBookSetup, type BookSetup } from '@baretext/editor';
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { BaretextBridge, ExportPrefs } from '../shared/bridge';
import { BookSetupPanel } from './book-setup';
import { ExportPanel } from './export-panel';
import { outlineOf } from './outline';
import { beatsKept, structureOf } from './structures';
import type { ToastKind } from './status';

export interface BookActionsHost {
  bridge: BaretextBridge;
  view(): EditorView | null;
  filePath(): string | null;
  /** The notes an export can carry (open, with something written). */
  exportableNotes(): { id: string; body: string; anchor: unknown }[];
  /** Apply a change from away from the page (it keeps the writer's place). */
  change(command: Command): boolean;
  toast(message: string, kind?: ToastKind): void;
  /** A panel closed: the keyboard goes back where the writer was. */
  onClose(): void;
}

export class BookActions {
  private prefs: ExportPrefs;
  private readonly exporter: ExportPanel;
  private readonly setup: BookSetupPanel;

  constructor(private readonly h: BookActionsHost) {
    this.prefs = h.bridge.initial.export;
    this.exporter = new ExportPanel(document.body, {
      current: () => ({ ...this.prefs, author: this.author() || this.prefs.author }),
      counts: () => {
        const view = h.view();
        const outline = view ? outlineOf(view.state.doc) : null;
        return { title: view?.state.doc.firstChild!.textContent ?? '', words: outline?.words ?? 0, chapters: outline?.chapters.length ?? 0, cold: outline?.parked.length ?? 0, notes: h.exportableNotes().length };
      },
      run: (p) => this.export(p),
      onClose: () => h.onClose(),
    });
    this.setup = new BookSetupPanel(document.body, {
      current: () => bookSetupOf(h.view()!.state.doc),
      lastAuthor: () => this.prefs.author,
      apply: (s) => this.set(s),
      onClose: () => h.onClose(),
    });
  }

  /** A panel of these covers the window. */
  get isOpen(): boolean {
    return this.exporter.isOpen || this.setup.isOpen;
  }

  get exportPrefs(): ExportPrefs {
    return this.prefs;
  }

  get setupOpen(): boolean {
    return this.setup.isOpen;
  }

  get exportOpen(): boolean {
    return this.exporter.isOpen;
  }

  /** Book Settings (`isNew`: just made — its author defaults to the last used). */
  openSetup(isNew = false) {
    this.setup.open(isNew);
  }

  openExport() {
    this.exporter.open();
  }

  close() {
    this.setup.close();
    this.exporter.close();
  }

  /** The book's author, if it has one. */
  author(): string {
    return this.h.view()?.state.doc.attrs.author ?? '';
  }

  /** Change the book's setup (one undoable step); its author is remembered for the next new book. */
  set(s: BookSetup) {
    const view = this.h.view();
    // Another structure: the story beats it doesn't have are cleared (and the writer told).
    const changing = !!view && bookSetupOf(view.state.doc).structure !== s.structure;
    const keep = beatsKept(s.structure);
    const cleared = changing ? outlineOf(view.state.doc).chapters.flatMap((c) => c.scenes).filter((x) => x.beat && !keep(x.beat)).length : 0;
    if (!this.h.change(setBookSetup(s, keep))) return;
    if (cleared) this.h.toast(`${cleared} story ${cleared === 1 ? 'beat doesn’t' : 'beats don’t'} exist in ${structureOf(s.structure)?.name ?? 'this book'} and ${cleared === 1 ? 'was' : 'were'} cleared. ⌘Z brings ${cleared === 1 ? 'it' : 'them'} back.`);
    const author = s.author.trim();
    if (author && author !== this.prefs.author) this.remember({ ...this.prefs, author });
  }

  /** Print (⌘P): the manuscript in standard format, by the book's author (else the last used). */
  async print() {
    const view = this.h.view();
    if (!view) return;
    const result = await this.h.bridge.printBook(docToExport(view.state.doc, { coldStorage: false, notes: null }), this.author() || this.prefs.author);
    if (!result.ok && !result.canceled) this.h.toast(`Couldn’t print: ${result.message}`, 'error');
  }

  /** Export with these choices (remembered either way); an author named here becomes the book's. */
  private async export(p: ExportPrefs) {
    this.remember(p);
    const view = this.h.view();
    const filePath = this.h.filePath();
    if (!view || !filePath) return { ok: false as const, message: 'There is nothing to export yet.' };
    if (p.author !== this.author()) this.set({ ...bookSetupOf(view.state.doc), author: p.author });
    const included = p.notes ? this.h.exportableNotes().map((n) => ({ id: n.id, body: n.body, anchored: !!n.anchor })) : null;
    const book = docToExport(view.state.doc, { coldStorage: p.coldStorage, notes: included });
    const result = await this.h.bridge.exportBook(filePath, p.format, book, p.author);
    if (result.ok) this.h.toast(`Exported “${result.path.split('/').pop()}”`);
    else if (!result.canceled) this.h.toast(`Couldn’t export: ${result.message}`, 'error');
    return result;
  }

  private remember(p: ExportPrefs) {
    this.prefs = p;
    this.h.bridge.setPrefs({ export: p });
  }
}
