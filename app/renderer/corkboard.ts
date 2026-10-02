// The corkboard (spec §8.2, DECISIONS §24): the whole book as scene cards,
// grouped by chapter, in place of the page — chapters as rows of cards, or
// as columns — under its own toolbar. A single click on a card only gives it
// the keyboard (cards carry their own actions); a scene opens only by ↵,
// double-click, or its Open action. Arrow keys move between cards as they
// sit on the board; Esc goes back to the manuscript.

import type { CorkboardLayout } from '../shared/bridge';
import type { Outline, SceneEntry } from './outline';
import { sceneDisplayName } from './outline';
import { numberFormat } from './dom';

/** Below this, a scene is shown as a draft. */
export const DRAFT_WORDS = 20;

export interface CorkboardHost {
  /** Open a scene in the manuscript (the board closes). */
  open(sceneId: string): void;
  /** Back to the manuscript, where it was. */
  close(): void;
  /** Open notes per scene id. */
  noteCounts(): Map<string, number>;
  /** The writer chose a layout (remember it). */
  onLayout(layout: CorkboardLayout): void;
}

const LAYOUTS: [CorkboardLayout, string][] = [['rows', 'Rows'], ['columns', 'Columns']];

const words = (n: number) => `${numberFormat.format(n)} ${n === 1 ? 'word' : 'words'}`;

export class Corkboard {
  readonly el: HTMLElement;
  /** The cards' area (the toolbar stays put above it). */
  private readonly board: HTMLElement;
  private readonly summary: HTMLElement;
  private outline: Outline | null = null;
  private rendered: Outline | null = null;
  /** The card that holds the board's single tab stop. */
  private focusId: string | null = null;

  constructor(host: HTMLElement, private readonly h: CorkboardHost, layout: CorkboardLayout = 'rows') {
    this.el = document.createElement('div');
    this.el.className = 'bt-corkboard';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Corkboard');
    this.el.dataset.open = 'false';
    this.el.innerHTML = `
      <div class="bt-cork-bar" role="toolbar" aria-label="Corkboard">
        <div class="bt-seg" role="radiogroup" aria-label="Layout">${LAYOUTS.map(([value, label]) => `
          <button type="button" role="radio" class="bt-seg-item" data-layout="${value}" aria-checked="false">${label}</button>`).join('')}
        </div>
        <span class="bt-cork-summary"></span>
      </div>
      <div class="bt-cork-board" tabindex="-1"></div>`; // (a click on its background keeps the keyboard here: Esc closes it)
    host.append(this.el);
    this.board = this.el.querySelector('.bt-cork-board')!;
    this.summary = this.el.querySelector('.bt-cork-summary')!;
    this.setLayout(layout);

    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const layoutChoice = target.closest<HTMLElement>('[role="radio"][data-layout]'); // (not the board, which carries its layout too)
      if (layoutChoice) { this.chooseLayout(layoutChoice.dataset.layout as CorkboardLayout); return; }
      const card = target.closest<HTMLElement>('.bt-cork-card');
      if (!card) return;
      if (target.closest('[data-action="open"]')) this.h.open(card.dataset.id!);
      else this.focusCard(card.dataset.id!); // a click only gives the card the keyboard
    });
    this.el.addEventListener('dblclick', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.bt-cork-card');
      if (card && !(e.target as HTMLElement).closest('button')) this.h.open(card.dataset.id!);
    });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return this.el.dataset.open === 'true';
  }

  /** Show the board, the keyboard on `sceneId`'s card (the scene the writer was in). */
  open(outline: Outline, sceneId: string | null) {
    this.outline = outline;
    this.focusId = sceneId;
    this.rendered = null; // (note counts may have changed while it was closed)
    this.render();
    this.el.dataset.open = 'true';
    const card = this.card(this.focusId) ?? this.cards()[0];
    if (card) {
      this.focusCard(card.dataset.id!);
      card.scrollIntoView({ block: 'center' });
    }
  }

  close() {
    this.el.dataset.open = 'false';
  }

  get layout(): CorkboardLayout {
    return this.el.dataset.layout as CorkboardLayout;
  }

  private setLayout(layout: CorkboardLayout) {
    this.el.dataset.layout = layout;
    for (const r of this.el.querySelectorAll<HTMLElement>('[role="radio"][data-layout]')) {
      const on = r.dataset.layout === layout;
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on ? 0 : -1;
    }
  }

  /** Rows or columns: the same cards, the keyboard staying on its card. */
  private chooseLayout(layout: CorkboardLayout) {
    if (layout === this.layout) return;
    this.setLayout(layout);
    this.h.onLayout(layout);
    this.card(this.focusId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** The book changed: redraw (keeping the scroll and the focused card). */
  update(outline: Outline) {
    this.outline = outline;
    if (this.isOpen) this.render();
  }

  private render() {
    const outline = this.outline;
    if (!outline || outline === this.rendered) return;
    this.rendered = outline;
    const hadFocus = this.board.contains(document.activeElement);
    const [scrollTop, scrollLeft] = [this.board.scrollTop, this.board.scrollLeft];
    const notes = this.h.noteCounts();
    const sections = outline.chapters.map((chapter) => {
      const section = document.createElement('section');
      section.className = 'bt-cork-chapter';
      section.setAttribute('aria-label', `Chapter ${chapter.number}`);
      const head = document.createElement('header');
      head.className = 'bt-cork-chapter-head';
      const chapterWords = chapter.scenes.reduce((n, s) => n + s.words, 0);
      head.append(
        Object.assign(document.createElement('span'), { className: 'bt-cork-chapter-number', textContent: String(chapter.number) }),
        Object.assign(document.createElement('h2'), { className: 'bt-cork-chapter-title', textContent: chapter.title || 'Untitled' }),
        Object.assign(document.createElement('span'), { className: 'bt-cork-chapter-meta', textContent: `${chapter.scenes.length} ${chapter.scenes.length === 1 ? 'scene' : 'scenes'} · ${words(chapterWords)}` }),
      );
      const grid = document.createElement('div');
      grid.className = 'bt-cork-grid';
      grid.setAttribute('role', 'list');
      grid.append(...chapter.scenes.map((scene) => this.cardFor(scene, notes.get(scene.id) ?? 0)));
      section.append(head, grid);
      return section;
    });
    this.board.replaceChildren(...sections);
    [this.board.scrollTop, this.board.scrollLeft] = [scrollTop, scrollLeft]; // a refresh never moves the board
    const scenes = outline.chapters.reduce((n, c) => n + c.scenes.length, 0);
    this.summary.textContent = `${outline.chapters.length} ${outline.chapters.length === 1 ? 'chapter' : 'chapters'} · ${scenes} ${scenes === 1 ? 'scene' : 'scenes'} · ${words(outline.words)}`;
    if (!this.card(this.focusId)) this.focusId = this.cards()[0]?.dataset.id ?? null;
    this.setTabStop();
    if (hadFocus) this.card(this.focusId)?.focus({ preventScroll: true });
  }

  private cardFor(scene: SceneEntry, noteCount: number): HTMLElement {
    const card = document.createElement('article');
    card.className = 'bt-cork-card';
    card.setAttribute('role', 'listitem');
    card.dataset.id = scene.id;
    const draft = scene.words < DRAFT_WORDS;
    card.dataset.draft = String(draft);
    card.setAttribute('aria-label', `${scene.label} ${sceneDisplayName(scene)}, ${draft ? 'draft' : words(scene.words)}`);

    const head = document.createElement('div');
    head.className = 'bt-cork-card-head';
    const title = document.createElement('h3');
    title.className = 'bt-cork-card-title';
    title.dataset.unnamed = String(!scene.name);
    title.textContent = sceneDisplayName(scene);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'bt-cork-action';
    open.dataset.action = 'open';
    open.tabIndex = -1; // the card is the tab stop; ↵ opens
    open.textContent = 'Open';
    open.setAttribute('aria-label', `Open ${scene.label} in the manuscript`);
    head.append(Object.assign(document.createElement('span'), { className: 'bt-cork-card-number', textContent: scene.label }), title, open);

    const opening = document.createElement('p');
    opening.className = 'bt-cork-card-opening';
    opening.textContent = scene.opening;

    const foot = document.createElement('div');
    foot.className = 'bt-cork-card-foot';
    foot.append(Object.assign(document.createElement('span'), { className: 'bt-cork-card-words', textContent: draft ? 'Draft' : words(scene.words) }));
    if (noteCount) foot.append(Object.assign(document.createElement('span'), { className: 'bt-cork-card-notes', textContent: `${noteCount} ${noteCount === 1 ? 'note' : 'notes'}` }));

    card.append(head, opening, foot);
    return card;
  }

  // ── the keyboard ──

  private cards(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>('.bt-cork-card')];
  }

  private card(id: string | null): HTMLElement | null {
    return id ? this.el.querySelector<HTMLElement>(`.bt-cork-card[data-id="${CSS.escape(id)}"]`) : null;
  }

  private setTabStop() {
    for (const c of this.cards()) c.tabIndex = c.dataset.id === this.focusId ? 0 : -1;
  }

  private focusCard(id: string) {
    this.focusId = id;
    this.setTabStop();
    const card = this.card(id);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /**
   * The card an arrow points to, as the cards sit on the board. Along the
   * reading direction (→/← in rows, ↓/↑ in columns) the next card in book
   * order, across chapters; the other way, the nearest line of cards, then
   * the card closest across.
   */
  private neighbour(from: HTMLElement, key: string): HTMLElement | null {
    const cards = this.cards();
    const i = cards.indexOf(from);
    if (key === 'Home') return cards[0] ?? null;
    if (key === 'End') return cards.at(-1) ?? null;
    const columns = this.layout === 'columns';
    const along = columns ? { next: 'ArrowDown', prev: 'ArrowUp' } : { next: 'ArrowRight', prev: 'ArrowLeft' };
    if (key === along.next) return cards[i + 1] ?? null;
    if (key === along.prev) return cards[i - 1] ?? null;
    // Across: in rows, the row above or below; in columns, the column beside.
    const r = from.getBoundingClientRect();
    const forward = key === (columns ? 'ArrowRight' : 'ArrowDown');
    const lead = (b: DOMRect) => (columns ? b.left : b.top);
    const [start, end] = columns ? [r.left, r.right] : [r.top, r.bottom];
    const beyond = cards.map((c) => ({ c, b: c.getBoundingClientRect() }))
      .filter(({ b }) => (forward ? lead(b) >= end - 1 : (columns ? b.right : b.bottom) <= start + 1));
    if (!beyond.length) return null;
    const nearest = forward ? Math.min(...beyond.map(({ b }) => lead(b))) : Math.max(...beyond.map(({ b }) => lead(b)));
    const line = beyond.filter(({ b }) => Math.abs(lead(b) - nearest) < 1);
    const mid = (b: DOMRect) => (columns ? b.top + b.height / 2 : b.left + b.width / 2);
    return line.reduce((best, x) => (Math.abs(mid(x.b) - mid(r)) < Math.abs(mid(best.b) - mid(r)) ? x : best)).c;
  }

  private onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.h.close(); return; }
    const radio = (e.target as HTMLElement).closest<HTMLElement>('[role="radio"][data-layout]');
    if (radio && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      this.chooseLayout(this.layout === 'rows' ? 'columns' : 'rows');
      this.el.querySelector<HTMLElement>(`[role="radio"][data-layout="${this.layout}"]`)!.focus();
      return;
    }
    const card = (e.target as HTMLElement).closest<HTMLElement>('.bt-cork-card');
    if (!card || (e.target as HTMLElement).closest('button')) return;
    if (e.key === 'Enter') { e.preventDefault(); this.h.open(card.dataset.id!); return; }
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || e.metaKey || e.altKey) return;
    e.preventDefault();
    const next = this.neighbour(card, e.key);
    if (next) this.focusCard(next.dataset.id!);
  }
}
