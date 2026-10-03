// Drag to reorder on the corkboard (DECISIONS §24): a card, or a chapter by
// its header. A lifted copy follows the pointer; an accent bar shows where it
// will land — between cards along the reading direction (across a row of
// cards, down a column), between chapters across it; the board scrolls near
// its edges; on drop everything glides to its new place. Esc, or dropping
// where it started, changes nothing.

import type { CorkboardLayout } from '../shared/bridge';
import type { Outline } from './outline';
import { cssNumber, cssValue } from './dom';

const DRAG_THRESHOLD = 4;
/** Pointer this close to the board's edges scrolls it. */
const EDGE = 48;

export interface BoardDragHost {
  /** The board's overlay: the lifted copy and the bar are drawn in it. */
  readonly root: HTMLElement;
  /** The scrolling cards' area. */
  readonly board: HTMLElement;
  layout(): CorkboardLayout;
  outline(): Outline | null;
  /** False while something else owns the pointer (an inline rename). */
  canDrag(): boolean;
  /** Move, then redraw at once; false if nothing moved. */
  moveScene(sceneId: string, chapterId: string, index: number): boolean;
  moveChapter(chapterId: string, index: number): boolean;
}

interface Drop {
  chapterId: string;
  /** Index among the target's scenes (or among chapters), as they are once the dragged one has left. */
  index: number;
  /** It would land where it already is. */
  noop: boolean;
  /** The bar, in viewport coordinates. */
  bar: DOMRect;
}

interface Drag {
  kind: 'scene' | 'chapter';
  id: string;
  /** What stays behind, dimmed (a card, or a chapter's section). */
  source: HTMLElement;
  ghost: HTMLElement;
  grab: { x: number; y: number };
  last: { x: number; y: number };
  drop: Drop | null;
  onKey: (e: KeyboardEvent) => void;
  scrollFrame: number;
}

export class BoardDrag {
  private drag: Drag | null = null;
  /** A drag just ended on this pointer-up: the click that follows does nothing. */
  private swallowClick = false;
  private readonly bar: HTMLElement;

  constructor(private readonly h: BoardDragHost) {
    this.bar = document.createElement('div');
    this.bar.className = 'bt-cork-drop';
    this.bar.setAttribute('aria-hidden', 'true');
    h.board.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  get active(): boolean {
    return this.drag !== null;
  }

  /** True once, for the click that ends a drag. */
  consumeClick(): boolean {
    const swallow = this.swallowClick;
    this.swallowClick = false;
    return swallow;
  }

  /** Stop a drag in progress, changing nothing (the board closed). */
  cancel() {
    this.end(false);
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !this.h.canDrag()) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, [data-action="open"], .bt-cork-add')) return;
    const card = target.closest<HTMLElement>('.bt-cork-card');
    const head = card ? null : target.closest<HTMLElement>('.bt-cork-chapter-head');
    const what = card ?? head;
    if (!what) return;
    const start = { x: e.clientX, y: e.clientY };
    const pointer = e.pointerId; // (the drag follows the pointer that began it, no other)
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      if (this.drag) this.dragTo(ev.clientX, ev.clientY);
      else if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > DRAG_THRESHOLD) this.start(what, card ? 'scene' : 'chapter', start, ev);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (this.drag) this.end(ev.type === 'pointerup');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  private start(what: HTMLElement, kind: Drag['kind'], at: { x: number; y: number }, e: PointerEvent) {
    const source = kind === 'scene' ? what : what.closest<HTMLElement>('.bt-cork-chapter')!;
    const id = kind === 'scene' ? what.dataset.id! : source.dataset.id!;
    const box = what.getBoundingClientRect();
    const ghost = what.cloneNode(true) as HTMLElement;
    ghost.classList.add('bt-cork-ghost');
    // A picture only: nothing finds it as the card or chapter it copies.
    for (const el of [ghost, ...ghost.querySelectorAll('*')]) for (const attr of ['role', 'tabindex', 'data-id', 'data-action', 'aria-label']) el.removeAttribute(attr);
    ghost.style.width = `${box.width}px`;
    ghost.style.height = `${box.height}px`;
    source.dataset.dragging = 'true';
    this.h.root.dataset.dragging = kind;
    this.h.root.append(ghost, this.bar); // (the bar above the lifted copy)
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation(); // Esc cancels the drag, nothing else
      this.end(false);
    };
    window.addEventListener('keydown', onKey, true);
    this.drag = { kind, id, source, ghost, grab: { x: at.x - box.left, y: at.y - box.top }, last: at, drop: null, onKey, scrollFrame: 0 };
    this.dragTo(e.clientX, e.clientY);
  }

  private dragTo(x: number, y: number) {
    const d = this.drag!;
    d.last = { x, y };
    place(d.ghost, this.h.root, x - d.grab.x, y - d.grab.y);
    d.drop = d.kind === 'scene' ? this.sceneDrop(d.id, x, y) : this.chapterDrop(d.id, x, y);
    this.showBar(d.drop);
    // Near the board's edges, it scrolls (either way).
    const box = this.h.board.getBoundingClientRect();
    const speed = (p: number, lo: number, hi: number) => (p < lo + EDGE ? p - (lo + EDGE) : p > hi - EDGE ? p - (hi - EDGE) : 0);
    const [dx, dy] = [speed(x, box.left, box.right), speed(y, box.top, box.bottom)];
    cancelAnimationFrame(d.scrollFrame);
    if (dx || dy) {
      d.scrollFrame = requestAnimationFrame(() => {
        if (this.drag !== d) return;
        const clamp = (v: number) => Math.max(-EDGE, Math.min(EDGE, v)) / 2;
        this.h.board.scrollLeft += clamp(dx);
        this.h.board.scrollTop += clamp(dy);
        this.dragTo(d.last.x, d.last.y);
      });
    }
  }

  /**
   * A card lands before another card of the chapter nearest the pointer, or
   * at its end (its last tile). Along the reading direction a card is passed
   * once the pointer is beyond its middle.
   */
  private sceneDrop(sceneId: string, x: number, y: number): Drop | null {
    const outline = this.h.outline();
    const source = outline?.chapters.find((c) => c.scenes.some((s) => s.id === sceneId));
    const section = this.nearestSection(x, y);
    if (!source || !section) return null;
    const chapterId = section.dataset.id!;
    const same = chapterId === source.id;
    if (!same && source.scenes.length === 1) return null; // a chapter always keeps a scene
    const grid = section.querySelector<HTMLElement>('.bt-cork-grid')!;
    const slots = [...grid.querySelectorAll<HTMLElement>('.bt-cork-card, .bt-cork-add')]; // the cards, then the tile
    const rows = this.h.layout() === 'rows';
    const passed = (r: DOMRect) => (rows ? y >= r.bottom || (y >= r.top && x >= r.left + r.width / 2) : y >= r.top + r.height / 2);
    let slot = 0;
    while (slot < slots.length - 1 && passed(slots[slot]!.getBoundingClientRect())) slot++;
    const fromIndex = source.scenes.findIndex((s) => s.id === sceneId);
    const index = same && slot > fromIndex ? slot - 1 : slot;
    // The bar: in the gap before the slot's card (beside it in rows, above it in columns).
    const r = slots[slot]!.getBoundingClientRect();
    const half = gapOf(grid, rows ? 'column' : 'row') / 2;
    const bar = rows ? new DOMRect(r.left - half, r.top, 0, r.height) : new DOMRect(r.left, r.top - half, r.width, 0);
    return { chapterId, index, noop: same && index === fromIndex, bar };
  }

  /** A chapter lands before or after another: across the chapters (down in rows, along in columns), past their middles. */
  private chapterDrop(chapterId: string, x: number, y: number): Drop | null {
    const sections = this.sections();
    const fromIndex = sections.findIndex((s) => s.dataset.id === chapterId);
    if (fromIndex < 0) return null;
    const rows = this.h.layout() === 'rows';
    const boxes = sections.map((s) => s.getBoundingClientRect());
    const slot = boxes.filter((b) => (rows ? y >= b.top + b.height / 2 : x >= b.left + b.width / 2)).length;
    const index = slot > fromIndex ? slot - 1 : slot;
    // The bar: midway in the gap between two chapters (or just outside the first or last).
    const half = (boxes.length > 1 ? (rows ? boxes[1]!.top - boxes[0]!.bottom : boxes[1]!.left - boxes[0]!.right) : cssNumber('--space-8')) / 2;
    const before = boxes[slot - 1];
    const after = boxes[slot];
    const edge = after ? (rows ? after.top : after.left) - half : (rows ? before!.bottom : before!.right) + half;
    const span = (after ?? before)!;
    const bar = rows ? new DOMRect(span.left, edge, span.width, 0) : new DOMRect(edge, span.top, 0, span.height);
    return { chapterId, index, noop: index === fromIndex, bar };
  }

  /** The chapter under the pointer, or the nearest one across the gaps (the board's stacking direction). */
  private nearestSection(x: number, y: number): HTMLElement | null {
    const rows = this.h.layout() === 'rows';
    let best: HTMLElement | null = null;
    let bestDistance = Infinity;
    for (const s of this.sections()) {
      const b = s.getBoundingClientRect();
      const [p, lo, hi] = rows ? [y, b.top, b.bottom] : [x, b.left, b.right];
      const distance = p < lo ? lo - p : p > hi ? p - hi : 0;
      if (distance < bestDistance) [best, bestDistance] = [s, distance];
    }
    return best;
  }

  private sections(): HTMLElement[] {
    return [...this.h.board.querySelectorAll<HTMLElement>('.bt-cork-chapter')];
  }

  private showBar(drop: Drop | null) {
    const shown = !!drop && !drop.noop;
    const appearing = shown && this.bar.dataset.visible !== 'true';
    this.bar.dataset.visible = String(shown);
    if (!shown) return;
    const thick = cssNumber('--cork-drop-w');
    const vertical = drop.bar.width === 0;
    // Appearing, it fades in where it is; from one gap to the next, it glides.
    if (appearing) this.bar.style.transitionProperty = 'opacity';
    place(this.bar, this.h.root, drop.bar.left - (vertical ? thick / 2 : 0), drop.bar.top - (vertical ? 0 : thick / 2));
    this.bar.style.width = `${vertical ? thick : drop.bar.width}px`;
    this.bar.style.height = `${vertical ? drop.bar.height : thick}px`;
    if (appearing) { void this.bar.offsetWidth; this.bar.style.transitionProperty = ''; }
  }

  private end(commit: boolean) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    cancelAnimationFrame(d.scrollFrame);
    window.removeEventListener('keydown', d.onKey, true);
    delete d.source.dataset.dragging;
    delete this.h.root.dataset.dragging;
    this.bar.remove();
    this.swallowClick = true;
    setTimeout(() => { this.swallowClick = false; }, 0);
    const { ms, easing } = motion();
    const drop = commit && d.drop && !d.drop.noop ? d.drop : null;
    if (!drop) {
      // Nothing moves: the lifted copy settles back where it came from.
      const home = (d.kind === 'scene' ? d.source : head(d.source)).getBoundingClientRect();
      const root = this.h.root.getBoundingClientRect();
      if (ms) d.ghost.animate([{}, { left: `${home.left - root.left}px`, top: `${home.top - root.top}px` }], { duration: ms, easing }).onfinish = () => d.ghost.remove();
      else d.ghost.remove();
      return;
    }
    // FLIP: remember where everything was, move, then let each glide to its new place.
    const before = this.positions();
    before.set(d.kind === 'scene' ? d.id : `chapter:${d.id}`, d.ghost.getBoundingClientRect());
    d.ghost.remove();
    const moved = d.kind === 'scene' ? this.h.moveScene(d.id, drop.chapterId, drop.index) : this.h.moveChapter(d.id, drop.index);
    if (moved) this.glide(before, d.kind, d.id);
  }

  /** Where every card and chapter header is now: cards by id, headers as `chapter:<id>`. */
  private positions(): Map<string, DOMRect> {
    const at = new Map<string, DOMRect>();
    for (const card of this.h.board.querySelectorAll<HTMLElement>('.bt-cork-card')) at.set(card.dataset.id!, card.getBoundingClientRect());
    for (const s of this.sections()) at.set(`chapter:${s.dataset.id}`, head(s).getBoundingClientRect());
    return at;
  }

  /**
   * Everything glides from where it was (`before`) to where it is now; the
   * moved one flashes, so the eye finds where it landed. A chapter moves as
   * one (its section, by its header's travel); after a card, the cards and
   * the headers each glide.
   */
  private glide(before: Map<string, DOMRect>, kind: Drag['kind'], movedId: string) {
    const { ms, easing } = motion();
    if (!ms) return;
    const travel = (el: HTMLElement, was: DOMRect | undefined, by: HTMLElement = el) => {
      if (!was) return;
      const is = by.getBoundingClientRect();
      const [dx, dy] = [was.left - is.left, was.top - is.top];
      if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: ms, easing });
    };
    for (const s of this.sections()) {
      if (kind === 'chapter') travel(s, before.get(`chapter:${s.dataset.id}`), head(s));
      else travel(head(s), before.get(`chapter:${s.dataset.id}`));
    }
    if (kind === 'scene') for (const card of this.h.board.querySelectorAll<HTMLElement>('.bt-cork-card')) travel(card, before.get(card.dataset.id!));
    const landed = kind === 'scene'
      ? this.h.board.querySelector<HTMLElement>(`.bt-cork-card[data-id="${CSS.escape(movedId)}"]`)
      : this.sections().find((s) => s.dataset.id === movedId);
    const flash = landed && (kind === 'scene' ? landed : head(landed));
    flash?.animate([{ backgroundColor: 'var(--color-popover-active)' }, {}], { duration: ms * 3, easing: 'ease-out' });
  }
}

const head = (section: HTMLElement) => section.querySelector<HTMLElement>('.bt-cork-chapter-head')!;

/** Put `el` (absolutely placed in `root`) at viewport point (x, y). */
function place(el: HTMLElement, root: HTMLElement, x: number, y: number) {
  const r = root.getBoundingClientRect();
  el.style.left = `${x - r.left}px`;
  el.style.top = `${y - r.top}px`;
}

function gapOf(el: HTMLElement, axis: 'row' | 'column'): number {
  return parseFloat(getComputedStyle(el)[axis === 'row' ? 'rowGap' : 'columnGap']) || 0;
}

function motion(): { ms: number; easing: string } {
  return { ms: cssNumber('--dur-glide'), easing: cssValue('--ease-out', 'ease-out') };
}
