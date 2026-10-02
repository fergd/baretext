// Where a sprint's writing goes (DECISIONS §21): into a book — any of the
// writer's manuscripts — as a new scene (at the end of a chapter, or of the
// book), into that book's Cold Storage, kept in Sprints, or discarded.
// Nothing is chosen for the writer; Discard asks twice. Asked when a sprint
// ends (Esc: keep writing) and from the Sprints library (Esc: back to it);
// each asker says which choices apply.

import type { BookInfo } from '../shared/bridge';
import { arrowStep, Modal } from './modal';
import { numberFormat } from './dom';

export type KeepChoice = 'chapter' | 'end' | 'cold' | 'sprints' | 'discard';

/** Where in which book: a chapter by its position (ids differ between files). */
export interface KeepTarget {
  book: string;
  chapter: number;
}

export interface SprintKeepHost {
  /** The writer's manuscripts, the open one first. */
  books(): Promise<BookInfo[]>;
  /** Pick another manuscript (the file dialog); null if cancelled. */
  chooseBook(): Promise<BookInfo | null>;
  /** A book's chapter titles, and the chapter to suggest; null if it can't be read. */
  chapters(book: BookInfo): Promise<{ titles: string[]; suggested: number } | null>;
}

export interface KeepRequest {
  title: string;
  words: number;
  choices: readonly KeepChoice[];
  /** The way back's label (Esc does the same). */
  back: string;
  /** Resolves true when the choice was carried out (the panel then closes). */
  choose(choice: KeepChoice, target: KeepTarget | null): Promise<boolean>;
  onBack(): void;
}

const OTHER = '';

const OPTIONS: [KeepChoice, string][] = [
  ['chapter', 'End of chapter'],
  ['end', 'End of book'],
  ['cold', 'Cold Storage'],
  ['sprints', 'Sprints'],
  ['discard', 'Discard'],
];
const IN_A_BOOK = new Set<KeepChoice>(['chapter', 'end', 'cold']);

/**
 * How each book is named in the picker: its title; where titles repeat, with
 * its file name; where those repeat too, with its folder as well.
 */
export function bookLabels(books: readonly BookInfo[]): string[] {
  const tail = (p: string, parts: number) => p.split('/').slice(-parts).join('/');
  return books.map((b) => {
    const twins = books.filter((o) => o.title === b.title);
    if (twins.length === 1) return b.title;
    const sameName = twins.filter((o) => tail(o.path, 1) === tail(b.path, 1));
    return `${b.title} — ${tail(b.path, sameName.length > 1 ? 2 : 1)}`;
  });
}

const chapterLabel = (title: string, i: number) => (title ? `${i + 1} · ${title}` : `${i + 1}`);

export class SprintKeep {
  private readonly modal: Modal;
  readonly el: HTMLElement;
  private readonly bookSelect: HTMLSelectElement;
  private readonly chapterSelect: HTMLSelectElement;
  private request: KeepRequest | null = null;
  private books: BookInfo[] = [];
  private book: BookInfo | null = null;
  private chapterTitles: string[] = [];
  private choice: KeepChoice | null = null;
  private armed = false;
  private busy = false;
  private loading = 0;

  constructor(host: HTMLElement, private readonly h: SprintKeepHost) {
    this.modal = new Modal(host, { className: 'bt-appearance bt-sprint bt-keep', labelledBy: 'bt-keep-title', onDismiss: () => this.back() });
    this.el = this.modal.el;
    this.el.innerHTML = `
      <header class="bt-appearance-head">
        <span class="bt-appearance-title" id="bt-keep-title"></span>
        <span class="bt-keep-words"></span>
      </header>
      <div class="bt-sprint-body">
        <label class="bt-keep-book">
          <span class="bt-keep-book-label">Book</span>
          <select class="bt-keep-select bt-keep-book-select bt-field" aria-label="Book"></select>
        </label>
        <div role="radiogroup" aria-labelledby="bt-keep-title" class="bt-keep-options">${OPTIONS.map(([value, label]) => `
          <div class="bt-keep-option" data-value="${value}">
            <button type="button" role="radio" class="bt-keep-radio" data-value="${value}" aria-checked="false"><span class="bt-keep-dot" aria-hidden="true"></span>${label}</button>
            ${value === 'chapter' ? '<select class="bt-keep-select bt-keep-chapter-select bt-field" aria-label="Chapter"></select>' : value === 'end' ? '<span class="bt-keep-detail" data-detail="end"></span>' : ''}
          </div>`).join('')}
        </div>
      </div>
      <footer class="bt-appearance-foot">
        <button type="button" class="bt-appearance-button bt-sprint-button bt-keep-back" data-action="back"><span class="bt-keep-back-label"></span><kbd>esc</kbd></button>
        <button type="button" class="bt-appearance-button bt-appearance-primary bt-sprint-button" data-action="done" disabled>Done<kbd>↵</kbd></button>
      </footer>`;
    this.bookSelect = this.el.querySelector('.bt-keep-book-select')!;
    this.chapterSelect = this.el.querySelector('.bt-keep-chapter-select')!;

    this.bookSelect.addEventListener('change', () => void this.changeBook());
    this.chapterSelect.addEventListener('change', () => this.pick('chapter'));
    this.chapterSelect.addEventListener('mousedown', () => { if (this.choice !== 'chapter') this.pick('chapter'); });
    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const radio = target.closest<HTMLElement>('[role="radio"]');
      if (radio) { this.pick(radio.dataset.value as KeepChoice); return; }
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'done') void this.done();
      else if (action === 'back') this.back();
    });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  /** Ask; the panel shows once the writer's books are known (the open one chosen). */
  async open(request: KeepRequest) {
    this.request = request;
    this.choice = null;
    this.armed = false;
    this.el.querySelector('#bt-keep-title')!.textContent = request.title;
    this.el.querySelector('.bt-keep-back-label')!.textContent = request.back;
    this.el.querySelector('.bt-keep-words')!.textContent = `${numberFormat.format(request.words)} ${request.words === 1 ? 'word' : 'words'}`;
    for (const option of this.el.querySelectorAll<HTMLElement>('.bt-keep-option')) option.hidden = !request.choices.includes(option.dataset.value as KeepChoice);
    this.books = await this.h.books();
    this.renderBooks(this.books.find((b) => b.current) ?? this.books[0] ?? null);
    await this.loadChapters();
    this.reflect();
    this.modal.show();
    this.radios()[0]!.focus();
  }

  close() {
    this.modal.hide();
  }

  // ── the book, and its chapters ──

  /** The book list (repeated titles told apart), then Other…. */
  private renderBooks(selected: BookInfo | null) {
    this.book = selected;
    const labels = bookLabels(this.books);
    this.bookSelect.replaceChildren(
      ...this.books.map((b, i) => new Option(labels[i], b.path, false, b === selected)),
      new Option('Other…', OTHER),
    );
  }

  private async changeBook() {
    if (this.bookSelect.value === OTHER) {
      const chosen = await this.h.chooseBook();
      if (!chosen) { this.bookSelect.value = this.book?.path ?? ''; return; }
      if (!this.books.some((b) => b.path === chosen.path)) this.books.push(chosen);
      this.renderBooks(this.books.find((b) => b.path === chosen.path)!);
    } else {
      this.book = this.books.find((b) => b.path === this.bookSelect.value) ?? null;
    }
    await this.loadChapters();
    this.reflect();
  }

  private async loadChapters() {
    const token = ++this.loading;
    this.reflect();
    const book = this.book;
    const result = book ? await this.h.chapters(book) : null;
    if (token !== this.loading) return; // another book was chosen meanwhile
    this.loading = 0;
    this.chapterTitles = result?.titles ?? [];
    this.chapterSelect.replaceChildren(...this.chapterTitles.map((t, i) => new Option(chapterLabel(t, i), String(i), false, i === result?.suggested)));
    const last = this.chapterTitles.length - 1;
    this.el.querySelector('[data-detail="end"]')!.textContent = last >= 0 ? chapterLabel(this.chapterTitles[last]!, last) : '';
  }

  // ── choosing ──

  /** The choices on offer now. */
  private radios(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>('.bt-keep-option:not([hidden]) [role="radio"]')];
  }

  private back() {
    if (this.busy) return;
    this.close();
    this.request?.onBack();
  }

  private pick(choice: KeepChoice) {
    if (this.choice !== choice) this.armed = false;
    this.choice = choice;
    this.reflect();
  }

  /** Whether the current choice can be carried out now. */
  private get ready(): boolean {
    if (!this.choice) return false;
    if (!IN_A_BOOK.has(this.choice)) return true;
    return !this.loading && !!this.book && this.chapterTitles.length > 0;
  }

  private async done() {
    if (!this.ready || this.busy) return;
    const choice = this.choice!;
    // Discarding asks twice: the first press arms it.
    if (choice === 'discard' && !this.armed) { this.armed = true; this.reflect(); return; }
    const target = IN_A_BOOK.has(choice) ? { book: this.book!.path, chapter: Number(this.chapterSelect.value) } : null;
    this.busy = true;
    try {
      if (await this.request!.choose(choice, target)) this.close();
    } finally {
      this.busy = false;
    }
  }

  private reflect() {
    const radios = this.radios();
    for (const r of radios) {
      const on = r.dataset.value === this.choice;
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on || (!this.choice && r === radios[0]) ? 0 : -1;
    }
    this.el.dataset.choice = this.choice ?? '';
    // The book matters only for the choices that go into one.
    this.el.querySelector<HTMLElement>('.bt-keep-book')!.dataset.inactive = String(!!this.choice && !IN_A_BOOK.has(this.choice));
    const done = this.el.querySelector<HTMLButtonElement>('[data-action="done"]')!;
    done.disabled = !this.ready;
    done.dataset.danger = String(this.choice === 'discard');
    done.firstChild!.textContent = this.choice === 'discard' ? (this.armed ? 'Discard for good' : 'Discard') : 'Done';
  }

  private onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    const target = e.target as HTMLElement;
    if (e.key === 'Enter') {
      if (target.closest('[data-action="back"]') || target instanceof HTMLSelectElement) return;
      e.preventDefault();
      void this.done();
      return;
    }
    const radio = target.closest<HTMLElement>('[role="radio"]');
    const next = radio && arrowStep(e, this.radios(), radio);
    if (!next) return;
    this.pick(next.dataset.value as KeepChoice);
    next.focus();
  }
}
