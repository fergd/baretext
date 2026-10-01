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

const numberFormat = new Intl.NumberFormat();
const REFRESH_MS = 250;
const CASCADE_SPAN_MS = 160;
const CASCADE_STEP_MS = 12;
const CASCADE_OFFSET = 12;
const CHEVRON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

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
        <span class="bt-outline-title"></span>
        <span class="bt-outline-total"></span>
      </div>
      <div class="bt-outline-tree" role="tree" aria-label="Chapters and scenes"></div>`;
    this.title = this.el.querySelector('.bt-outline-title')!;
    this.total = this.el.querySelector('.bt-outline-total')!;
    this.tree = this.el.querySelector('.bt-outline-tree')!;
    host.append(this.el);

    this.tree.addEventListener('click', (e) => this.onClick(e));
    this.tree.addEventListener('keydown', (e) => this.onKey(e));
    // Clicks never take focus from the manuscript (keyboard users enter with ⌥⌘\).
    this.tree.addEventListener('mousedown', (e) => { if (!this.el.contains(document.activeElement)) e.preventDefault(); });
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

  private onClick(e: MouseEvent) {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.bt-outline-row');
    if (!row) return;
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
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation(); // Esc here never also leaves focus mode
    }
  }
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
