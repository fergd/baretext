// Saving (spec §10): autosave half a second after the last change, the
// caret a little later, ⌘S at once, and a flush before quitting. Saves run
// one after another, each writing the manuscript as it is when it runs.
//
// A save that fails stays in view until it is resolved: a notice explains
// what happened and offers the way out. A refused large deletion (the
// destructive-save guard) offers Undo or a two-step Save anyway; any other
// failure offers Try again.

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { undo } from 'prosemirror-history';
import { docToModel } from '@baretext/editor';
import type { BaretextBridge, SaveResult } from '../shared/bridge';

const AUTOSAVE_MS = 500;
const CARET_SAVE_MS = 2000;
/** How long an armed "Save anyway" waits for its confirmation. */
const ARM_MS = 4000;

export class Saver {
  private saveTimer: number | undefined;
  private caretTimer: number | undefined;
  private chain: Promise<boolean> = Promise.resolve(true);
  private savedDoc: PMNode | null = null;
  private armTimer: number | undefined;
  private readonly notice: HTMLElement;
  private readonly noticeText: HTMLElement;
  private readonly noticeActions: HTMLElement;

  constructor(
    private readonly bridge: BaretextBridge,
    private readonly getView: () => EditorView | null,
    private readonly getFilePath: () => string | null,
    private readonly stateEl: HTMLElement,
    host: HTMLElement,
  ) {
    this.notice = document.createElement('div');
    this.notice.className = 'bt-notice';
    this.notice.setAttribute('role', 'alert');
    this.notice.dataset.ref = 'notice';
    this.notice.hidden = true;
    this.notice.innerHTML = '<p class="bt-notice-text"></p><div class="bt-notice-actions"></div>';
    this.noticeText = this.notice.querySelector('.bt-notice-text')!;
    this.noticeActions = this.notice.querySelector('.bt-notice-actions')!;
    host.append(this.notice);
  }

  /** A freshly opened document: nothing to save, nothing pending. */
  reset(doc: PMNode) {
    clearTimeout(this.saveTimer);
    clearTimeout(this.caretTimer);
    this.savedDoc = doc;
    this.setState('saved');
    this.hideNotice();
  }

  isSaved(doc: PMNode): boolean {
    return doc === this.savedDoc;
  }

  /** The manuscript changed: save shortly. */
  changed() {
    this.setState('unsaved');
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), AUTOSAVE_MS);
  }

  /** Only the caret moved: remember it a little later. */
  caretMoved() {
    clearTimeout(this.caretTimer);
    this.caretTimer = window.setTimeout(() => void this.saveNow(), CARET_SAVE_MS);
  }

  /** Save now, after any save already under way. `force` only after the writer confirmed. */
  saveNow(force = false): Promise<boolean> {
    clearTimeout(this.saveTimer);
    clearTimeout(this.caretTimer);
    const run = this.chain.then(() => this.save(force));
    this.chain = run.catch(() => false);
    return run;
  }

  private async save(force: boolean): Promise<boolean> {
    const view = this.getView();
    const filePath = this.getFilePath();
    if (!view || !filePath) return true;
    const doc = view.state.doc;
    this.setState('saving');
    let result: SaveResult;
    try {
      result = await this.bridge.save(filePath, docToModel(doc), view.state.selection.head, force);
    } catch (e) {
      result = { ok: false, reason: 'io', message: (e as Error).message };
    }
    if (result.ok) {
      this.savedDoc = doc;
      this.setState(this.getView()?.state.doc === doc ? 'saved' : 'unsaved');
      this.hideNotice();
      return true;
    }
    this.setState('error', result.message);
    this.showFailure(result);
    return false;
  }

  private setState(state: 'saved' | 'unsaved' | 'saving' | 'error', message = '') {
    this.stateEl.dataset.state = state;
    this.stateEl.textContent = state === 'error' ? 'not saved' : state === 'saving' || state === 'unsaved' ? '•' : '';
    this.stateEl.title = message;
  }

  // ── the notice ──

  private showFailure(result: Extract<SaveResult, { ok: false }>) {
    clearTimeout(this.armTimer);
    if (result.reason === 'destructive') {
      this.noticeText.textContent = 'Not saved: this change removes most of the manuscript. The file still has the earlier text.';
      this.noticeActions.replaceChildren(
        this.button('Undo', () => {
          const view = this.getView();
          if (view) { undo(view.state, view.dispatch); view.focus(); }
        }),
        this.armedButton('Save anyway', 'Confirm: save', () => void this.saveNow(true)),
      );
    } else {
      this.noticeText.textContent = `Not saved: ${result.message} Your text is safe in the window.`;
      this.noticeActions.replaceChildren(this.button('Try again', () => void this.saveNow()));
    }
    this.notice.hidden = false;
  }

  private hideNotice() {
    clearTimeout(this.armTimer);
    this.notice.hidden = true;
  }

  private button(label: string, run: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bt-notice-button';
    b.textContent = label;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // the caret stays in the manuscript
    b.addEventListener('click', run);
    return b;
  }

  /** Two steps (spec §0.8): the first click arms, the second (within a few seconds) acts. */
  private armedButton(label: string, armedLabel: string, run: () => void): HTMLButtonElement {
    const b = this.button(label, () => {
      if (b.dataset.armed === 'true') { delete b.dataset.armed; clearTimeout(this.armTimer); run(); return; }
      b.dataset.armed = 'true';
      b.textContent = armedLabel;
      clearTimeout(this.armTimer);
      this.armTimer = window.setTimeout(() => { delete b.dataset.armed; b.textContent = label; }, ARM_MS);
    });
    return b;
  }
}
