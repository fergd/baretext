// Sprinter (DECISIONS §21): setup, the sprint page, the session (rounds,
// breaks, the timer line), where the writing goes, and the Sprints library.
// The manuscript side — its editor, saving, the window's mode — belongs to
// the host; a sprint never touches the manuscript except to place its
// writing there, as one undoable step.

import type { EditorView } from 'prosemirror-view';
import { toggleMark } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import type { Command } from 'prosemirror-state';
import { insertSprintPause, placeSprint, sprintSchema } from '@baretext/editor';
import type { Block } from '@baretext/format';
import type { BaretextBridge, MenuCommand, SprintPrefs, SprintRecord } from '../shared/bridge';
import { currentScene, outlineOf } from './outline';
import { SprintKeep, type KeepChoice, type KeepTarget } from './sprint-keep';
import { SprintPage } from './sprint-page';
import { SprintSetup, sprintName } from './sprint-setup';
import { SprintTimer } from './sprint-timer';
import { SprintsPanel } from './sprints-panel';
import { cssNumber } from './dom';

export interface SprinterHost {
  app: HTMLElement;
  workspace: HTMLElement;
  bridge: BaretextBridge;
  view(): EditorView | null;
  filePath(): string | null;
  toast(message: string, kind?: 'info' | 'error'): void;
  /** Save the open book now; true once it is on disk. */
  saveBook(): Promise<boolean>;
  /** Open another book in the window (the current one saved first); true once open. */
  openBook(filePath: string): Promise<boolean>;
  /** Switch the window into or out of Sprinter (its chrome, outline, notes, focus mode). */
  setMode(mode: 'manuscript' | 'sprinter'): void;
  /** The status bar's word count. */
  showWords(words: number): void;
  /** Back to the manuscript's page (after placing writing there). */
  focusBook(): void;
}

type BookChoice = 'chapter' | 'end' | 'cold';
const inBook = (c: KeepChoice): c is BookChoice => c === 'chapter' || c === 'end' || c === 'cold';

/** In Sprinter only these commands reach anything; editing acts on the sprint page. */
const PAGE_COMMANDS: Partial<Record<MenuCommand, Command>> = {
  undo,
  redo,
  bold: toggleMark(sprintSchema.marks.bold!),
  italic: toggleMark(sprintSchema.marks.italic!),
  pause: insertSprintPause,
};

export class Sprinter {
  private prefs: SprintPrefs;
  private readonly setup: SprintSetup;
  readonly page: SprintPage;
  readonly timer: SprintTimer;
  private readonly keep: SprintKeep;
  private readonly library: SprintsPanel;
  private session: { prefs: SprintPrefs; round: number; baseWords: number } | null = null;
  /** The end panel paused the timer (Keep writing resumes it; a timer the writer paused stays paused). */
  private pausedForKeep = false;

  constructor(private readonly h: SprinterHost) {
    this.prefs = h.bridge.initial.sprint;
    this.setup = new SprintSetup(document.body, {
      current: () => this.prefs,
      start: (p) => this.start(p),
      onClose: () => h.focusBook(),
    });
    this.page = new SprintPage(h.workspace, {
      bridge: h.bridge,
      book: () => h.filePath(),
      onChange: (words) => {
        if (!this.active) return;
        h.showWords(words);
        this.wordsChanged(words);
      },
      onError: (message) => h.toast(`Couldn’t save the sprint: ${message}`, 'error'),
    });
    this.timer = new SprintTimer(h.app);
    this.keep = new SprintKeep(document.body, {
      books: () => h.bridge.listBooks(),
      chooseBook: () => h.bridge.chooseBook(),
      chapters: (book) => this.chapters(book.path),
    });
    this.library = new SprintsPanel(document.body, {
      bridge: h.bridge,
      place: (sprint, blocks) => this.placeFromLibrary(sprint.record, blocks),
      discard: async (sprint) => {
        const result = await h.bridge.writeSprint({ ...sprint.record, status: 'discarded' }, null);
        if (!result.ok) h.toast(`Couldn’t discard the sprint: ${result.message}`, 'error');
        return result.ok;
      },
      onClose: () => h.focusBook(),
    });
  }

  /** The window is in Sprinter. */
  get active(): boolean {
    return this.h.app.dataset.mode === 'sprinter';
  }

  /** A panel of Sprinter's covers the window (other commands wait). */
  get panelOpen(): boolean {
    return this.setup.isOpen || this.keep.isOpen || this.library.isOpen;
  }

  openSetup() {
    this.setup.open();
  }

  openLibrary() {
    void this.library.open();
  }

  focus() {
    this.page.focus();
  }

  flush(): Promise<boolean> {
    return this.page.flush();
  }

  /** A command while in Sprinter. */
  command(command: MenuCommand) {
    const edit = PAGE_COMMANDS[command];
    const editor = this.page.editor;
    if (edit && editor) { edit(editor.state, editor.dispatch); editor.focus(); return; }
    switch (command) {
      case 'typewriter': this.page.typewriter.setEnabled(!this.page.typewriter.enabled); break;
      case 'mode': void this.end(); break;
      case 'sprint-pause': if (this.timer.paused) this.timer.resume(); else this.timer.pause(); break;
      case 'sprint-hide': this.timer.setHidden(!this.timer.hidden); break;
    }
  }

  // ── a sprint: start, rounds, end ──

  private start(p: SprintPrefs) {
    this.prefs = p;
    this.h.bridge.setPrefs({ sprint: p });
    this.page.start(p);
    this.h.setMode('sprinter');
    this.session = { prefs: p, round: 1, baseWords: 0 };
    this.startRound();
  }

  private startRound() {
    const s = this.session;
    if (!s) return;
    s.baseWords = this.page.words();
    if (s.prefs.kind === 'time') this.timer.run(s.prefs.minutes * 60_000, 'sprint', () => this.roundOver());
    else this.timer.progress(0);
  }

  /** A words sprint ends when its target is reached. */
  private wordsChanged(words: number) {
    const s = this.session;
    if (!s || s.prefs.kind !== 'words' || this.timer.phase !== 'sprint') return;
    const done = words - s.baseWords;
    this.timer.progress(done / s.prefs.words);
    if (done >= s.prefs.words) this.roundOver();
  }

  private roundOver() {
    const s = this.session;
    if (!s) return;
    if (s.round < s.prefs.rounds) {
      s.round++;
      // The rounds are told apart on the page by a pause.
      const editor = this.page.editor;
      if (editor && this.page.blocks().length) insertSprintPause(editor.state, editor.dispatch);
      if (s.prefs.breakMinutes > 0) this.timer.run(s.prefs.breakMinutes * 60_000, 'break', () => this.startRound());
      else this.startRound();
      return;
    }
    this.session = null;
    this.timer.complete();
    // The line finishes and glows; partway through, the question.
    window.setTimeout(() => { if (this.active && !this.keep.isOpen) void this.end(); }, cssNumber('--dur-sprint-glow') / 2);
  }

  /** End the sprint: ask where its writing goes (nothing written: just leave). */
  async end() {
    if (!this.page.isOpen) { this.h.setMode('manuscript'); return; }
    if (this.page.blocks().length === 0) {
      if (await this.page.finish('discarded')) this.leave();
      return;
    }
    void this.page.flush();
    this.pausedForKeep = this.timer.running && !this.timer.paused;
    this.timer.pause(); // no round ends while the writer decides
    this.ask();
  }

  /** A sprint the app quit or crashed during: ask about it, as if it had just ended. */
  async recover() {
    const record = await this.h.bridge.unfinishedSprint();
    if (!record || this.page.isOpen) return;
    let blocks: Block[];
    try {
      blocks = await this.h.bridge.readSprint(record.id);
    } catch {
      // Left exactly as it is: offered again next time.
      this.h.toast('An unfinished sprint couldn’t be read just now. It’s kept safe and will be offered again.', 'error');
      return;
    }
    // A sprint begun meanwhile is never taken over (an older one waits for the next launch).
    if (this.page.isOpen) return;
    this.page.resume(record, blocks);
    // Nothing was written: nothing to ask about (the app never opens in a sprint).
    if (!blocks.length) { await this.page.finish('discarded'); return; }
    this.h.setMode('sprinter');
    this.ask();
  }

  private leave() {
    this.session = null;
    this.timer.stop();
    this.page.close();
    this.h.setMode('manuscript');
  }

  // ── where the writing goes ──

  /** The sprint just written. (Esc: back to writing.) */
  private ask() {
    void this.keep.open({
      title: 'Keep this sprint?',
      words: this.page.words(),
      choices: ['chapter', 'end', 'cold', 'sprints', 'discard'],
      back: 'Keep writing',
      choose: (choice, target) => this.keepFromPage(choice, target),
      onBack: () => {
        if (!this.page.isOpen) return;
        this.h.setMode('sprinter');
        if (this.pausedForKeep) this.timer.resume();
        this.pausedForKeep = false;
        this.page.focus();
      },
    });
  }

  private async keepFromPage(choice: KeepChoice, target: KeepTarget | null): Promise<boolean> {
    // The writing is on disk before anything else happens to it.
    if (!(await this.page.flush())) return false;
    if (inBook(choice)) {
      if (!(await this.place(this.page.blocks(), this.page.record!, choice, target!))) return false;
      // "Placed" only once the book holding it is on disk; until then it stays in Sprints.
      const status = (await this.h.saveBook()) ? 'placed' : 'kept';
      if (!(await this.page.finish(status))) this.h.toast('The sprint was added, but its record couldn’t be updated.', 'error');
      this.leave();
      return true;
    }
    if (!(await this.page.finish(choice === 'sprints' ? 'kept' : 'discarded'))) return false;
    this.leave();
    this.h.toast(choice === 'sprints' ? 'Sprint kept in Sprints.' : 'Sprint discarded.');
    return true;
  }

  /** From the library: the same chooser, the book's choices only (Back: the library again). */
  private placeFromLibrary(record: SprintRecord, blocks: Block[]) {
    void this.keep.open({
      title: 'Add to book',
      words: record.words,
      choices: ['chapter', 'end', 'cold'],
      back: 'Back',
      choose: async (choice, target) => {
        if (!inBook(choice) || !(await this.place(blocks, record, choice, target!))) return false;
        // "Placed" only once the book holding it is on disk; until then it stays in Sprints.
        if (await this.h.saveBook()) {
          const recorded = await this.h.bridge.writeSprint({ ...record, status: 'placed' }, null);
          if (!recorded.ok) this.h.toast('The sprint was added, but its record couldn’t be updated.', 'error');
        }
        this.h.focusBook();
        return true;
      },
      onBack: () => void this.library.open(record.id),
    });
  }

  /**
   * Put writing into a book as a new scene (named for what it was in Cold
   * Storage), opening that book first if it isn't the one open. One undoable
   * step; says where it went. False if it could not be placed.
   */
  private async place(blocks: Block[], record: SprintRecord, choice: BookChoice, target: KeepTarget): Promise<boolean> {
    if (!(await this.h.openBook(target.book))) return false;
    const view = this.h.view();
    if (!view) return false;
    const chapters = outlineOf(view.state.doc).chapters;
    const chapter = choice === 'chapter' ? chapters[target.chapter] : chapters.at(-1);
    if (!chapter) { this.h.toast('That chapter is no longer there; nothing was added.', 'error'); return false; }
    const where = choice === 'chapter' ? { to: 'chapter' as const, chapterId: chapter.id } : { to: choice };
    const name = choice === 'cold' ? sprintName(record.prefs, record.started) : null;
    if (!placeSprint(blocks, where, name)(view.state, view.dispatch)) { this.h.toast('Couldn’t add the sprint there.', 'error'); return false; }
    this.h.toast(choice === 'cold' ? 'Sprint moved to Cold Storage. ⌘Z undoes it.' : `Sprint added to the end of chapter ${chapter.number}. ⌘Z undoes it.`);
    return true;
  }

  /** A book's chapters: the open one as it is in the window (suggesting the caret's chapter); another, read from disk. */
  private async chapters(book: string): Promise<{ titles: string[]; suggested: number } | null> {
    const view = this.h.view();
    if (book === this.h.filePath() && view) {
      const chapters = outlineOf(view.state.doc).chapters;
      const here = currentScene(view.state);
      const at = here ? chapters.findIndex((c) => c.id === here.chapter.id) : -1;
      return { titles: chapters.map((c) => c.title), suggested: at >= 0 ? at : chapters.length - 1 };
    }
    const titles = await this.h.bridge.bookChapters(book);
    return titles ? { titles, suggested: titles.length - 1 } : null;
  }

  /** For tests. */
  state() {
    return {
      phase: this.timer.phase, paused: this.timer.paused, hidden: this.timer.hidden, round: this.session?.round ?? null,
      open: this.page.isOpen, record: this.page.record, blocks: this.page.blocks(), words: this.page.words(),
      keep: this.keep.isOpen, focused: this.page.editor?.hasFocus() ?? false,
    };
  }

  get libraryOpen(): boolean {
    return this.library.isOpen;
  }
}
