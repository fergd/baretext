// The outline (spec §8.1): chapters and scenes as a keyboard tree in a
// column beside the page, opened only deliberately (the title bar's sidebar
// button, ⌘\, View → Outline). Navigate, fold, rename in place, add scenes
// and chapters, and drag to reorder (outline-drag.ts).
//
// Rows are rebuilt only when the outline is showing and the structure or
// counts changed (on a short debounce while typing); the current-scene mark
// updates in place, and the list's scroll position is never jumped.

import { BOOK_TITLE } from '@baretext/editor';
import { sceneDisplayName, type Outline } from './outline';
import { OutlineDrag } from './outline-drag';
import { CHEVRON, PLUS, RESTORE, SNOWFLAKE, TRASH } from './icons';
import { slideColumn, type Motion } from './sidebar-motion';

const numberFormat = new Intl.NumberFormat();
const REFRESH_MS = 250;
/** The Cold Storage section's identity in the tree (folding, focus). */
const COLD = 'cold-storage';
/** How long an armed delete waits for its confirmation. */
const ARM_MS = 4000;

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
  private readonly drag: OutlineDrag;
  /** The current scene's wash: one element that glides between rows. */
  private readonly highlight: HTMLElement;
  /** A delete waiting for its confirmation (two steps, spec §0.8). */
  private arming: { id: string; timer: number; onAway: (e: Event) => void } | null = null;
  /** The inline rename in progress; rows are not rebuilt under it. */
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
      /** Cold Storage: move a scene there, open one on the page, put one back (where it came from, or at a place). */
      park: (sceneId: string) => void;
      openParked: (sceneId: string) => void;
      restore: (sceneId: string, chapterId?: string, index?: number) => void;
      /** Delete a scene or a chapter (already confirmed). */
      deleteScene: (sceneId: string) => void;
      deleteChapter: (chapterId: string) => void;
      /** Open notes per scene id (shown beside the scene's word count). */
      noteCounts: () => Map<string, number>;
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

    this.highlight = document.createElement('div');
    this.highlight.className = 'bt-outline-current';
    this.highlight.setAttribute('aria-hidden', 'true');
    this.highlight.dataset.visible = 'false';
    this.tree.addEventListener('click', (e) => this.onClick(e));
    this.drag = new OutlineDrag({
      panel: this.el,
      tree: this.tree,
      outline: () => this.outline,
      rows: () => this.rows(),
      rowFor: (id) => this.rowFor(id),
      render: (force) => this.render(force),
      canDrag: () => !this.editing,
      moveScene: actions.moveScene,
      moveChapter: actions.moveChapter,
      park: actions.park,
      restore: actions.restore,
    });
    this.tree.addEventListener('keydown', (e) => this.onKey(e));
    // Clicks never take focus from the manuscript (keyboard users enter with ⌥⌘\).
    this.tree.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('input')) return; // the rename field takes focus
      if (!this.el.contains(document.activeElement)) e.preventDefault();
    });
    this.tree.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.bt-outline-row');
      if (row && row.dataset.kind !== 'cold' && !(e.target as HTMLElement).closest('input, .bt-outline-toggle, .bt-outline-actions')) this.startRename(row.dataset.id!, 'editor');
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
  motion(open: boolean, m: Motion) {
    slideColumn(this.el, 'left', open, m, () => this.rows(), this.tree);
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
    if (hereChanged) this.markCurrent(true, true);
  }

  /** Note counts changed: redraw the rows (if showing). */
  notesChanged() {
    if (this.isShowing) this.render(true);
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
    if (this.editing || this.drag.active) return; // finishing the rename or drag renders
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
    const noteCounts = this.actions.noteCounts();
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
        rowActions('chapter'),
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
        const notes = noteCounts.get(scene.id) ?? 0;
        row.setAttribute('aria-label', `${scene.label} ${name}, ${words(scene.words)}${notes ? `, ${notes} open ${notes === 1 ? 'note' : 'notes'}` : ''}`);
        row.append(cell('bt-outline-num', scene.label), cell('bt-outline-name', name), meta(scene.words, notes), rowActions('scene'));
        group.append(row);
      }
      frag.append(group);
    }
    if (outline.parked.length) frag.append(...this.coldSection(outline));
    this.tree.replaceChildren(frag);
    this.tree.scrollTop = scrollTop; // a refresh never moves the list
    if (!this.focusId || !this.rowFor(this.focusId)) this.focusId = this.currentSceneId;
    this.setTabStop(this.focusId ?? '');
    if (this.arming) this.showArmed(this.arming.id);
    if (hadFocus && this.focusId) this.rowFor(this.focusId)?.focus({ preventScroll: true });
    this.markCurrent(false);
  }

  /** Mark the current scene (and its chapter); bring it into view only if it left the list's view. */
  /** Cold Storage: a folding section after the chapters, newest first. */
  private coldSection(outline: Outline): HTMLElement[] {
    const open = !this.collapsed.has(COLD);
    const head = document.createElement('div');
    head.setAttribute('role', 'treeitem');
    head.className = 'bt-outline-row bt-outline-chapter bt-outline-cold';
    head.dataset.id = COLD;
    head.dataset.kind = 'cold';
    head.tabIndex = -1;
    head.setAttribute('aria-level', '1');
    head.setAttribute('aria-expanded', String(open));
    const n = outline.parked.length;
    head.setAttribute('aria-label', `Cold Storage, ${n} ${n === 1 ? 'scene' : 'scenes'}, ${words(outline.parkedWords)}`);
    head.append(cell('bt-outline-toggle', ''), cell('bt-outline-num', ''), cell('bt-outline-name', 'Cold Storage'),
      cell('bt-outline-meta', open ? numberFormat.format(outline.parkedWords) : `${n} · ${numberFormat.format(outline.parkedWords)}`));
    head.firstElementChild!.innerHTML = CHEVRON;
    head.children[1]!.innerHTML = SNOWFLAKE;
    if (!open) return [head];
    const group = document.createElement('div');
    group.setAttribute('role', 'group');
    for (const p of outline.parked) {
      const row = document.createElement('div');
      row.setAttribute('role', 'treeitem');
      row.className = 'bt-outline-row bt-outline-scene bt-outline-parked';
      row.dataset.id = p.id;
      row.dataset.kind = 'parked';
      row.dataset.chapter = COLD;
      row.tabIndex = -1;
      row.setAttribute('aria-level', '2');
      const name = p.name || (p.name === '' ? 'Untitled' : 'Unnamed scene');
      if (!p.name) row.dataset.unnamed = 'true';
      const from = p.from ? (p.from.chapter ? `From chapter ${p.from.chapter}` : 'From a chapter that was deleted') : '';
      row.title = from;
      row.setAttribute('aria-label', `${name}, ${words(p.words)}, in Cold Storage${from ? `. ${from}` : ''}`);
      row.append(cell('bt-outline-num', ''), cell('bt-outline-name', name), meta(p.words, this.actions.noteCounts().get(p.id) ?? 0), rowActions('parked'));
      group.append(row);
    }
    return [head, group];
  }

  /**
   * Mark the current scene (and its chapter). The highlight is one element
   * that glides from row to row (`glide`), or snaps after a rebuild; the
   * list scrolls (smoothly) only when the current row has left its view.
   */
  private markCurrent(reveal: boolean, glide = false) {
    for (const row of this.tree.querySelectorAll('[aria-current]')) row.removeAttribute('aria-current');
    const row = this.currentSceneId ? this.rowFor(this.currentSceneId) : null;
    row?.setAttribute('aria-current', 'location');
    if (this.currentChapterId) this.rowFor(this.currentChapterId)?.setAttribute('data-here', 'true');
    for (const c of this.tree.querySelectorAll<HTMLElement>('.bt-outline-chapter[data-here]')) {
      if (c.dataset.id !== this.currentChapterId) delete c.dataset.here;
    }
    this.placeHighlight(row, glide);
    if (!reveal || !row || this.el.contains(document.activeElement)) return;
    const top = row.offsetTop; // the tree is the rows' offset parent
    if (top < this.tree.scrollTop || top + row.offsetHeight > this.tree.scrollTop + this.tree.clientHeight) {
      this.tree.scrollTo({ top: top - this.tree.clientHeight / 2, behavior: glide && motionMs() ? 'smooth' : 'auto' });
    }
  }

  private placeHighlight(row: HTMLElement | null, glide: boolean) {
    const h = this.highlight;
    if (h.parentElement !== this.tree) this.tree.prepend(h); // a rebuild replaced the rows
    if (!row) { h.dataset.visible = 'false'; return; }
    const snap = !glide || h.dataset.visible !== 'true';
    if (snap) h.dataset.snap = 'true';
    h.style.transform = `translateY(${row.offsetTop}px)`;
    h.dataset.visible = 'true';
    if (snap) { void h.offsetWidth; delete h.dataset.snap; } // commit the snapped position before gliding resumes
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
    } else if (row.dataset.kind === 'parked') {
      this.actions.openParked(row.dataset.id!);
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

  private chapterTitle(id: string): string {
    return this.outline?.chapters.find((c) => c.id === id)?.title ?? '';
  }

  private sceneName(id: string): string {
    for (const c of this.outline?.chapters ?? []) for (const sc of c.scenes) if (sc.id === id) return sc.name ?? '';
    return this.outline?.parked.find((p) => p.id === id)?.name ?? '';
  }

  // ── delete (two steps) ──

  /** First step: the row asks "Delete …?" until confirmed, cancelled, or a few seconds pass. */
  private armDelete(id: string) {
    this.disarm();
    const onAway = (e: Event) => {
      if (e.type === 'keydown') {
        if ((e as KeyboardEvent).key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation(); // Esc cancels the delete, nothing else
        this.disarm();
        return;
      }
      if (!(e.target as HTMLElement).closest?.(`.bt-outline-row[data-id="${CSS.escape(id)}"] .bt-outline-action`)) this.disarm();
    };
    this.arming = { id, timer: window.setTimeout(() => this.disarm(), ARM_MS), onAway };
    window.addEventListener('pointerdown', onAway, true);
    window.addEventListener('keydown', onAway, true);
    this.showArmed(id);
  }

  private disarm() {
    const a = this.arming;
    if (!a) return;
    this.arming = null;
    clearTimeout(a.timer);
    window.removeEventListener('pointerdown', a.onAway, true);
    window.removeEventListener('keydown', a.onAway, true);
    this.render(true);
  }

  private confirmDelete() {
    const id = this.arming?.id;
    if (!id) return;
    const isChapter = this.rowFor(id)?.dataset.kind === 'chapter';
    this.disarm();
    if (isChapter) this.actions.deleteChapter(id);
    else this.actions.deleteScene(id);
  }

  /** The armed row: tinted, its name replaced by the question, a Delete button in place of the count. */
  private showArmed(id: string) {
    const row = this.rowFor(id);
    const chapter = this.outline?.chapters.find((c) => c.id === id);
    const scene = this.outline?.chapters.flatMap((c) => c.scenes).find((s) => s.id === id);
    const parked = this.outline?.parked.find((p) => p.id === id);
    if (!row || (!chapter && !scene && !parked)) return;
    const what = chapter
      ? `chapter ${chapter.number}${chapter.scenes.length > 1 ? ` and its ${chapter.scenes.length} scenes` : ''}`
      : scene ? `${scene.label}${scene.name ? ` “${scene.name}”` : ''}`
      : parked!.name ? `“${parked!.name}”` : 'this scene';
    const count = chapter ? chapter.scenes.reduce((n, s) => n + s.words, 0) : (scene ?? parked)!.words;
    row.dataset.arming = 'true';
    row.querySelector('.bt-outline-name')!.textContent = `Delete ${what}?`;
    row.title = `${words(count)}. ⌘Z brings it back.`;
    const confirm = row.querySelector<HTMLElement>('.bt-outline-action[data-action="delete"]')!;
    confirm.textContent = 'Delete';
    confirm.setAttribute('aria-label', `Confirm: delete ${what} (${words(count)})`);
  }

  private onClick(e: MouseEvent) {
    if (this.drag.consumeClick()) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.bt-outline-row');
    if (!row) return;
    const action = (e.target as HTMLElement).closest<HTMLElement>('.bt-outline-action')?.dataset.action;
    if (action === 'add') { this.actions.addScene(row.dataset.id!); return; }
    if (action === 'park') { this.actions.park(row.dataset.id!); return; }
    if (action === 'restore') { this.actions.restore(row.dataset.id!); return; }
    if (action === 'delete') { if (this.arming?.id === row.dataset.id) this.confirmDelete(); else this.armDelete(row.dataset.id!); return; }
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
    const chapterOf = (r: HTMLElement) => (r.dataset.chapter ? this.rowFor(r.dataset.chapter) : r);
    if (this.arming?.id === row.dataset.id && (e.key === 'Enter' || e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      e.stopPropagation();
      this.confirmDelete();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && row.dataset.kind !== 'cold') {
      e.preventDefault();
      e.stopPropagation();
      this.armDelete(row.dataset.id!);
      return;
    }
    if (this.arming && !['Shift', 'Meta', 'Alt', 'Control'].includes(e.key)) {
      const wasEsc = e.key === 'Escape';
      this.disarm();
      if (wasEsc) { e.preventDefault(); e.stopPropagation(); return; } // Esc only cancels the delete
    }
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
        if (row.getAttribute('aria-expanded') === 'false') this.toggle(row.dataset.id!, true);
        else if (row.hasAttribute('aria-expanded')) move(rows[i + 1]?.getAttribute('aria-level') === '2' ? rows[i + 1] : undefined);
        break;
      case 'ArrowLeft':
        if (row.hasAttribute('aria-expanded')) this.toggle(row.dataset.id!, false);
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
        if (row.dataset.kind !== 'cold') this.startRename(row.dataset.id!, 'row');
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

/**
 * Revealed on hover or keyboard focus. Chapters: add a scene (⌘↵), delete.
 * Scenes: move to Cold Storage, delete. Parked scenes: restore, delete (⌫).
 */
function rowActions(kind: 'scene' | 'chapter' | 'parked'): HTMLElement {
  const group = document.createElement('span');
  group.className = 'bt-outline-actions';
  const button = (action: string, label: string, title: string, icon: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bt-outline-action';
    b.dataset.action = action;
    b.tabIndex = -1;
    b.title = title;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon;
    return b;
  };
  if (kind === 'chapter') group.append(button('add', 'New scene in this chapter', 'New scene in this chapter  ⌘↵', PLUS));
  if (kind === 'scene') group.append(button('park', 'Move to Cold Storage', 'Move to Cold Storage', SNOWFLAKE));
  if (kind === 'parked') group.append(button('restore', 'Restore to the manuscript', 'Restore (back where it came from)', RESTORE));
  group.append(button('delete', kind === 'chapter' ? 'Delete chapter' : 'Delete scene', kind === 'chapter' ? 'Delete chapter  ⌫' : 'Delete scene  ⌫', TRASH));
  return group;
}

/** A scene's count cell: its open notes (if any), then its words. */
function meta(count: number, notes: number): HTMLElement {
  const m = cell('bt-outline-meta', numberFormat.format(count));
  if (notes) m.prepend(Object.assign(document.createElement('span'), { className: 'bt-outline-notes', textContent: String(notes), title: `${notes} open ${notes === 1 ? 'note' : 'notes'}` }));
  return m;
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

function motionMs(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-glide')) || 0;
}
