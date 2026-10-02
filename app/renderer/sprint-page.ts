// The sprint page (DECISIONS §21): a clean slate over the workspace, with its
// own editor and typewriter. The manuscript underneath is never touched by
// it. Its writing is saved as it is written (a short pause after each
// change), so quitting or crashing mid-sprint loses nothing.

import { EditorView } from 'prosemirror-view';
import { createSprintState, sprintBlocks, sprintWords } from '@baretext/editor';
import { newId, type Block } from '@baretext/format';
import type { BaretextBridge, SprintPrefs, SprintRecord, SprintStatus } from '../shared/bridge';
import { Typewriter } from './typewriter';

const SAVE_DELAY_MS = 400;

export interface SprintPageHost {
  bridge: BaretextBridge;
  /** The manuscript open now (recorded with the sprint). */
  book(): string | null;
  /** The page's writing changed (for the word count). */
  onChange(words: number): void;
  onError(message: string): void;
}

export class SprintPage {
  readonly el: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly page: HTMLElement;
  readonly typewriter: Typewriter;
  private view: EditorView | null = null;
  private current: SprintRecord | null = null;
  private timer: number | undefined;
  private writing: Promise<boolean> = Promise.resolve(true);
  private dirty = false;

  constructor(host: HTMLElement, private readonly h: SprintPageHost) {
    this.el = document.createElement('div');
    this.el.className = 'bt-sprint-page';
    this.el.dataset.open = 'false';
    this.el.innerHTML = `
      <div class="bt-tw-guide bt-tw-guide-left" aria-hidden="true"></div>
      <div class="bt-tw-guide bt-tw-guide-right" aria-hidden="true"></div>
      <div class="bt-scroller"><div class="bt-page"></div></div>`;
    host.append(this.el);
    this.scroller = this.el.querySelector('.bt-scroller')!;
    this.page = this.el.querySelector('.bt-page')!;
    this.typewriter = new Typewriter(this.el, this.scroller, this.page, () => this.view);
  }

  get record(): SprintRecord | null {
    return this.current;
  }

  get isOpen(): boolean {
    return this.el.dataset.open === 'true';
  }

  get editor(): EditorView | null {
    return this.view;
  }

  blocks(): Block[] {
    return this.view ? sprintBlocks(this.view.state.doc) : [];
  }

  words(): number {
    return this.view ? sprintWords(this.view.state.doc) : 0;
  }

  /** A new sprint: a blank page, saved at once so it is known even if nothing is written. */
  start(prefs: SprintPrefs) {
    const now = Date.now();
    this.open({ id: newId(), status: 'active', started: now, updated: now, words: 0, book: this.h.book(), prefs }, []);
    this.dirty = true;
    void this.flush();
  }

  /** Back to a sprint (one recovered after a crash or quit). */
  resume(record: SprintRecord, blocks: Block[]) {
    this.open({ ...record, status: 'active' }, blocks);
  }

  private open(record: SprintRecord, blocks: Block[]) {
    this.current = record;
    const state = createSprintState(blocks);
    if (this.view) this.view.updateState(state);
    else {
      this.view = new EditorView(this.page, {
        state,
        dispatchTransaction: (tr) => this.dispatch(tr),
        attributes: { spellcheck: 'false', 'aria-label': 'Sprint', 'aria-multiline': 'true', role: 'textbox', class: 'bt-sprint-editor' },
        handleScrollToSelection: () => this.typewriter.enabled,
      });
    }
    this.el.dataset.open = 'true';
    this.typewriter.setEnabled(true);
    this.h.onChange(this.words());
    this.focus();
  }

  focus() {
    this.view?.focus();
    this.typewriter.recenter(false);
  }

  private dispatch(tr: Parameters<EditorView['dispatch']>[0]) {
    const view = this.view!;
    view.updateState(view.state.apply(tr));
    if (tr.docChanged) {
      this.dirty = true;
      this.h.onChange(this.words());
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.flush(), SAVE_DELAY_MS);
    }
    if (tr.docChanged || tr.selectionSet) this.typewriter.recenter(tr.docChanged);
  }

  /** Save now (and wait for any save under way). True when everything is on disk. */
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (!this.current || !this.dirty) return this.writing;
    this.dirty = false;
    const record = { ...this.current, words: this.words() };
    const blocks = this.blocks();
    this.writing = this.writing.then(async () => {
      const result = await this.h.bridge.writeSprint(record, blocks);
      if (!result.ok) { this.dirty = true; this.h.onError(result.message ?? 'Could not save the sprint.'); }
      return result.ok;
    });
    return this.writing;
  }

  /**
   * End the sprint as `status` (its writing saved first, with the new
   * status); the page closes. False, leaving it open, if it could not be saved.
   */
  async finish(status: Exclude<SprintStatus, 'active'>): Promise<boolean> {
    if (!this.current) return true;
    this.current = { ...this.current, status };
    this.dirty = true;
    if (!(await this.flush())) { this.current = { ...this.current, status: 'active' }; return false; }
    this.close();
    return true;
  }

  close() {
    clearTimeout(this.timer);
    this.current = null;
    this.typewriter.setEnabled(false);
    this.el.dataset.open = 'false';
  }
}
