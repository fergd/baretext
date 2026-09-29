// Typewriter mode: keep the caret's line at the vertical center.
//
// The scroll position is always committed instantly and exactly; only a
// compositor transform animates the move to a new line (FLIP), so motion
// never delays input. A new move while one is running retargets from the
// current visual offset — nothing queues.

import type { EditorView } from 'prosemirror-view';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export class Typewriter {
  enabled = false;
  private anim: Animation | null = null;
  private programmaticScroll = false;

  constructor(
    private readonly app: HTMLElement,
    private readonly scroller: HTMLElement,
    private readonly page: HTMLElement,
    private readonly view: () => EditorView | null,
  ) {
    // Manual scrolling is authoritative: it relaxes the fade and never
    // snaps back. Only our own scroll writes are ignored.
    scroller.addEventListener('wheel', () => this.relax(true), { passive: true });
    scroller.addEventListener('scroll', () => {
      if (this.programmaticScroll) this.programmaticScroll = false;
    });
    new ResizeObserver(() => this.layout()).observe(scroller);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.app.dataset.typewriter = String(on);
    this.relax(false);
    this.layout();
  }

  relax(on: boolean) {
    if (!this.enabled) return;
    this.app.dataset.twRelaxed = String(on);
  }

  private layout() {
    const half = Math.round(this.scroller.clientHeight / 2);
    this.page.style.setProperty('--tw-pad', `${half}px`);
    if (this.enabled) this.recenter(false);
  }

  private currentOffset(): number {
    const t = getComputedStyle(this.page).transform;
    return t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0;
  }

  /** Line box height of the textblock holding the caret (24 body, 48/64 titles). */
  private lineHeight(view: EditorView): number {
    const { node } = view.domAtPos(view.state.selection.head);
    const el = (node.nodeType === 1 ? node : node.parentNode) as HTMLElement | null;
    const block = el?.closest('p, h1, h2, h3') as HTMLElement | null;
    const lh = block ? parseFloat(getComputedStyle(block).lineHeight) : NaN;
    return Number.isFinite(lh) ? lh : 24;
  }

  recenter(animate = true) {
    const view = this.view();
    if (!this.enabled || !view) return;
    this.relax(false);
    const head = view.state.selection.head;
    let coords: { top: number; bottom: number };
    try { coords = view.coordsAtPos(head); } catch { return; }
    this.scroller.style.setProperty('--tw-band', `${this.lineHeight(view)}px`);

    const offset = this.currentOffset();
    const rect = this.scroller.getBoundingClientRect();
    const lineMid = (coords.top + coords.bottom) / 2 - offset;
    const center = rect.top + this.scroller.clientHeight / 2;
    const delta = Math.round(lineMid - center);
    if (Math.abs(delta) < 1) return;

    const before = this.scroller.scrollTop;
    this.programmaticScroll = true;
    this.scroller.scrollTop = before + delta;
    const applied = this.scroller.scrollTop - before;

    this.anim?.cancel();
    this.anim = null;
    const far = Math.abs(applied) > this.scroller.clientHeight / 2;
    if (!animate || far || reducedMotion.matches || applied === 0) return;
    this.anim = this.page.animate(
      [{ transform: `translateY(${offset + applied}px)` }, { transform: 'translateY(0)' }],
      { duration: 140, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
    this.anim.onfinish = () => { this.anim = null; };
  }
}
