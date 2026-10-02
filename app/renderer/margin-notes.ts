// Margin notes (spec §9, DECISIONS §16): each open note about a passage
// floats in the right margin beside it. Cards never overlap — they're
// stacked in the passages' order, and the active card sits level with its
// passage while the others make room. When the margin is too narrow for
// cards, each note shows as a small marker that opens it in the notes panel.

import type { EditorView } from 'prosemirror-view';
import { anchorsIn, parkedKey } from '@baretext/editor';
import type { Note } from '../shared/notes';
import type { NotesStore } from './notes-store';
import { NoteBody } from './note-body';

/** Resolve: a check in a circle, as on a comment in Google Docs. */
const RESOLVE = '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="7.25"/><path d="M6.75 10.25l2.25 2.25 4.25-4.75"/></svg>';


export interface MarginHost {
  view(): EditorView | null;
  store: NotesStore;
  /** Open a note in the notes panel (when the margin has no room for cards). */
  openInPanel(id: string): void;
  /** Delete a note and its anchor (a new note abandoned). */
  discard(id: string): void;
  /** Back to the manuscript (a note saved or cancelled). */
  toEditor(): void;
}

export class MarginNotes {
  readonly el: HTMLElement;
  private readonly cards = new Map<string, HTMLElement>();
  private readonly bodies = new Map<string, NoteBody>();
  private active: string | null = null;
  private frame = 0;
  private compact = false;
  private readonly activeRule = new CSSStyleSheet();
  /** Resolved notes' passages read as plain text again. */
  private readonly resolvedRule = new CSSStyleSheet();

  constructor(private readonly page: HTMLElement, private readonly scroller: HTMLElement, private readonly h: MarginHost) {
    this.el = document.createElement('div');
    this.el.className = 'bt-margin-notes';
    this.el.setAttribute('aria-label', 'Notes');
    page.append(this.el);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.activeRule, this.resolvedRule]; // resolved wins
    h.store.onChange(() => { this.unhighlightResolved(); this.refresh(); });
    new ResizeObserver(() => this.refresh()).observe(scroller);
  }

  /**
   * No room beside the page for cards — measured now, from layout (the page
   * is centered in the scroller), so a page mid-glide doesn't skew it.
   */
  get isCompact(): boolean {
    const room = (this.scroller.clientWidth - this.page.offsetWidth) / 2;
    return room < cssPx('--note-card-w') + 2 * cssPx('--note-gap');
  }

  private unhighlightResolved() {
    const ids = this.h.store.all.filter((n) => n.resolved && n.anchor).map((n) => `.bt-note-anchor[data-note="${CSS.escape(n.id)}"]`);
    this.resolvedRule.replaceSync(ids.length ? `${ids.join(', ')} { background: none; }` : '');
  }

  /** Something moved (an edit, a resize, a note added or resolved): lay the cards out again, once per frame. */
  refresh() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.layout(); });
  }

  /** Make a note the active one (its passage highlighted, its card level with it); `focus` puts the caret in it. */
  setActive(id: string | null, focus = false) {
    this.active = id;
    this.activeRule.replaceSync(id ? `.bt-note-anchor[data-note="${CSS.escape(id)}"] { background: var(--color-note-active); }` : '');
    for (const [nid, card] of this.cards) card.dataset.active = String(nid === id);
    this.layout();
    if (id && focus) {
      if (this.compact) { this.h.openInPanel(id); return; }
      if (!this.h.store.get(id)?.body) this.bodies.get(id)?.focus(); // a new note: write it
    }
    const card = id ? this.cards.get(id) : null;
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /**
   * Fade the cards out (drifting toward the notes panel, held on screen
   * meanwhile) or back in after `delay` (drifting home). Resolves true when
   * a fade-out has run its course, false if it was interrupted.
   */
  fade(show: boolean, duration: number, delay = 0): Promise<boolean> {
    for (const a of this.el.getAnimations()) a.cancel();
    delete this.el.dataset.leaving;
    if (!duration) return Promise.resolve(true);
    const ease = (token: string) => getComputedStyle(document.documentElement).getPropertyValue(token).trim() || 'ease';
    const frames = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${cssPx('--notes-drift')}px)` }];
    if (show) {
      this.el.animate(frames.reverse(), { duration, delay, easing: ease('--ease-out'), fill: 'backwards' });
      return Promise.resolve(true);
    }
    this.el.dataset.leaving = 'true';
    const anim = this.el.animate(frames, { duration, easing: ease('--ease-in-out'), fill: 'forwards' });
    // Gone: the panel takes over this frame (before paint), then the hold is let go.
    return anim.finished.then(() => { requestAnimationFrame(() => { if (anim.playState === 'finished') { anim.cancel(); delete this.el.dataset.leaving; this.refresh(); } }); return true; }, () => false);
  }

  /** The notes shown in the margin: open, about a passage that's on the page now. */
  private visible(view: EditorView): Array<{ note: Note; from: number }> {
    const anchors = anchorsIn(view.state.doc);
    const open = parkedKey.getState(view.state);
    const coldStart = view.state.doc.content.size - view.state.doc.lastChild!.nodeSize;
    return this.h.store.all.flatMap((note) => {
      const a = note.resolved || !note.anchor ? null : anchors.get(note.id);
      if (!a) return [];
      const onPage = open ? a.scene === open : a.from < coldStart;
      return onPage ? [{ note, from: a.from }] : [];
    }).sort((x, y) => x.from - y.from);
  }

  private layout() {
    const view = this.h.view();
    if (!view || this.el.dataset.leaving) return; // fading out as it is
    const shown = this.visible(view);
    const pageBox = this.page.getBoundingClientRect();
    this.compact = this.isCompact;
    this.el.dataset.compact = String(this.compact);

    // Cards in, cards out.
    const ids = new Set(shown.map((s) => s.note.id));
    for (const [id, card] of this.cards) if (!ids.has(id)) { card.remove(); this.cards.delete(id); this.bodies.delete(id); }
    for (const { note } of shown) if (!this.cards.has(note.id)) this.cards.set(note.id, this.card(note));

    // Each card's passage height on the page; then make room without overlaps.
    const gap = cssPx('--note-stack-gap');
    const items = shown.map(({ note, from }) => {
      const card = this.cards.get(note.id)!;
      let want = 0;
      try { want = view.coordsAtPos(from).top - pageBox.top; } catch { /* not laid out */ }
      return { card, want, height: this.compact ? 0 : card.offsetHeight };
    });
    const ai = items.findIndex((it) => it.card.dataset.note === this.active);
    const tops = items.map((it) => it.want);
    if (!this.compact) {
      const start = ai >= 0 ? ai : 0;
      for (let i = start + 1; i < items.length; i++) tops[i] = Math.max(tops[i]!, tops[i - 1]! + items[i - 1]!.height + gap);
      for (let i = start - 1; i >= 0; i--) tops[i] = Math.min(tops[i]!, tops[i + 1]! - items[i]!.height - gap);
    }
    items.forEach((it, i) => {
      // A new card appears in place; after that, cards glide as they make room.
      const placed = it.card.dataset.placed === 'true';
      if (!placed) it.card.style.transition = 'none';
      it.card.style.transform = `translateY(${Math.round(tops[i]!)}px)`;
      if (!placed) { void it.card.offsetWidth; it.card.style.transition = ''; it.card.dataset.placed = 'true'; }
    });
  }

  private card(note: Note): HTMLElement {
    const card = document.createElement('div');
    card.className = 'bt-note-card';
    card.dataset.note = note.id;
    card.dataset.active = String(note.id === this.active);
    const marker = Object.assign(document.createElement('button'), { type: 'button', className: 'bt-note-marker', title: 'Open note' });
    marker.setAttribute('aria-label', 'Open note');
    marker.addEventListener('click', () => this.h.openInPanel(note.id));
    const resolve = Object.assign(document.createElement('button'), { type: 'button', className: 'bt-note-resolve', title: 'Resolve (hides the note; Show resolved in the notes panel brings it back)', innerHTML: RESOLVE });
    resolve.setAttribute('aria-label', 'Resolve');
    resolve.addEventListener('click', () => this.h.store.update(note.id, { resolved: true }));
    const body = new NoteBody({
      text: note.body,
      editing: !note.body,
      onSave: (text) => { this.h.store.update(note.id, { body: text }); this.refresh(); },
      onCancel: (wasNew) => { if (wasNew) this.h.discard(note.id); else this.refresh(); },
      // Resolve only for a saved note that isn't being written.
      onMode: (editing) => { card.dataset.editing = String(editing); this.refresh(); },
      onDone: () => this.h.toEditor(),
    });
    this.bodies.set(note.id, body);
    body.el.addEventListener('focusin', () => { if (this.active !== note.id) this.setActive(note.id); });
    card.append(marker, body.el, resolve);
    this.el.append(card);
    return card;
  }

}

function cssPx(token: string): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)) || 0;
}
