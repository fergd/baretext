// Book setup (DECISIONS §26): the book's title, author, story structure and
// target length. Asked when a new book is made; File › Book Settings… later.
// Done (or ↵) applies it as one undoable change; Esc leaves it as it was.
// Built from the Appearance panel's parts.

import { isTarget } from '@baretext/format';
import type { BookSetup } from '@baretext/editor';
import { Modal } from './modal';
import { numberFormat } from './dom';
import { STRUCTURES } from './structures';

export interface BookSetupHost {
  current(): BookSetup;
  /** The author last used (a new book's default). */
  lastAuthor(): string;
  apply(setup: BookSetup): void;
  onClose(): void;
}

/** A target as typed ("90,000", "90000", blank): its words, null for none, NaN if it isn't one. */
export function readTarget(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = /^\d{1,3}(?:[, ]?\d{3})*$/.test(t) || /^\d+$/.test(t) ? Number(t.replace(/[, ]/g, '')) : NaN;
  return isTarget(n) ? n : NaN;
}

export class BookSetupPanel {
  private readonly modal: Modal;
  readonly el: HTMLElement;
  private readonly title: HTMLInputElement;
  private readonly author: HTMLInputElement;
  private readonly structure: HTMLSelectElement;
  private readonly target: HTMLInputElement;
  private readonly done: HTMLButtonElement;

  constructor(host: HTMLElement, private readonly h: BookSetupHost) {
    this.modal = new Modal(host, { className: 'bt-appearance bt-book', labelledBy: 'bt-book-title', onDismiss: () => this.close() });
    this.el = this.modal.el;
    this.el.innerHTML = `
      <header class="bt-appearance-head"><span class="bt-appearance-title" id="bt-book-title"></span></header>
      <div class="bt-book-body">
        <label class="bt-appearance-group">
          <span class="bt-appearance-label">Title</span>
          <input type="text" class="bt-field" data-field="title" placeholder="Untitled" spellcheck="false" autocomplete="off">
        </label>
        <label class="bt-appearance-group">
          <span class="bt-appearance-label">Author</span>
          <input type="text" class="bt-field" data-field="author" placeholder="Your name" spellcheck="false" autocomplete="name">
        </label>
        <div class="bt-book-pair">
          <label class="bt-appearance-group">
            <span class="bt-appearance-label">Structure</span>
            <select class="bt-field" data-field="structure"></select>
          </label>
          <label class="bt-appearance-group">
            <span class="bt-appearance-label">Target length</span>
            <span class="bt-field bt-book-target">
              <input type="text" data-field="target" inputmode="numeric" placeholder="None" spellcheck="false" autocomplete="off">
              <span class="bt-book-unit">words</span>
            </span>
          </label>
        </div>
      </div>
      <footer class="bt-appearance-foot">
        <button type="button" class="bt-appearance-button bt-sprint-button" data-action="cancel">Cancel<kbd>esc</kbd></button>
        <button type="button" class="bt-appearance-button bt-appearance-primary bt-sprint-button" data-action="done">Done<kbd>↵</kbd></button>
      </footer>`;
    const field = <T extends HTMLElement>(name: string) => this.el.querySelector<T>(`[data-field="${name}"]`)!;
    this.title = field('title');
    this.author = field('author');
    this.structure = field('structure');
    this.target = field('target');
    this.done = this.el.querySelector('[data-action="done"]')!;

    this.target.addEventListener('input', () => this.reflect());
    // Once typed, the target reads as a number does ("90,000").
    this.target.addEventListener('blur', () => { const n = readTarget(this.target.value); if (n) this.target.value = numberFormat.format(n); });
    this.el.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'done') this.finish();
      else if (action === 'cancel') this.close();
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && (e.target as HTMLElement).matches('input')) { e.preventDefault(); this.finish(); }
    });
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  /** Show the book's setup; `isNew`: just made (its author defaults to the last one used). */
  open(isNew = false) {
    if (this.isOpen) return;
    const s = this.h.current();
    this.el.querySelector('#bt-book-title')!.textContent = isNew ? 'New book' : 'Book';
    this.title.value = s.title;
    this.author.value = s.author || (isNew ? this.h.lastAuthor() : '');
    // A structure this app doesn't know (a newer one's) stays, by its id.
    const known = STRUCTURES.some((x) => x.id === s.structure);
    this.structure.replaceChildren(
      new Option('None', ''),
      ...STRUCTURES.map((x) => new Option(x.name, x.id)),
      ...(s.structure && !known ? [new Option(s.structure, s.structure)] : []),
    );
    this.structure.value = s.structure ?? '';
    this.target.value = s.target ? numberFormat.format(s.target) : '';
    this.reflect();
    this.modal.show();
    this.title.focus();
    this.title.select();
  }

  close() {
    if (!this.isOpen) return;
    this.modal.hide();
    this.h.onClose();
  }

  private finish() {
    const target = readTarget(this.target.value);
    if (Number.isNaN(target)) { this.target.focus(); return; }
    this.h.apply({ title: this.title.value, author: this.author.value, structure: this.structure.value || null, target });
    this.close();
  }

  /** A target that isn't a number of words says so, and Done waits. */
  private reflect() {
    const bad = Number.isNaN(readTarget(this.target.value));
    this.target.parentElement!.dataset.invalid = String(bad);
    this.target.setAttribute('aria-invalid', String(bad));
    this.done.disabled = bad;
  }
}
