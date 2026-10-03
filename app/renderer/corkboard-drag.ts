// Drag to reorder on the corkboard (DECISIONS §24, §28): a card, a group (by
// its frame or name), or a chapter by its header. A lifted copy follows the
// pointer; an accent bar shows where it will land — between cards along the
// reading direction (across a row of cards, down a column), between chapters
// across it. A card dropped inside a group's container joins the group there
// (the container lights up); dropped on a card's middle, it joins that card
// (a group forms, or grows); dropped anywhere else it is in no group (that is
// how it leaves one). The board scrolls near its edges; on drop everything
// glides to its new place. Esc, or dropping where it started, changes nothing.

import type { CorkboardLayout } from '../shared/bridge';
import type { Outline } from './outline';
import { cssNumber } from './dom';
import { flash, glideFrom, glideMotion, measure } from './motion';

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
  // Each moves, then redraws at once; false if nothing moved.
  /** A card to a place, in a group there (null: in none). */
  placeScene(sceneId: string, chapterId: string, index: number, group: string | null): boolean;
  /** A card onto another: placed after it, the two grouped. */
  joinGroup(sceneId: string, targetId: string): boolean;
  moveGroup(groupId: string, chapterId: string, index: number): boolean;
  moveChapter(chapterId: string, index: number): boolean;
}

interface Drop {
  chapterId: string;
  /** Index among the target's scenes (or among chapters), as they are once the dragged one has left. */
  index: number;
  /** It would land where it already is. */
  noop: boolean;
  /** The bar, in viewport coordinates (none when dropped on a card). */
  bar: DOMRect | null;
  /** A card: the group it lands in (null: none). */
  group?: string | null;
  /** A card dropped on another's middle: that card (they join). */
  join?: string;
  /** What lights up to take it: the group's container, or the card it joins. */
  into?: HTMLElement;
}

interface Drag {
  kind: 'scene' | 'group' | 'chapter';
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
    if (target.closest('input, [data-action="open"], [data-action="menu"], [data-action="group-menu"], .bt-cork-add')) return;
    // A card; else a group (its frame, its name); else a chapter (its header).
    const card = target.closest<HTMLElement>('.bt-cork-card');
    const group = card ? null : target.closest<HTMLElement>('.bt-cork-group');
    const head = card || group ? null : target.closest<HTMLElement>('.bt-cork-chapter-head');
    const what = card ?? group ?? head;
    const kind: Drag['kind'] = card ? 'scene' : group ? 'group' : 'chapter';
    if (!what) return;
    const start = { x: e.clientX, y: e.clientY };
    const pointer = e.pointerId; // (the drag follows the pointer that began it, no other)
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      if (this.drag) this.dragTo(ev.clientX, ev.clientY);
      else if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > DRAG_THRESHOLD) this.start(what, kind, start, ev);
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
    const source = kind === 'chapter' ? what.closest<HTMLElement>('.bt-cork-chapter')! : what;
    const id = kind === 'scene' ? what.dataset.id! : kind === 'group' ? what.dataset.group! : source.dataset.id!;
    const box = what.getBoundingClientRect();
    const ghost = what.cloneNode(true) as HTMLElement;
    ghost.classList.add('bt-cork-ghost');
    // A picture only: nothing finds it as the card or chapter it copies.
    for (const el of [ghost, ...ghost.querySelectorAll('*')]) for (const attr of ['role', 'tabindex', 'data-id', 'data-group', 'data-action', 'aria-label']) el.removeAttribute(attr);
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
    d.drop = d.kind === 'scene' ? this.sceneDrop(d.id, x, y) : d.kind === 'group' ? this.groupDrop(d.id, x, y) : this.chapterDrop(d.id, x, y);
    this.showBar(d.drop);
    this.showInto(d.drop);
    d.ghost.dataset.join = String(!!d.drop?.join && !d.drop.noop); // (over a card's middle, it steps back: the card it joins shows)
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
   * once the pointer is beyond its middle. On another card's middle it joins
   * that card; inside a group's container it joins the group, at that place.
   */
  private sceneDrop(sceneId: string, x: number, y: number): Drop | null {
    const outline = this.h.outline();
    const source = outline?.chapters.find((c) => c.scenes.some((s) => s.id === sceneId));
    const section = this.nearestSection(x, y);
    if (!source || !section) return null;
    const chapterId = section.dataset.id!;
    const chapter = outline!.chapters.find((c) => c.id === chapterId)!;
    const same = chapterId === source.id;
    if (!same && source.scenes.length === 1) return null; // a chapter always keeps a scene
    const fromIndex = source.scenes.findIndex((s) => s.id === sceneId);
    const fromGroup = source.scenes[fromIndex]!.group;
    const grid = section.querySelector<HTMLElement>('.bt-cork-grid')!;
    // On another card's middle: they join.
    const onto = [...grid.querySelectorAll<HTMLElement>('.bt-cork-card')].find((c) => c.dataset.id !== sceneId && middleOf(c.getBoundingClientRect(), x, y));
    if (onto) {
      const at = chapter.scenes.findIndex((s) => s.id === onto.dataset.id);
      const already = !!fromGroup && chapter.scenes[at]!.group === fromGroup && same && fromIndex === at + 1;
      return { chapterId, index: at, noop: already, bar: null, join: onto.dataset.id, into: onto };
    }
    const slots = [...grid.querySelectorAll<HTMLElement>('.bt-cork-card, .bt-cork-add')]; // the cards (a group's too), then the tile
    const rows = this.h.layout() === 'rows';
    let slot = 0;
    while (slot < slots.length - 1 && passed(slots[slot]!.getBoundingClientRect(), x, y, rows)) slot++;
    let index = same && slot > fromIndex ? slot - 1 : slot;
    // Inside a group's container: in that group, within its span.
    const box = [...grid.querySelectorAll<HTMLElement>('.bt-cork-group')].find((g) => contains(g.getBoundingClientRect(), x, y)) ?? null;
    const group = box?.dataset.group ?? null;
    if (group) {
      const others = chapter.scenes.filter((s) => s.id !== sceneId);
      const first = others.findIndex((s) => s.group === group);
      const last = others.length - 1 - [...others].reverse().findIndex((s) => s.group === group);
      if (first >= 0) index = Math.max(first, Math.min(index, last + 1));
    }
    const r = slots[slot]!.getBoundingClientRect();
    const half = gapOf(grid, rows ? 'column' : 'row') / 2;
    const bar = rows ? new DOMRect(r.left - half, r.top, 0, r.height) : new DOMRect(r.left, r.top - half, r.width, 0);
    return { chapterId, index, noop: same && index === fromIndex && group === fromGroup, bar, group, ...(box ? { into: box } : {}) };
  }

  /**
   * A group lands between the cards and groups of the chapter nearest the
   * pointer — never inside another group (it lands before or after it).
   */
  private groupDrop(groupId: string, x: number, y: number): Drop | null {
    const outline = this.h.outline();
    const source = outline?.chapters.find((c) => c.scenes.some((s) => s.group === groupId));
    const section = this.nearestSection(x, y);
    if (!source || !section) return null;
    const chapterId = section.dataset.id!;
    const members = source.scenes.filter((s) => s.group === groupId).length;
    if (chapterId !== source.id && source.scenes.length === members) return null; // a chapter always keeps a scene
    const grid = section.querySelector<HTMLElement>('.bt-cork-grid')!;
    // The chapter as units: each card outside a group, each other group, then the tile.
    const units = [...grid.children].filter((u): u is HTMLElement => u instanceof HTMLElement && u.dataset.group !== groupId);
    const rows = this.h.layout() === 'rows';
    let slot = 0;
    while (slot < units.length - 1 && passed(units[slot]!.getBoundingClientRect(), x, y, rows)) slot++;
    const index = units.slice(0, slot).reduce((n, u) => n + (u.classList.contains('bt-cork-group') ? u.querySelectorAll('.bt-cork-card').length : 1), 0);
    const first = source.scenes.findIndex((s) => s.group === groupId);
    const r = units[slot]!.getBoundingClientRect();
    const half = gapOf(grid, rows ? 'column' : 'row') / 2;
    const bar = rows ? new DOMRect(r.left - half, r.top, 0, r.height) : new DOMRect(r.left, r.top - half, r.width, 0);
    return { chapterId, index, noop: chapterId === source.id && index === first, bar };
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

  /** What lights up to take the card: a group's container, or the card it would join. */
  private showInto(drop: Drop | null) {
    for (const el of this.h.board.querySelectorAll<HTMLElement>('[data-drop-into]')) delete el.dataset.dropInto;
    if (drop?.into && !drop.noop) drop.into.dataset.dropInto = drop.join ? 'join' : 'group';
  }

  private showBar(drop: Drop | null) {
    const shown = !!drop?.bar && !drop.noop;
    const appearing = shown && this.bar.dataset.visible !== 'true';
    this.bar.dataset.visible = String(shown);
    if (!shown) return;
    const thick = cssNumber('--cork-drop-w');
    const b = drop.bar!;
    const vertical = b.width === 0;
    // Appearing, it fades in where it is; from one gap to the next, it glides.
    if (appearing) this.bar.style.transitionProperty = 'opacity';
    place(this.bar, this.h.root, b.left - (vertical ? thick / 2 : 0), b.top - (vertical ? 0 : thick / 2));
    this.bar.style.width = `${vertical ? thick : b.width}px`;
    this.bar.style.height = `${vertical ? b.height : thick}px`;
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
    this.showInto(null);
    this.swallowClick = true;
    setTimeout(() => { this.swallowClick = false; }, 0);
    const { ms, easing } = glideMotion();
    const drop = commit && d.drop && !d.drop.noop ? d.drop : null;
    if (!drop) {
      // Nothing moves: the lifted copy settles back where it came from.
      const home = (d.kind === 'chapter' ? head(d.source) : d.source).getBoundingClientRect();
      const root = this.h.root.getBoundingClientRect();
      if (ms) d.ghost.animate([{}, { left: `${home.left - root.left}px`, top: `${home.top - root.top}px` }], { duration: ms, easing }).onfinish = () => d.ghost.remove();
      else d.ghost.remove();
      return;
    }
    // FLIP: remember where everything was, move, then let each glide to its new place.
    const before = measure(this.items());
    if (d.kind !== 'group') before.set(d.kind === 'scene' ? d.id : `chapter:${d.id}`, d.ghost.getBoundingClientRect()); // (a group's cards glide from where they were)
    d.ghost.remove();
    const moved = d.kind === 'chapter' ? this.h.moveChapter(d.id, drop.index)
      : d.kind === 'group' ? this.h.moveGroup(d.id, drop.chapterId, drop.index)
      : drop.join ? this.h.joinGroup(d.id, drop.join)
      : this.h.placeScene(d.id, drop.chapterId, drop.index, drop.group ?? null);
    if (moved) this.glide(before, d.kind, d.id);
  }

  /** The cards (by id) and chapter headers (`chapter:<id>`) as laid out now. */
  private items(): [string, HTMLElement][] {
    return [
      ...[...this.h.board.querySelectorAll<HTMLElement>('.bt-cork-card')].map((c): [string, HTMLElement] => [c.dataset.id!, c]),
      ...this.sections().map((s): [string, HTMLElement] => [`chapter:${s.dataset.id}`, head(s)]),
    ];
  }

  /**
   * Everything glides from where it was; the moved one flashes, so the eye
   * finds where it landed. A chapter moves as one (its section, by its
   * header's travel); after a card, the cards and the headers each glide.
   */
  private glide(before: Map<string, DOMRect>, kind: Drag['kind'], movedId: string) {
    if (kind === 'chapter') {
      glideFrom(before, this.sections().map((s) => [`chapter:${s.dataset.id}`, s, head(s)] as const));
      const landed = this.sections().find((s) => s.dataset.id === movedId);
      flash(landed && head(landed));
    } else {
      glideFrom(before, this.items());
      flash(kind === 'group'
        ? this.h.board.querySelector<HTMLElement>(`.bt-cork-group[data-group="${CSS.escape(movedId)}"]`)
        : this.h.board.querySelector<HTMLElement>(`.bt-cork-card[data-id="${CSS.escape(movedId)}"]`));
    }
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

/** Along the reading direction, the pointer is past this card (or unit): past its middle (rows: across, on its line; columns: down). */
function passed(r: DOMRect, x: number, y: number, rows: boolean): boolean {
  return rows ? y >= r.bottom || (y >= r.top && x >= r.left + r.width / 2) : y >= r.top + r.height / 2;
}

const contains = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/** The middle of a card, where a card dropped joins it: its central 40% each way (nearer its edges, a drop places beside it). */
const JOIN_ZONE = 0.2;
const middleOf = (r: DOMRect, x: number, y: number) => Math.abs(x - (r.left + r.width / 2)) < r.width * JOIN_ZONE && Math.abs(y - (r.top + r.height / 2)) < r.height * JOIN_ZONE;
