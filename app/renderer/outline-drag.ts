// Drag to reorder in the outline (DECISIONS §8): a lifted copy of the row
// follows the pointer, an accent line (or a lit chapter row) shows where it
// will land, the list scrolls near its edges, and on drop the rows glide to
// their new places. Esc, or dropping where it started, changes nothing.
// A drag never navigates and never takes focus from the manuscript.

import type { Outline } from './outline';
import { cssNumber, cssValue } from './dom';

const DRAG_THRESHOLD = 4;
/** Pointer this close to the list's top or bottom edge scrolls it. */
const EDGE = 32;
/** About one row's height: a chapter block's "upper half" is judged on its first rows. */
const ROW_GUESS = 28;

interface Drop {
  chapterId: string;
  /** Index among the target's scenes (or among chapters), as they are once the row has left. */
  index: number;
  /** Viewport y of the insertion line. */
  line: number;
  /** Onto a chapter row (its end) rather than between rows. */
  into: boolean;
  /** It would land where it already is. */
  noop: boolean;
  /** Into Cold Storage (a manuscript scene dropped on its section). */
  cold?: boolean;
}

interface Drag {
  kind: 'scene' | 'chapter';
  id: string;
  ghost: HTMLElement;
  grabY: number;
  moving: HTMLElement[];
  drop: Drop | null;
  onKey: (e: KeyboardEvent) => void;
  scrollFrame: number;
  lastY: number;
}

export interface DragHost {
  readonly panel: HTMLElement;
  readonly tree: HTMLElement;
  outline(): Outline | null;
  rows(): HTMLElement[];
  rowFor(id: string): HTMLElement | null;
  render(force: boolean): void;
  /** False while something else owns the pointer (an inline rename). */
  canDrag(): boolean;
  moveScene(sceneId: string, chapterId: string, index: number): boolean;
  moveChapter(chapterId: string, index: number): boolean;
  /** Cold Storage: park a scene; put a parked one back at a place. */
  park(sceneId: string): void;
  restore(sceneId: string, chapterId: string, index: number): void;
}

export class OutlineDrag {
  private drag: Drag | null = null;
  /** A drag just ended on this pointer-up: the click that follows is not a navigation. */
  private swallowClick = false;
  private readonly indicator: HTMLElement;

  constructor(private readonly h: DragHost) {
    this.indicator = document.createElement('div');
    this.indicator.className = 'bt-outline-drop';
    this.indicator.setAttribute('aria-hidden', 'true');
    h.tree.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  get active(): boolean {
    return this.drag !== null;
  }

  /** True once for the click that ends a drag (so it doesn't navigate). */
  consumeClick(): boolean {
    const swallow = this.swallowClick;
    this.swallowClick = false;
    return swallow;
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !this.h.canDrag()) return;
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('.bt-outline-row');
    if (!row || row.dataset.kind === 'cold' || target.closest('input, .bt-outline-actions, .bt-outline-toggle')) return;
    const start = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      if (this.drag) this.dragTo(ev.clientY);
      else if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > DRAG_THRESHOLD) this.start(row, ev);
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (this.drag) this.end(ev.type === 'pointerup');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  private start(row: HTMLElement, e: PointerEvent) {
    const kind = row.dataset.kind === 'chapter' ? 'chapter' : 'scene'; // a parked row drags like a scene
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
    const group = kind === 'chapter' && row.nextElementSibling?.matches('[role="group"]') ? row.nextElementSibling : null;
    const moving = [row, ...(group ? group.querySelectorAll<HTMLElement>('.bt-outline-row') : [])];
    for (const r of moving) r.dataset.dragging = 'true';
    this.h.panel.dataset.dragging = kind;
    document.body.append(this.indicator); // above the lifted row
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation(); // Esc cancels the drag, nothing else
      this.end(false);
    };
    window.addEventListener('keydown', onKey, true);
    this.drag = { kind, id: row.dataset.id!, ghost, grabY: e.clientY - box.top, moving, drop: null, onKey, scrollFrame: 0, lastY: e.clientY };
    this.dragTo(e.clientY);
  }

  private dragTo(y: number) {
    const d = this.drag!;
    d.lastY = y;
    d.ghost.style.top = `${y - d.grabY}px`;
    d.drop = d.kind === 'scene' ? this.sceneDrop(d.id, y) : this.chapterDrop(d.id, y);
    this.show(d.drop);
    // Near the list's edges, it scrolls.
    const box = this.h.tree.getBoundingClientRect();
    const speed = y < box.top + EDGE ? -(box.top + EDGE - y) : y > box.bottom - EDGE ? y - (box.bottom - EDGE) : 0;
    cancelAnimationFrame(d.scrollFrame);
    if (speed) {
      d.scrollFrame = requestAnimationFrame(() => {
        if (this.drag !== d) return;
        this.h.tree.scrollTop += Math.max(-EDGE, Math.min(EDGE, speed)) / 2;
        this.dragTo(d.lastY);
      });
    }
  }

  /**
   * A scene lands before/after a scene row, or at the end of a chapter (over
   * its row). A manuscript scene dropped on Cold Storage is parked; a parked
   * scene dropped in the manuscript is restored there.
   */
  private sceneDrop(sceneId: string, y: number): Drop | null {
    const outline = this.h.outline();
    if (!outline) return null;
    const parked = outline.parked.some((p) => p.id === sceneId);
    const source = outline.chapters.find((c) => c.scenes.some((sc) => sc.id === sceneId));
    if (!parked && !source) return null;
    const fromIndex = source ? source.scenes.findIndex((sc) => sc.id === sceneId) : -1;
    for (const row of this.h.rows()) {
      const b = row.getBoundingClientRect();
      if (y < b.top || y >= b.bottom) continue;
      if (row.dataset.kind === 'cold' || row.dataset.kind === 'parked') {
        // Onto Cold Storage: parks a manuscript scene; a parked one stays put.
        const head = this.h.rowFor(row.dataset.kind === 'cold' ? row.dataset.id! : row.dataset.chapter!)!;
        return { chapterId: head.dataset.id!, index: 0, line: head.getBoundingClientRect().bottom, into: true, noop: parked, cold: true };
      }
      const into = row.dataset.kind === 'chapter';
      const chapterId = into ? row.dataset.id! : row.dataset.chapter!;
      const chapter = outline.chapters.find((c) => c.id === chapterId)!;
      const after = y >= b.top + b.height / 2;
      // Position among the chapter's scenes as they are now.
      const slot = into ? chapter.scenes.length : chapter.scenes.findIndex((sc) => sc.id === row.dataset.id) + (after ? 1 : 0);
      const same = chapterId === source?.id;
      if (source && !same && source.scenes.length === 1) return null; // a chapter always keeps a scene
      const index = same && slot > fromIndex ? slot - 1 : slot;
      return { chapterId, index, line: into || after ? b.bottom : b.top, into, noop: same && index === fromIndex };
    }
    return null;
  }

  /** A chapter lands before or after another chapter's block (its row and scenes). */
  private chapterDrop(chapterId: string, y: number): Drop | null {
    const chapters = this.h.outline()?.chapters ?? [];
    const fromIndex = chapters.findIndex((c) => c.id === chapterId);
    const blocks = chapters.map((c) => {
      const row = this.h.rowFor(c.id)!;
      const group = row.nextElementSibling?.matches('[role="group"]') ? row.nextElementSibling : null;
      return { top: row.getBoundingClientRect().top, bottom: (group ?? row).getBoundingClientRect().bottom };
    });
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (y < b.top && i > 0) continue;
      if (y >= b.bottom && i < blocks.length - 1) continue;
      const after = y >= b.top + Math.min(b.bottom - b.top, 2 * ROW_GUESS) / 2;
      const slot = i + (after ? 1 : 0);
      const index = slot > fromIndex ? slot - 1 : slot;
      const line = after ? (blocks[i + 1]?.top ?? b.bottom) : b.top;
      return { chapterId, index, line, into: false, noop: index === fromIndex };
    }
    return null;
  }

  private show(drop: Drop | null) {
    for (const r of this.h.tree.querySelectorAll<HTMLElement>('[data-drop-into]')) delete r.dataset.dropInto;
    if (!drop || drop.noop || drop.into) this.indicator.dataset.visible = 'false';
    if (!drop || drop.noop) return;
    if (drop.into) { this.h.rowFor(drop.chapterId)!.dataset.dropInto = 'true'; return; }
    const box = this.h.tree.getBoundingClientRect();
    this.indicator.style.top = `${Math.round(drop.line)}px`;
    this.indicator.style.left = `${Math.round(box.left)}px`;
    this.indicator.style.width = `${Math.round(box.width)}px`;
    this.indicator.dataset.kind = this.drag!.kind;
    this.indicator.dataset.visible = 'true';
  }

  private end(commit: boolean) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    cancelAnimationFrame(d.scrollFrame);
    window.removeEventListener('keydown', d.onKey, true);
    for (const r of d.moving) delete r.dataset.dragging;
    delete this.h.panel.dataset.dragging;
    this.show(null);
    this.indicator.remove();
    this.swallowClick = true;
    setTimeout(() => { this.swallowClick = false; }, 0);
    const { ms, easing } = motion();
    const drop = commit && d.drop && !d.drop.noop ? d.drop : null;
    if (!drop) {
      // Nothing moves: the lifted row settles back where it came from.
      const home = this.h.rowFor(d.id)?.getBoundingClientRect();
      if (home && ms) d.ghost.animate([{ top: d.ghost.style.top }, { top: `${home.top}px` }], { duration: ms, easing }).onfinish = () => d.ghost.remove();
      else d.ghost.remove();
      this.h.render(false);
      return;
    }
    // FLIP: remember where every row was, move, then let each glide to its new place.
    const before = rowTops(this.h.rows());
    const ghostTop = d.ghost.getBoundingClientRect().top;
    d.ghost.remove();
    let moved = true;
    if (drop.cold) this.h.park(d.id);
    else if (this.h.outline()?.parked.some((p) => p.id === d.id)) this.h.restore(d.id, drop.chapterId, drop.index);
    else moved = d.kind === 'scene' ? this.h.moveScene(d.id, drop.chapterId, drop.index) : this.h.moveChapter(d.id, drop.index);
    this.h.render(true);
    if (moved) glide(this.h.rows(), before.set(d.id, ghostTop), d.id);
  }
}

/** Where every row is now (viewport y), to glide from after a move. */
export function rowTops(rows: HTMLElement[]): Map<string, number> {
  return new Map(rows.map((r) => [r.dataset.id!, r.getBoundingClientRect().top]));
}

/**
 * FLIP: each row glides from where it was (`before`) to where it is now;
 * the moved row flashes so the eye finds where it landed.
 */
export function glide(rows: HTMLElement[], before: Map<string, number>, movedId: string) {
  const { ms, easing } = motion();
  if (!ms) return;
  for (const row of rows) {
    const was = before.get(row.dataset.id!);
    const dy = was === undefined ? 0 : was - row.getBoundingClientRect().top;
    if (Math.abs(dy) >= 1) row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: ms, easing });
  }
  rows.find((r) => r.dataset.id === movedId)?.animate([{ backgroundColor: 'var(--color-popover-active)' }, { backgroundColor: 'transparent' }], { duration: ms * 3, easing: 'ease-out' });
}

function motion(): { ms: number; easing: string } {
  return { ms: cssNumber('--dur-glide'), easing: cssValue('--ease-out', 'ease-out') };
}
