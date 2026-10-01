// The outline area (spec §8.1): chapters and scenes as a tree, shown as a
// column beside the page. Opened and closed only deliberately (the title
// bar's sidebar button, ⌘\, View → Outline); the state persists. Read-only over the model for now:
// navigate, collapse/expand, keyboard tree. Editing actions come later.
//
// Rows are rebuilt only when the outline is showing and the structure or
// counts changed (on a short debounce while typing); the current-scene mark
// updates in place, and the list's scroll position is never jumped.

import type { Outline } from './outline';
import { sceneDisplayName } from './outline';
import { BOOK_TITLE } from '@baretext/editor';

const numberFormat = new Intl.NumberFormat();
const REFRESH_MS = 250;
const DRAG_THRESHOLD = 4;
/** Pointer this close to the list's top or bottom edge scrolls it while dragging. */
const EDGE = 32;
/** About one row's height (px), for judging a chapter block's upper half. */
const ROW_GUESS = 28;
const CASCADE_SPAN_MS = 160;
const CASCADE_STEP_MS = 12;
const CASCADE_OFFSET = 12;
const PLUS = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>';
const CHEVRON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

interface Drop {
  chapterId: string;
  index: number;
  /** Viewport y of the insertion line. */
  line: number;
  /** Into a chapter (onto its row) rather than between rows. */
  into: boolean;
  /** It would land where it already is. */
  noop: boolean;
}

interface Drag {
  kind: 'scene' | 'chapter';
  id: string;
  ghost: HTMLElement;
  grabY: number;
  x: number;
  moving: HTMLElement[];
  drop: Drop | null;
  onKey: (e: KeyboardEvent) => void;
  scrollFrame: number;
  lastY: number;
}

export type OutlinePresence = 'hidden' | 'pinned';

export class OutlinePanel {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly total: HTMLElement;
  private readonly tree: HTMLElement;

  private outline: Outline | null = null;
  private bookTitle = '';
  private currentSceneId: string | null = null;
  private currentChapterId: string | null = null;
  private readonly collapsed = new Set<string>();
  private renderedOutline: Outline | null = null;
  private renderedCollapsed = '';
  /** The inline rename in progress; rows are not rebuilt under it. */
  private drag: Drag | null = null;
  private pressed: { row: HTMLElement; x: number; y: number; pointerId: number } | null = null;
  /** A drag just ended on this pointer-up: the click that follows is not a navigation. */
  private swallowClick = false;
  private readonly indicator: HTMLElement;
  private editing: { id: string; input: HTMLInputElement; returnTo: 'row' | 'editor' } | null = null;
  private refreshTimer: number | undefined;
  /** The row that holds the tree's single tab stop. */
  private focusId: string | null = null;

  presence: OutlinePresence = 'hidden';

  constructor(
    host: HTMLElement,
    private readonly actions: {
      navigate: (sceneId: string) => void;
      /** Leave the tree for the manuscript (Esc). */
      toEditor: () => void;
      /** Rename the book (BOOK_TITLE), a chapter or a scene; false if nothing changed. */
      rename: (id: string, name: string) => boolean;
      /** Add an empty scene at the end of a chapter (the caret goes there). */
      addScene: (chapterId: string) => void;
      /** Move a scene to `index` among a chapter's scenes (as they are once it has left); false if refused. */
      moveScene: (sceneId: string, chapterId: string, index: number) => boolean;
      /** Move a chapter to `index` among the chapters (as they are once it has left). */
      moveChapter: (chapterId: string, index: number) => boolean;
      /** Add a chapter at the end of the book; returns its identity. */
      addChapter: () => string | null;
      /** Presence changed (the shell lays itself out around it). */
      onPresence: (presence: OutlinePresence) => void;
    },
  ) {
    this.el = document.createElement('aside');
    this.el.className = 'bt-outline';
    this.el.setAttribute('aria-label', 'Outline');
    this.el.dataset.presence = 'hidden';
    this.el.innerHTML = `
      <div class="bt-outline-head">
        <button type="button" class="bt-outline-title" title="Rename book"></button>
        <span class="bt-outline-total"></span>
      </div>
      <div class="bt-outline-tree" role="tree" aria-label="Chapters and scenes"></div>
      <div class="bt-outline-foot">
        <button type="button" class="bt-outline-new-chapter">${PLUS}New chapter</button>
      </div>`;
    this.title = this.el.querySelector('.bt-outline-title')!;
    this.total = this.el.querySelector('.bt-outline-total')!;
    this.tree = this.el.querySelector('.bt-outline-tree')!;
    host.append(this.el);

    this.tree.addEventListener('click', (e) => this.onClick(e));
    this.tree.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.indicator = document.createElement('div');
    this.indicator.className = 'bt-outline-drop';
    this.indicator.setAttribute('aria-hidden', 'true');
    this.tree.addEventListener('keydown', (e) => this.onKey(e));
    // Clicks never take focus from the manuscript (keyboard users enter with ⌥⌘\).
    this.tree.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('input')) return; // the rename field takes focus
      if (!this.el.contains(document.activeElement)) e.preventDefault();
    });
    this.tree.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.bt-outline-row');
      if (row && !(e.target as HTMLElement).closest('input, .bt-outline-toggle, .bt-outline-add')) this.startRename(row.dataset.id!, 'editor');
    });
    this.title.addEventListener('mousedown', (e) => { if (!this.el.contains(document.activeElement)) e.preventDefault(); });
    this.title.addEventListener('click', () => this.startRename(BOOK_TITLE, this.el.contains(document.activeElement) ? 'row' : 'editor'));
    const newChapter = this.el.querySelector<HTMLElement>('.bt-outline-new-chapter')!;
    newChapter.addEventListener('mousedown', (e) => { if (!this.el.contains(document.activeElement)) e.preventDefault(); });
    newChapter.addEventListener('click', () => {
      const id = this.actions.addChapter();
      if (!id) return;
      this.render(true);
      this.rowFor(id)?.scrollIntoView({ block: 'nearest' });
      this.startRename(id, 'editor'); // name it now; Esc leaves it Untitled
    });
    this.tree.addEventListener('focusin', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.bt-outline-row');
      if (row) this.setTabStop(row.dataset.id!);
    });
  }

  get isShowing(): boolean {
    return this.presence !== 'hidden';
  }

  setPresence(presence: OutlinePresence) {
    if (presence === this.presence) return;
    this.presence = presence;
    this.el.dataset.presence = presence;
    if (presence === 'hidden') {
      if (this.el.contains(document.activeElement)) this.actions.toEditor();
    } else {
      this.render(true);
      this.markCurrent(true); // opens with where you are in view
    }
    this.actions.onPresence(presence);
  }

  /**
   * Slide the column in (or out) from the left edge; on the way in the
   * first rows follow in a short cascade. Transforms and opacity only.
   * Closing keeps the column painted until it has slid away.
   */
  motion(open: boolean, duration: number, easing: string) {
    for (const a of this.el.getAnimations({ subtree: true })) a.cancel();
    if (!duration) { delete this.el.dataset.closing; return; }
    if (!open) this.el.dataset.closing = 'true';
    const slide = this.el.animate(
      [{ transform: 'translateX(-100%)', opacity: 0.4 }, { transform: 'translateX(0)', opacity: 1 }],
      { duration, easing, direction: open ? 'normal' : 'reverse' },
    );
    slide.onfinish = slide.oncancel = () => { if (!open) delete this.el.dataset.closing; };
    if (!open) return;
    // Every row in view joins the cascade; the whole wave fits a fixed span.
    const box = this.tree.getBoundingClientRect();
    const visible = this.rows().filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > box.top && b.top < box.bottom; });
    const step = Math.min(CASCADE_STEP_MS, CASCADE_SPAN_MS / Math.max(1, visible.length));
    visible.forEach((row, i) => {
      row.animate([{ opacity: 0, transform: `translateX(${-CASCADE_OFFSET}px)` }, { opacity: 1, transform: 'none' }],
        { duration: duration * 0.7, easing, delay: duration * 0.1 + i * step, fill: 'backwards' });
    });
  }

  /** New model data. Structure/count changes refresh on a debounce; the current mark at once. */
  update(outline: Outline, bookTitle: string, currentSceneId: string | null, currentChapterId: string | null) {
    const hereChanged = currentSceneId !== this.currentSceneId;
    this.outline = outline;
    this.bookTitle = bookTitle;
    this.currentSceneId = currentSceneId;
    this.currentChapterId = currentChapterId;
    if (!this.isShowing) return;
    if (outline.signature !== this.renderedOutline?.signature) {
      this.render(true); // chapters or scenes came or went: never show stale rows
    } else if (outline !== this.renderedOutline) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => this.render(false), REFRESH_MS);
    }
    if (hereChanged) this.markCurrent(true);
  }

  /** Move keyboard focus into the tree, on the current scene. */
  focusTree() {
    this.render(false);
    const id = this.currentSceneId && this.rowFor(this.currentSceneId)?.offsetParent ? this.currentSceneId : this.currentChapterId;
    const row = (id && this.rowFor(id)) || this.tree.querySelector<HTMLElement>('.bt-outline-row');
    if (!row) return;
    this.setTabStop(row.dataset.id!);
    row.focus();
    row.scrollIntoView({ block: 'nearest' });
  }

  // ── rendering ──

  private render(force: boolean) {
    clearTimeout(this.refreshTimer);
    if (this.editing || this.drag) return; // finishing the rename or drag renders
    const outline = this.outline;
    if (!outline) return;
    const collapsedKey = [...this.collapsed].join(',');
    if (!force && outline === this.renderedOutline && collapsedKey === this.renderedCollapsed) return;
    this.renderedOutline = outline;
    this.renderedCollapsed = collapsedKey;
    this.title.textContent = this.bookTitle || 'Untitled';
    this.total.textContent = numberFormat.format(outline.words);
    this.total.title = words(outline.words);

    const scrollTop = this.tree.scrollTop;
    const hadFocus = this.el.contains(document.activeElement);
    const frag = document.createDocumentFragment();
    for (const chapter of outline.chapters) {
      const open = !this.collapsed.has(chapter.id);
      const item = document.createElement('div');
      item.setAttribute('role', 'treeitem');
      item.className = 'bt-outline-row bt-outline-chapter';
      item.dataset.id = chapter.id;
      item.dataset.kind = 'chapter';
      item.tabIndex = -1;
      item.setAttribute('aria-level', '1');
      item.setAttribute('aria-expanded', String(open));
      const scenes = `${chapter.scenes.length} ${chapter.scenes.length === 1 ? 'scene' : 'scenes'}`;
      const chapterWords = chapter.scenes.reduce((n, s) => n + s.words, 0);
      item.setAttribute('aria-label', `Chapter ${chapter.number} ${chapter.title || 'Untitled'}, ${scenes}, ${words(chapterWords)}`);
      item.append(
        cell('bt-outline-toggle', ''),
        cell('bt-outline-num', String(chapter.number)),
        cell('bt-outline-name', chapter.title || 'Untitled'),
        cell('bt-outline-meta', open ? numberFormat.format(chapterWords) : `${chapter.scenes.length} · ${numberFormat.format(chapterWords)}`),
        addButton(),
      );
      item.firstElementChild!.innerHTML = CHEVRON;
      frag.append(item);
      if (!open) continue;
      const group = document.createElement('div');
      group.setAttribute('role', 'group');
      for (const scene of chapter.scenes) {
        const row = document.createElement('div');
        row.setAttribute('role', 'treeitem');
        row.className = 'bt-outline-row bt-outline-scene';
        row.dataset.id = scene.id;
        row.dataset.kind = 'scene';
        row.dataset.chapter = chapter.id;
        row.tabIndex = -1;
        row.setAttribute('aria-level', '2');
        const name = sceneDisplayName(scene);
        if (!scene.name) row.dataset.unnamed = 'true';
        row.setAttribute('aria-label', `${scene.label} ${name}, ${words(scene.words)}`);
        row.append(cell('bt-outline-num', scene.label), cell('bt-outline-name', name), cell('bt-outline-meta', numberFormat.format(scene.words)));
        group.append(row);
      }
      frag.append(group);
    }
    this.tree.replaceChildren(frag);
    this.tree.scrollTop = scrollTop; // a refresh never moves the list
    if (!this.focusId || !this.rowFor(this.focusId)) this.focusId = this.currentSceneId;
    this.setTabStop(this.focusId ?? '');
    if (hadFocus && this.focusId) this.rowFor(this.focusId)?.focus({ preventScroll: true });
    this.markCurrent(false);
  }

  /** Mark the current scene (and its chapter); bring it into view only if it left the list's view. */
  private markCurrent(reveal: boolean) {
    for (const row of this.tree.querySelectorAll('[aria-current]')) row.removeAttribute('aria-current');
    const row = this.currentSceneId ? this.rowFor(this.currentSceneId) : null;
    row?.setAttribute('aria-current', 'location');
    if (this.currentChapterId) this.rowFor(this.currentChapterId)?.setAttribute('data-here', 'true');
    for (const c of this.tree.querySelectorAll<HTMLElement>('.bt-outline-chapter[data-here]')) {
      if (c.dataset.id !== this.currentChapterId) delete c.dataset.here;
    }
    if (!reveal || !row || this.el.contains(document.activeElement)) return;
    const top = row.offsetTop - this.tree.offsetTop;
    if (top < this.tree.scrollTop || top + row.offsetHeight > this.tree.scrollTop + this.tree.clientHeight) {
      this.tree.scrollTop = top - this.tree.clientHeight / 2;
    }
  }

  private rowFor(id: string): HTMLElement | null {
    return this.tree.querySelector<HTMLElement>(`.bt-outline-row[data-id="${CSS.escape(id)}"]`);
  }

  private rows(): HTMLElement[] {
    return [...this.tree.querySelectorAll<HTMLElement>('.bt-outline-row')];
  }

  private setTabStop(id: string) {
    this.focusId = id || null;
    const rows = this.rows();
    const stop = (id && this.rowFor(id)) || rows[0];
    for (const r of rows) r.tabIndex = r === stop ? 0 : -1;
  }

  // ── interaction ──

  private toggle(chapterId: string, open?: boolean) {
    const isOpen = !this.collapsed.has(chapterId);
    if (open === isOpen) return;
    if (isOpen) this.collapsed.add(chapterId);
    else this.collapsed.delete(chapterId);
    this.render(true);
  }

  private activate(row: HTMLElement) {
    if (row.dataset.kind === 'scene') {
      this.actions.navigate(row.dataset.id!);
    } else {
      this.toggle(row.dataset.id!);
    }
  }

  // ── inline rename ──

  /** Swap a name for a field. Enter or leaving it renames; Esc keeps the old name. */
  startRename(id: string, returnTo: 'row' | 'editor') {
    if (this.editing) this.finishRename(true);
    const isBook = id === BOOK_TITLE;
    const row = isBook ? null : this.rowFor(id);
    if (!isBook && !row) return;
    const cellEl = isBook ? this.title : row!.querySelector<HTMLElement>('.bt-outline-name')!;
    const input = document.createElement('input');
    input.className = 'bt-outline-input';
    input.spellcheck = false;
    input.value = isBook ? this.bookTitle : row!.dataset.kind === 'chapter' ? this.chapterTitle(id) : this.sceneName(id);
    input.placeholder = isBook ? 'Book title' : row!.dataset.kind === 'chapter' ? 'Chapter title' : 'Scene name';
    input.setAttribute('aria-label', input.placeholder);
    this.editing = { id, input, returnTo };
    if (isBook) this.el.querySelector<HTMLElement>('.bt-outline-head')!.dataset.editing = 'true';
    cellEl.hidden = true;
    cellEl.after(input);
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the tree's keys and Esc-leaves-focus-mode stay out of it
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); this.finishRename(true); }
      else if (e.key === 'Escape') { e.preventDefault(); this.finishRename(false); }
    });
    input.addEventListener('blur', () => { if (this.editing?.input === input) this.finishRename(true, false); });
    input.addEventListener('click', (e) => e.stopPropagation()); // never navigates
  }

  private finishRename(commit: boolean, refocus = true) {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    delete (this.el.querySelector('.bt-outline-head') as HTMLElement).dataset.editing;
    if (commit) this.actions.rename(editing.id, editing.input.value);
    editing.input.remove();
    this.title.hidden = false;
    this.render(true);
    if (!refocus) return;
    if (editing.returnTo === 'editor') { this.actions.toEditor(); return; }
    const target = editing.id === BOOK_TITLE ? this.title : this.rowFor(editing.id);
    if (target) { if (target !== this.title) this.setTabStop(editing.id); target.focus(); }
  }

  get isRenaming(): boolean {
    return this.editing !== null;
  }

  private chapterTitle(id: string): string {
    return this.outline?.chapters.find((c) => c.id === id)?.title ?? '';
  }

  private sceneName(id: string): string {
    for (const c of this.outline?.chapters ?? []) for (const sc of c.scenes) if (sc.id === id) return sc.name ?? '';
    return '';
  }

  // ── drag to reorder ──

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || this.editing) return;
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('.bt-outline-row');
    if (!row || target.closest('input, .bt-outline-add, .bt-outline-toggle')) return;
    this.pressed = { row, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    const move = (ev: PointerEvent) => {
      if (this.drag) { this.dragTo(ev.clientX, ev.clientY); return; }
      const p = this.pressed;
      if (p && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > DRAG_THRESHOLD) this.startDrag(p.row, ev);
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      this.pressed = null;
      if (this.drag) this.endDrag(ev.type === 'pointerup');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  private startDrag(row: HTMLElement, e: PointerEvent) {
    const kind = row.dataset.kind as 'scene' | 'chapter';
    const id = row.dataset.id!;
    const box = row.getBoundingClientRect();
    const ghost = row.cloneNode(true) as HTMLElement;
    ghost.classList.add('bt-outline-ghost');
    ghost.removeAttribute('role');
    ghost.removeAttribute('aria-current');
    ghost.style.width = `${box.width}px`;
    ghost.style.left = `${box.left}px`;
    ghost.style.top = `${box.top}px`;
    document.body.append(ghost);
    // What moves: the row, and for a chapter all of its scenes.
    const moving = [row, ...(kind === 'chapter' ? [...(row.nextElementSibling?.matches('[role="group"]') ? row.nextElementSibling.querySelectorAll<HTMLElement>('.bt-outline-row') : [])] : [])];
    for (const r of moving) r.dataset.dragging = 'true';
    this.el.dataset.dragging = kind;
    document.body.append(this.indicator); // above the lifted row
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation(); // Esc cancels the drag, nothing else
      this.endDrag(false);
    };
    window.addEventListener('keydown', onKey, true);
    this.drag = { kind, id, ghost, grabY: e.clientY - box.top, x: box.left, moving, drop: null, onKey, scrollFrame: 0, lastY: e.clientY };
    this.dragTo(e.clientX, e.clientY);
  }

  private dragTo(_x: number, y: number) {
    const d = this.drag!;
    d.lastY = y;
    d.ghost.style.top = `${y - d.grabY}px`;
    d.drop = d.kind === 'scene' ? this.sceneDrop(d.id, y) : this.chapterDrop(d.id, y);
    this.showDrop(d.drop);
    // Near the list's edges, it scrolls.
    const box = this.tree.getBoundingClientRect();
    const speed = y < box.top + EDGE ? -(box.top + EDGE - y) : y > box.bottom - EDGE ? y - (box.bottom - EDGE) : 0;
    cancelAnimationFrame(d.scrollFrame);
    if (speed) {
      d.scrollFrame = requestAnimationFrame(() => {
        if (this.drag !== d) return;
        this.tree.scrollTop += Math.max(-EDGE, Math.min(EDGE, speed)) / 2;
        this.dragTo(0, d.lastY);
      });
    }
  }

  /** Where a dragged scene would land: before/after a scene row, or at the end of a chapter (over its row). */
  private sceneDrop(sceneId: string, y: number): Drop | null {
    const source = this.outline?.chapters.find((c) => c.scenes.some((sc) => sc.id === sceneId));
    if (!source) return null;
    const fromIndex = source.scenes.findIndex((sc) => sc.id === sceneId);
    for (const row of this.rows()) {
      const b = row.getBoundingClientRect();
      if (y < b.top || y >= b.bottom) continue;
      let chapterId: string;
      let slot: number; // position among the chapter's scenes as they are now
      let line: number;
      let into = false;
      if (row.dataset.kind === 'chapter') {
        chapterId = row.dataset.id!;
        slot = this.outline!.chapters.find((c) => c.id === chapterId)!.scenes.length;
        line = b.bottom;
        into = true;
      } else {
        chapterId = row.dataset.chapter!;
        const chapter = this.outline!.chapters.find((c) => c.id === chapterId)!;
        const i = chapter.scenes.findIndex((sc) => sc.id === row.dataset.id);
        const after = y >= b.top + b.height / 2;
        slot = i + (after ? 1 : 0);
        line = after ? b.bottom : b.top;
      }
      const same = chapterId === source.id;
      if (!same && source.scenes.length === 1) return null; // a chapter always keeps a scene
      const index = same && slot > fromIndex ? slot - 1 : slot;
      if (same && index === fromIndex) return { chapterId, index, line, into, noop: true };
      return { chapterId, index, line, into, noop: false };
    }
    return null;
  }

  /** Where a dragged chapter would land: before or after another chapter's block (its row and scenes). */
  private chapterDrop(chapterId: string, y: number): Drop | null {
    const chapters = this.outline?.chapters ?? [];
    const fromIndex = chapters.findIndex((c) => c.id === chapterId);
    const blocks = chapters.map((c) => {
      const row = this.rowFor(c.id)!;
      const group = row.nextElementSibling?.matches('[role="group"]') ? row.nextElementSibling as HTMLElement : null;
      return { top: row.getBoundingClientRect().top, bottom: (group ?? row).getBoundingClientRect().bottom };
    });
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      const last = i === blocks.length - 1;
      if (y < b.top && i > 0) continue;
      if (y >= b.bottom && !last) continue;
      const after = y >= b.top + Math.min(b.bottom - b.top, 2 * ROW_GUESS) / 2;
      const slot = i + (after ? 1 : 0);
      const index = slot > fromIndex ? slot - 1 : slot;
      const line = after ? (blocks[i + 1]?.top ?? b.bottom) : b.top;
      return { chapterId, index, line, into: false, noop: index === fromIndex };
    }
    return null;
  }

  private showDrop(drop: Drop | null) {
    for (const r of this.tree.querySelectorAll<HTMLElement>('[data-drop-into]')) delete r.dataset.dropInto;
    if (!drop || drop.noop) { this.indicator.dataset.visible = 'false'; return; }
    if (drop.into) {
      this.indicator.dataset.visible = 'false';
      this.rowFor(drop.chapterId)!.dataset.dropInto = 'true';
      return;
    }
    const box = this.tree.getBoundingClientRect();
    this.indicator.style.top = `${Math.round(drop.line)}px`;
    this.indicator.style.left = `${Math.round(box.left)}px`;
    this.indicator.style.width = `${Math.round(box.width)}px`;
    this.indicator.dataset.kind = this.drag!.kind;
    this.indicator.dataset.visible = 'true';
  }

  private endDrag(commit: boolean) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    cancelAnimationFrame(d.scrollFrame);
    window.removeEventListener('keydown', d.onKey, true);
    for (const r of d.moving) delete r.dataset.dragging;
    delete this.el.dataset.dragging;
    this.showDrop(null);
    this.indicator.remove();
    this.swallowClick = true;
    setTimeout(() => { this.swallowClick = false; }, 0);
    const drop = commit && d.drop && !d.drop.noop ? d.drop : null;
    if (!drop) {
      // Nothing moves: the lifted row settles back where it came from.
      const home = this.rowFor(d.id)?.getBoundingClientRect();
      const settle = home ? d.ghost.animate([{ top: d.ghost.style.top }, { top: `${home.top}px` }], { duration: this.motionMs(), easing: this.easing() }) : null;
      if (settle) settle.onfinish = () => d.ghost.remove(); else d.ghost.remove();
      this.render(false);
      return;
    }
    // FLIP: remember where every row was, move, then let each glide to its new place.
    const before = new Map(this.rows().map((r) => [r.dataset.id!, r.getBoundingClientRect().top]));
    const ghostTop = d.ghost.getBoundingClientRect().top;
    d.ghost.remove();
    const moved = d.kind === 'scene' ? this.actions.moveScene(d.id, drop.chapterId, drop.index) : this.actions.moveChapter(d.id, drop.index);
    this.render(true);
    if (!moved) return;
    const ms = this.motionMs();
    if (!ms) return;
    for (const row of this.rows()) {
      const id = row.dataset.id!;
      const was = id === d.id ? ghostTop : before.get(id);
      if (was === undefined) continue;
      const dy = was - row.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: ms, easing: this.easing() });
    }
    this.rowFor(d.id)?.animate([{ backgroundColor: 'var(--color-popover-active)' }, { backgroundColor: 'transparent' }], { duration: ms * 3, easing: 'ease-out' });
  }

  private motionMs(): number {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-glide')) || 0;
  }

  private easing(): string {
    return getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim() || 'ease-out';
  }

  private onClick(e: MouseEvent) {
    if (this.swallowClick) { this.swallowClick = false; return; }
    const row = (e.target as HTMLElement).closest<HTMLElement>('.bt-outline-row');
    if (!row) return;
    if ((e.target as HTMLElement).closest('.bt-outline-add')) { this.actions.addScene(row.dataset.id!); return; }
    // The chevron only folds; the chapter's name opens its first scene.
    if (row.dataset.kind === 'chapter' && !(e.target as HTMLElement).closest('.bt-outline-toggle')) {
      const first = this.outline?.chapters.find((c) => c.id === row.dataset.id)?.scenes[0];
      if (first) {
        this.actions.navigate(first.id);
        return;
      }
    }
    this.activate(row);
  }

  private onKey(e: KeyboardEvent) {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.bt-outline-row');
    if (!row || e.isComposing) return;
    const rows = this.rows();
    const i = rows.indexOf(row);
    const move = (to: HTMLElement | undefined) => {
      if (!to) return;
      this.setTabStop(to.dataset.id!);
      to.focus();
      to.scrollIntoView({ block: 'nearest' });
    };
    const chapterOf = (r: HTMLElement) => (r.dataset.kind === 'scene' ? this.rowFor(r.dataset.chapter!) : r);
    if (e.key === 'Enter' && e.metaKey && row.dataset.kind === 'chapter') {
      e.preventDefault();
      e.stopPropagation();
      this.actions.addScene(row.dataset.id!); // as ⌘↵ makes a new scene in the manuscript
      return;
    }
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': move(rows[i + 1]); break;
      case 'ArrowUp': move(rows[i - 1]); break;
      case 'Home': move(rows[0]); break;
      case 'End': move(rows[rows.length - 1]); break;
      case 'ArrowRight':
        if (row.dataset.kind === 'chapter') {
          if (row.getAttribute('aria-expanded') === 'false') this.toggle(row.dataset.id!, true);
          else move(rows[i + 1]?.dataset.kind === 'scene' ? rows[i + 1] : undefined);
        }
        break;
      case 'ArrowLeft':
        if (row.dataset.kind === 'chapter') this.toggle(row.dataset.id!, false);
        else move(chapterOf(row) ?? undefined);
        break;
      case 'Enter':
      case ' ':
        this.activate(row);
        break;
      case 'Escape':
        this.actions.toEditor();
        break;
      case 'F2':
        this.startRename(row.dataset.id!, 'row');
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation(); // Esc here never also leaves focus mode
    }
  }
}

/** Revealed on hover or keyboard focus; ⌘↵ on the row does the same. */
function addButton(): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bt-outline-add';
  b.tabIndex = -1;
  b.title = 'New scene in this chapter  ⌘↵';
  b.setAttribute('aria-label', 'New scene in this chapter');
  b.innerHTML = PLUS;
  return b;
}

function cell(className: string, text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function words(n: number): string {
  return `${numberFormat.format(n)} ${n === 1 ? 'word' : 'words'}`;
}
