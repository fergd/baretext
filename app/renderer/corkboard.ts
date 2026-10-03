// The corkboard (spec §8.2, DECISIONS §24): the whole book as scene cards,
// grouped by chapter, in place of the page — chapters as rows of cards, or
// as columns — under its own toolbar. A single click on a card only gives it
// the keyboard (a click on its title renames it); a scene opens only by ↵,
// double-click, or its Open action. Arrow keys move between cards as they
// sit on the board; Esc goes back to the manuscript.

import type { CorkboardLayout, MenuItem } from '../shared/bridge';
import type { ChapterEntry, Outline, SceneEntry } from './outline';
import { sceneDisplayName } from './outline';
import { Arming } from './arming';
import { BoardDrag } from './corkboard-drag';
import { numberFormat } from './dom';
import { glideFrom, glideMotion, measure } from './motion';
import { PLUS } from './icons';
import { beatName, structureOf } from './structures';
import { beatMenu, chosenBeat, CHOOSE_STRUCTURE } from './beat-menu';
import { ArcStrip, weighBook } from './arc';
import { InlineEdit } from './inline-edit';

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
  /** The writer showed or hid the arc (remember it). */
  onArc(shown: boolean): void;
  /** The book as it is now (after a change made here). */
  outline(): Outline;
  /** Rename a scene (blank: unnamed); false if nothing changed. */
  rename(sceneId: string, name: string): boolean;
  /** Add an empty scene at the end of a chapter; its identity. */
  addScene(chapterId: string): string | null;
  /** Delete a scene (already confirmed: two steps). */
  deleteScene(sceneId: string): void;
  /** Copy a scene, with its title, as rich and plain text. */
  copyScene(sceneId: string): void;
  /** Move a scene to `index` among a chapter's scenes (as they are once it has left); false if nothing moved. */
  moveScene(sceneId: string, chapterId: string, index: number): boolean;
  /** Move a chapter to `index` among the chapters; false if nothing moved. */
  moveChapter(chapterId: string, index: number): boolean;
  /** A native context menu; the chosen item's id. */
  popupMenu(items: MenuItem[]): Promise<string | null>;
  /** The book's story structure (its id), if it has one. */
  structure(): string | null;
  /** Mark a scene as a story beat (null: unmark it); false if nothing changed. */
  setBeat(sceneId: string, beat: string | null): boolean;
  /** Open the book's settings (to choose a structure). */
  bookSettings(): void;
}

/** What can be done to a card: in its menu (its ⋯ button, or right-click), and on its keys (N, a new scene after it, is a key only: each chapter's last tile adds one too). */
type CardAction = 'open' | 'mark' | 'rename' | 'copy' | 'new-scene' | 'delete';
const ACTIONS: { action: Exclude<CardAction, 'new-scene'>; label: string; menuKeys: string }[] = [
  { action: 'open', label: 'Open', menuKeys: 'Enter' },
  { action: 'mark', label: 'Mark as', menuKeys: 'M' },
  { action: 'rename', label: 'Rename', menuKeys: 'R' },
  { action: 'copy', label: 'Copy', menuKeys: 'C' },
  { action: 'delete', label: 'Delete', menuKeys: 'Backspace' },
];

// The view's controls, Finder-style: the layouts as icons (named in their tooltips), the arc with its word.
const ICON = (body: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const LAYOUTS: [CorkboardLayout, string, string][] = [
  ['rows', 'Rows', ICON('<rect x="2" y="3" width="5" height="4" rx="1"/><rect x="9" y="3" width="5" height="4" rx="1"/><rect x="2" y="9" width="5" height="4" rx="1"/><rect x="9" y="9" width="5" height="4" rx="1"/>')],
  ['columns', 'Columns', ICON('<rect x="2" y="2.5" width="3" height="11" rx="1"/><rect x="6.5" y="2.5" width="3" height="7" rx="1"/><rect x="11" y="2.5" width="3" height="9" rx="1"/>')],
];
const ARC_ICON = ICON('<path d="M1.5 12.5C5 12.5 7 4 10.5 4S13.5 10 14.5 12.5" stroke-linecap="round"/>');

const words = (n: number) => `${numberFormat.format(n)} ${n === 1 ? 'word' : 'words'}`;

export class Corkboard {
  readonly el: HTMLElement;
  /** The cards' area (the toolbar stays put above it). */
  private readonly board: HTMLElement;
  /** The view's controls, for the top bar (layout, arc); and its totals, for the status bar. */
  readonly controls: HTMLElement;
  readonly summary: HTMLElement;
  /** The inline rename in progress (the board isn't redrawn under it). */
  private editing: { id: string; edit: InlineEdit; byClick: boolean } | null = null;
  /** A delete waiting for its confirmation. */
  private readonly arming = new Arming<string>(() => this.showArming());
  private outline: Outline | null = null;
  private rendered: Outline | null = null;
  /** The card that holds the board's single tab stop. */
  private focusId: string | null = null;
  private readonly drag: BoardDrag;
  private readonly arc: ArcStrip;
  private arcFrame = 0;

  constructor(host: HTMLElement, private readonly h: CorkboardHost, layout: CorkboardLayout = 'rows', arc = false) {
    this.el = document.createElement('div');
    this.el.className = 'bt-corkboard';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Corkboard');
    this.el.dataset.open = 'false';
    this.el.innerHTML = `<div class="bt-cork-board" tabindex="-1"></div>`; // (a click on its background keeps the keyboard here: Esc closes it)
    host.append(this.el);
    this.controls = document.createElement('div');
    this.controls.className = 'bt-cork-controls';
    this.controls.setAttribute('role', 'toolbar');
    this.controls.setAttribute('aria-label', 'Corkboard view');
    this.controls.hidden = true;
    this.controls.innerHTML = `
      <div class="bt-seg bt-cork-layouts" role="radiogroup" aria-label="Layout">${LAYOUTS.map(([value, label, icon]) => `
        <button type="button" role="radio" class="bt-seg-item" data-layout="${value}" aria-checked="false" aria-label="${label}" title="${label}">${icon}</button>`).join('')}
      </div>
      <button type="button" class="bt-chrome-button bt-cork-arc-toggle" aria-pressed="false" title="The story arc">${ARC_ICON}<span>Arc</span></button>`;
    this.summary = Object.assign(document.createElement('span'), { className: 'bt-cork-summary', hidden: true });
    this.controls.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const layoutChoice = target.closest<HTMLElement>('[role="radio"][data-layout]');
      if (layoutChoice) this.chooseLayout(layoutChoice.dataset.layout as CorkboardLayout);
      else if (target.closest('.bt-cork-arc-toggle')) { this.showArc(this.el.dataset.arc !== 'true', true); this.h.onArc(this.el.dataset.arc === 'true'); }
    });
    this.controls.addEventListener('keydown', (e) => {
      if (!(e.target as HTMLElement).closest('[role="radio"][data-layout]') || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      this.chooseLayout(this.layout === 'rows' ? 'columns' : 'rows');
      this.controls.querySelector<HTMLElement>(`[role="radio"][data-layout="${this.layout}"]`)!.focus();
    });
    this.board = this.el.querySelector('.bt-cork-board')!;
    this.setLayout(layout);
    this.arc = new ArcStrip(() => this.h.bookSettings(), (share) => this.goTo(share));
    this.board.before(this.arc.el);
    this.showArc(arc);
    // The arc fits its strip (drawn again when the window resizes); its band follows the scrolling.
    new ResizeObserver(() => this.drawArcSoon()).observe(this.arc.el);
    this.board.addEventListener('scroll', () => this.drawArcSoon(), { passive: true });
    this.drag = new BoardDrag({
      root: this.el,
      board: this.board,
      layout: () => this.layout,
      outline: () => this.outline,
      canDrag: () => !this.editing,
      moveScene: (id, chapterId, index) => this.moved(this.h.moveScene(id, chapterId, index), id),
      moveChapter: (id, index) => this.moved(this.h.moveChapter(id, index), this.focusId),
    });

    this.el.addEventListener('click', (e) => {
      if (this.drag.consumeClick()) return; // the click that ends a drag
      const target = e.target as HTMLElement;
      const add = target.closest<HTMLElement>('[data-add-scene]');
      if (add) { this.newScene(add.dataset.addScene!); return; }
      const card = target.closest<HTMLElement>('.bt-cork-card');
      if (!card || target.closest('input')) return;
      if (target.closest('[data-action="open"]')) this.h.open(card.dataset.id!);
      else if (target.closest('[data-action="menu"]')) { this.focusCard(card.dataset.id!); void this.menu(card.dataset.id!); }
      else if (target.closest('[data-action="rename"]') && e.detail === 1) { this.focusCard(card.dataset.id!); this.startRename(card.dataset.id!, true); }
      else this.focusCard(card.dataset.id!); // a click only gives the card the keyboard
    });
    this.el.addEventListener('contextmenu', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.bt-cork-card');
      if (!card || (e.target as HTMLElement).closest('input')) return;
      e.preventDefault();
      this.focusCard(card.dataset.id!);
      void this.menu(card.dataset.id!);
    });
    this.el.addEventListener('dblclick', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.bt-cork-card');
      if (!card || (e.target as HTMLElement).closest('button')) return;
      if ((e.target as HTMLElement).closest('input')) {
        // A double-click on the title: its first click started the rename; together they open.
        if (!this.editing?.byClick) return;
        this.editing.edit.finish(false);
      }
      this.h.open(card.dataset.id!);
    });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    // However a card gets the keyboard (click, arrows, Tab, assistive tech), it's the one the toolbar acts on.
    this.el.addEventListener('focusin', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.bt-cork-card');
      if (card && card.dataset.id !== this.focusId) this.focusCard(card.dataset.id!);
    });
  }

  get isOpen(): boolean {
    return this.el.dataset.open === 'true';
  }

  /** The keyboard back on the board: its card. */
  focus() {
    (this.card(this.focusId) ?? this.board).focus();
  }

  /** Show the board, the keyboard on `sceneId`'s card (the scene the writer was in). */
  open(outline: Outline, sceneId: string | null) {
    this.outline = outline;
    this.focusId = sceneId;
    this.rendered = null; // (note counts may have changed while it was closed)
    this.render();
    this.el.dataset.open = 'true';
    this.controls.hidden = this.summary.hidden = false;
    this.drawArc();
    const card = this.card(this.focusId) ?? this.cards()[0];
    if (card) {
      this.focusCard(card.dataset.id!);
      card.scrollIntoView({ block: 'center' });
    }
  }

  close() {
    this.drag.cancel();
    this.editing?.edit.finish(false);
    this.arming.disarm();
    this.el.dataset.open = 'false';
    this.controls.hidden = this.summary.hidden = true;
  }

  get layout(): CorkboardLayout {
    return this.el.dataset.layout as CorkboardLayout;
  }

  private setLayout(layout: CorkboardLayout) {
    this.el.dataset.layout = layout;
    for (const r of this.controls.querySelectorAll<HTMLElement>('[role="radio"][data-layout]')) {
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
    this.drawArc();
    this.card(this.focusId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ── the story arc (DECISIONS §27) ──

  /**
   * Show or hide the arc. `animate` (the writer's toggle): like the side
   * panels, the layout changes at once, then everything on screen glides
   * from where it was — each card and chapter header by its own travel (in
   * Rows the chapters are centred and may rewrap, so they don't all move
   * alike) — while the strip fades in.
   */
  private showArc(shown: boolean, animate = false) {
    const before = animate && this.isOpen ? measure(this.onScreen()) : null;
    this.el.dataset.arc = String(shown);
    this.controls.querySelector('.bt-cork-arc-toggle')!.setAttribute('aria-pressed', String(shown));
    this.drawArc();
    if (before) glideFrom(before, [...before.keys()].map((el) => [el, el] as const), glideMotion('sidebar'));
  }

  /** The cards and chapter headers on screen now (each its own key). */
  private onScreen(): [HTMLElement, HTMLElement][] {
    const box = this.board.getBoundingClientRect();
    return [...this.board.querySelectorAll<HTMLElement>('.bt-cork-card, .bt-cork-add, .bt-cork-chapter-head')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > box.top && r.top < box.bottom && r.right > box.left && r.left < box.right;
    }).map((el) => [el, el]);
  }

  /** Draw the arc (only while it shows; unchanged, it isn't redrawn), its band over the cards on screen. */
  private drawArc() {
    if (!this.outline || !this.isOpen || this.el.dataset.arc !== 'true') return;
    this.arc.draw(this.outline, structureOf(this.h.structure())?.beats ?? null, this.layout === 'rows');
    this.arc.showView(this.inView());
  }

  /** To a place in the book (a share of it): the board brings its scene's card to the middle, the keyboard on it. */
  private goTo(share: number) {
    const shares = weighBook(this.outline!).scenes;
    const id = [...shares].find(([, [start, end]]) => share >= start && share <= end)?.[0] ?? [...shares.keys()].at(-1);
    const card = this.card(id ?? null);
    if (!card) return;
    if (this.focusId !== id) this.arming.disarm();
    this.focusId = id!;
    this.setTabStop();
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'center', inline: 'center', behavior: glideMotion().ms ? 'smooth' : 'auto' });
  }

  /** The stretch of the book whose cards are on screen (shares of it), or null. */
  private inView(): [number, number] | null {
    const shares = weighBook(this.outline!).scenes;
    const box = this.board.getBoundingClientRect();
    let view: [number, number] | null = null;
    for (const card of this.cards()) {
      const r = card.getBoundingClientRect();
      if (r.right <= box.left || r.left >= box.right || r.bottom <= box.top || r.top >= box.bottom) continue;
      const [start, end] = shares.get(card.dataset.id!) ?? [0, 0];
      view = view ? [Math.min(view[0], start), Math.max(view[1], end)] : [start, end];
    }
    return view;
  }

  private drawArcSoon() {
    cancelAnimationFrame(this.arcFrame);
    this.arcFrame = requestAnimationFrame(() => this.drawArc());
  }

  /** The book changed: redraw (keeping the scroll and the focused card). */
  update(outline: Outline) {
    this.outline = outline;
    if (this.isOpen) this.render();
  }

  private render() {
    const outline = this.outline;
    if (!outline || outline === this.rendered || this.editing) return;
    this.rendered = outline;
    const hadFocus = this.board.contains(document.activeElement);
    const [scrollTop, scrollLeft] = [this.board.scrollTop, this.board.scrollLeft];
    const notes = this.h.noteCounts();
    const sections = outline.chapters.map((chapter) => {
      const section = document.createElement('section');
      section.className = 'bt-cork-chapter';
      section.dataset.id = chapter.id;
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
      grid.append(...chapter.scenes.map((scene) => this.cardFor(scene, notes.get(scene.id) ?? 0)), this.addTile(chapter));
      section.append(head, grid);
      return section;
    });
    this.board.replaceChildren(...sections);
    this.drawArc();
    [this.board.scrollTop, this.board.scrollLeft] = [scrollTop, scrollLeft]; // a refresh never moves the board
    this.showArming();
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
    const heading = document.createElement('h3');
    heading.className = 'bt-cork-card-heading';
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'bt-cork-card-title';
    title.dataset.action = 'rename';
    title.dataset.unnamed = String(!scene.name);
    title.tabIndex = -1; // the card is the tab stop; R or F2 renames
    title.textContent = sceneDisplayName(scene);
    title.title = 'Rename  R';
    heading.append(title);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'bt-cork-action';
    open.dataset.action = 'open';
    open.tabIndex = -1; // the card is the tab stop; ↵ opens
    open.textContent = 'Open';
    open.setAttribute('aria-label', `Open ${scene.label} in the manuscript`);
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'bt-cork-action bt-cork-more';
    more.dataset.action = 'menu';
    more.tabIndex = -1; // (the menu key, or right-click, from the keyboard)
    more.textContent = '⋯';
    more.title = 'Open, mark as, rename, copy, delete';
    more.setAttribute('aria-label', `Actions for ${scene.label}`);
    // Asked to confirm a delete: the card says how.
    const armed = Object.assign(document.createElement('span'), { className: 'bt-cork-armed', textContent: 'Delete? ⌫ again' });
    head.append(Object.assign(document.createElement('span'), { className: 'bt-cork-card-number', textContent: scene.label }), heading, armed, open, more);

    const opening = document.createElement('p');
    opening.className = 'bt-cork-card-opening';
    opening.textContent = scene.opening;

    const foot = document.createElement('div');
    foot.className = 'bt-cork-card-foot';
    foot.append(Object.assign(document.createElement('span'), { className: 'bt-cork-card-words', textContent: draft ? 'Draft' : words(scene.words) }));
    if (noteCount) foot.append(Object.assign(document.createElement('span'), { className: 'bt-cork-card-notes', textContent: `${noteCount} ${noteCount === 1 ? 'note' : 'notes'}` }));
    if (scene.beat) {
      const beat = beatName(this.h.structure(), scene.beat);
      foot.append(Object.assign(document.createElement('span'), { className: 'bt-cork-card-beat', textContent: beat }));
      card.setAttribute('aria-label', `${card.getAttribute('aria-label')}, ${beat}`);
    }

    card.append(head, opening, foot);
    return card;
  }

  /** The last place in a chapter: a tile that adds a scene. */
  private addTile(chapter: ChapterEntry): HTMLElement {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'bt-cork-add';
    add.dataset.addScene = chapter.id;
    add.tabIndex = -1; // (N adds one from the keyboard)
    add.setAttribute('aria-label', `New scene in chapter ${chapter.number}`);
    add.innerHTML = `${PLUS}<span>New scene</span>`;
    return add;
  }

  // ── what can be done to a card ──

  private act(action: CardAction, id: string) {
    switch (action) {
      case 'open': this.h.open(id); break;
      case 'mark': void this.h.popupMenu(this.beats(id)).then((choice) => this.chosen(id, choice)); break;
      case 'rename': this.startRename(id); break;
      case 'copy': this.h.copyScene(id); break;
      case 'new-scene': { const chapter = this.chapterOf(id); if (chapter) this.newScene(chapter.id); break; }
      case 'delete': this.deleteScene(id); break;
    }
  }

  private chapterOf(sceneId: string): ChapterEntry | undefined {
    return this.outline?.chapters.find((c) => c.scenes.some((s) => s.id === sceneId));
  }

  private sceneOf(id: string): SceneEntry | undefined {
    return this.outline?.chapters.flatMap((c) => c.scenes).find((s) => s.id === id);
  }

  /** A drag moved something: redraw now, the keyboard on `focus` (the moved card, or where it was). */
  private moved(changed: boolean, focus: string | null): boolean {
    if (!changed) return false;
    this.arming.disarm();
    this.refresh();
    if (focus) this.focusCard(focus);
    return true;
  }

  /** The book changed here: redraw now (not on the next frame), so the keyboard can land on the result. */
  private refresh() {
    this.outline = this.h.outline();
    this.render();
  }

  /** Delete: the first press arms it (the card asks); a second, within a few seconds, deletes. */
  private deleteScene(id: string) {
    const owns = (t: Element) => !!t.closest(`.bt-cork-card[data-id="${CSS.escape(id)}"]`);
    if (!this.arming.press(id, owns)) return;
    const cards = this.cards();
    const i = cards.findIndex((c) => c.dataset.id === id);
    const next = (cards[i + 1] ?? cards[i - 1])?.dataset.id ?? null;
    this.h.deleteScene(id);
    this.refresh();
    const landing = this.card(next) ?? this.cards()[Math.min(i, this.cards().length - 1)];
    if (landing) this.focusCard(landing.dataset.id!);
  }

  private showArming() {
    const armed = this.arming.key;
    for (const c of this.el.querySelectorAll<HTMLElement>('.bt-cork-card[data-arming]')) delete c.dataset.arming;
    if (armed) this.card(armed)?.setAttribute('data-arming', 'true');
  }

  private newScene(chapterId: string) {
    const id = this.h.addScene(chapterId);
    if (!id) return;
    this.refresh();
    this.focusCard(id);
    this.startRename(id); // named straight away (Esc leaves it unnamed)
  }

  // ── rename, in place ──

  /** Rename in place; `byClick`: started by a click on the title (which may yet be the first of a double-click). */
  private startRename(id: string, byClick = false) {
    const scene = this.sceneOf(id);
    const title = this.card(id)?.querySelector<HTMLElement>('.bt-cork-card-heading');
    if (!scene || !title || this.editing) return;
    this.arming.disarm();
    const edit = new InlineEdit({
      value: scene.name ?? '',
      placeholder: 'Unnamed scene',
      label: `Name of scene ${scene.label}`,
      className: 'bt-cork-rename bt-field',
      onDone: (save, value, refocus) => {
        this.editing = null;
        if (save) this.h.rename(id, value.trim());
        this.rendered = null; // the card's title comes back
        this.refresh();
        if (refocus && this.isOpen) this.focusCard(id);
      },
    });
    this.editing = { id, edit, byClick };
    // A press of its own in the field: a double-click there selects words (it no longer opens the scene).
    edit.input.addEventListener('mousedown', (e) => { if (e.detail === 1 && this.editing) this.editing.byClick = false; });
    title.replaceWith(edit.input);
    edit.focus();
  }

  // ── the context menu (right-click, or the menu key) ──

  private async menu(id: string) {
    const armed = this.arming.key === id;
    const items: MenuItem[] = ACTIONS.flatMap(({ action, label, menuKeys }): MenuItem[] => [
      ...(action === 'delete' ? [{ separator: true as const }] : []),
      action === 'mark' ? { id: action, label, submenu: this.beats(id) }
        : { id: action, label: action === 'delete' && armed ? 'Delete — confirm' : label, keys: menuKeys },
    ]);
    this.chosen(id, await this.h.popupMenu(items));
  }

  private beats(id: string): MenuItem[] {
    return beatMenu(this.outline!, this.h.structure(), id);
  }

  /** What was chosen in a card's menu: an action, a beat (DECISIONS §27), or the way to choose a structure. */
  private chosen(id: string, choice: string | null) {
    if (!choice || !this.isOpen) return;
    const beat = chosenBeat(choice);
    if (choice === CHOOSE_STRUCTURE) this.h.bookSettings();
    else if (beat !== undefined) this.h.setBeat(id, beat);
    else this.act(choice as CardAction, id);
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
    if (this.focusId !== id) this.arming.disarm();
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
    const card = (e.target as HTMLElement).closest<HTMLElement>('.bt-cork-card');
    if (!card || (e.target as HTMLElement).closest('button, input')) return;
    const id = card.dataset.id!;
    // A card's own keys: the same actions as the toolbar and the menu.
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const action: CardAction | null = e.key === 'Enter' ? 'open'
      : (plain && key === 'r') || e.key === 'F2' ? 'rename'
      : plain && key === 'm' ? 'mark'
      : (plain && key === 'c') || (e.metaKey && key === 'c') ? 'copy'
      : plain && key === 'n' ? 'new-scene'
      : plain && (e.key === 'Backspace' || e.key === 'Delete') ? 'delete'
      : null;
    if (action) { e.preventDefault(); this.act(action, id); return; }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); void this.menu(id); return; }
    // Any other key leaves an armed delete (Esc is claimed by the arming itself).
    if (this.arming.key && !['Shift', 'Meta', 'Alt', 'Control'].includes(e.key)) this.arming.disarm();
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || e.metaKey || e.altKey) return;
    e.preventDefault();
    const next = this.neighbour(card, e.key);
    if (next) this.focusCard(next.dataset.id!);
  }
}
