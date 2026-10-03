// Notes (DECISIONS §16): floating beside their passages in the margin, and
// a panel on the right. This coordinates the three — the store, the margin
// cards, the panel — and the hand-off between the cards and the panel.

import { addNoteAnchor, anchorsIn, describeAnchor, removeNoteAnchor } from '@baretext/editor';
import { newId } from '@baretext/format';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { BaretextBridge } from '../shared/bridge';
import { cssNumber } from './dom';
import { MarginNotes } from './margin-notes';
import { NotesPanel } from './notes-panel';
import { NotesStore } from './notes-store';
import { outlineOf } from './outline';
import type { ToastKind } from './status';

export interface NotesHost {
  bridge: BaretextBridge;
  view(): EditorView | null;
  page: HTMLElement;
  scroller: HTMLElement;
  workspace: HTMLElement;
  /** Where the window's modes live (focus mode, …). */
  app: HTMLElement;
  toast(message: string, kind?: ToastKind): void;
  /** The keyboard back to the page. */
  toPage(): void;
  typewriterOn(): boolean;
  /** Slide the panel in or out (the side columns' motion); its length. */
  slide(open: boolean, change: () => void, animate: boolean): number;
  /** A parked scene's note: open that scene on the page; any other: back to the manuscript. */
  parked: { open(sceneId: string): void; leave(): void };
  /** The open notes changed: how many there are now. */
  changed(open: number): void;
  /** The panel opened or closed. */
  presence(open: boolean): void;
}

export class Notes {
  readonly store: NotesStore;
  readonly margin: MarginNotes;
  readonly panel: NotesPanel;
  /** The cards fading out on their way to the panel (what to do once it is open). */
  private handoff: { queued: Array<() => void>; cancel(): void } | null = null;

  constructor(private readonly h: NotesHost) {
    this.store = new NotesStore(h.bridge, () => h.view(), (message) => h.toast(message, 'error'));
    this.margin = new MarginNotes(h.page, h.scroller, {
      view: () => h.view(),
      store: this.store,
      openInPanel: (id) => this.setPanel(true, () => this.panel.focusNote(id)),
      discard: (id) => this.discard(id),
      toEditor: () => h.toPage(),
    });
    this.panel = new NotesPanel(h.workspace, {
      view: () => h.view(),
      store: this.store,
      show: (id) => this.show(id),
      remove: (id) => this.discard(id),
      toEditor: () => h.toPage(),
      onPresence: (open) => h.presence(open),
    });
    this.store.onChange(() => h.changed(this.store.all.filter((n) => !n.resolved).length));
  }

  /**
   * Open or close the panel. The floating notes hand off to it: they fade
   * out (drifting toward the panel) and, as they finish, it slides in;
   * closing, it slides out and they drift back in as it settles — one
   * motion, not two. `then` runs once the panel is open (or closed).
   */
  setPanel(open: boolean, then?: () => void) {
    if (this.handoff) {
      if (open) { if (then) this.handoff.queued.push(then); return; } // already on its way
      this.handoff.cancel(); // changed their mind mid-fade: the cards come back
      then?.();
      return;
    }
    if (open === this.panel.isOpen) { then?.(); return; }
    const out = open && this.marginShows() && this.margin.el.childElementCount > 0 ? cssNumber('--dur-notes-out') : 0;
    if (out) {
      // The cards fade where they are; the page makes room only once they've gone.
      const handoff = { queued: then ? [then] : [], cancel: () => { this.handoff = null; void this.margin.fade(true, 0); } };
      this.handoff = handoff;
      void this.margin.fade(false, out).then((done) => {
        if (this.handoff !== handoff || !done) return;
        this.handoff = null;
        this.slidePanel(true);
        for (const f of handoff.queued) f();
      });
      return;
    }
    this.slidePanel(open);
    then?.();
  }

  /** The panel is open, or on its way. */
  get panelWanted(): boolean {
    return this.panel.isOpen || !!this.handoff;
  }

  /** Margin cards show in manuscript mode — not with the panel open, in typewriter or focus mode, or without room. */
  marginShows(): boolean {
    return !this.panel.isOpen && !this.h.typewriterOn() && this.h.app.dataset.focus !== 'true' && !this.margin.isCompact;
  }

  /** Open a note where it can be seen: its card in the margin, or the panel. */
  reveal(id: string, focus: boolean) {
    if (this.marginShows()) { this.margin.setActive(id, focus); return; }
    this.setPanel(true, () => this.panel.focusNote(id));
  }

  /** Add a note: about the selected passage, or a general one when nothing is selected. It opens ready to type. */
  add() {
    const view = this.h.view();
    if (!view) return;
    if (view.state.selection.empty) {
      this.setPanel(true, () => this.panel.newGeneral());
      return;
    }
    const id = newId();
    if (!addNoteAnchor(id)(view.state, view.dispatch)) {
      this.h.toast('A note goes on a passage within one scene. Select some text in a scene first.');
      return;
    }
    this.store.create(describeAnchor(view.state.doc, anchorsIn(view.state.doc).get(id)!), id);
    this.reveal(id, true);
  }

  /** A note and its anchor go (deleted, or left empty). */
  discard(id: string) {
    const view = this.h.view();
    if (view) removeNoteAnchor(id)(view.state, view.dispatch);
    this.store.remove(id);
    this.margin.setActive(null);
  }

  /** Go to a note's passage: on the page (opening its parked scene if need be), its card active. */
  show(id: string) {
    const view = this.h.view();
    const a = view && anchorsIn(view.state.doc).get(id);
    if (!view || !a) return;
    if (outlineOf(view.state.doc).parked.some((p) => p.id === a.scene)) this.h.parked.open(a.scene);
    else this.h.parked.leave();
    const range = anchorsIn(view.state.doc).get(id)!;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from)).scrollIntoView());
    const dom = view.domAtPos(range.from).node as HTMLElement;
    (dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView({ block: 'center' });
    view.focus();
    this.margin.setActive(id);
  }

  /** Open notes per scene. */
  counts(): Map<string, number> {
    const counts = new Map<string, number>();
    const view = this.h.view();
    if (!view) return counts;
    const anchors = anchorsIn(view.state.doc);
    for (const n of this.store.all) {
      const scene = !n.resolved && anchors.get(n.id)?.scene;
      if (scene) counts.set(scene, (counts.get(scene) ?? 0) + 1);
    }
    return counts;
  }

  /** The notes an export can carry: open, with something written. */
  exportable() {
    return this.store.all.filter((n) => !n.resolved && n.body);
  }

  /** A click on the page: on a note's passage, that note comes forward (the innermost open one; notes may overlap). */
  pressAt(x: number, y: number) {
    const anchor = document.elementsFromPoint(x, y).find((el) => el.classList.contains('bt-note-anchor') && !this.store.get((el as HTMLElement).dataset.note!)?.resolved) as HTMLElement | undefined;
    if (!anchor) return;
    const id = anchor.dataset.note!;
    if (this.marginShows()) this.margin.setActive(id);
    else this.reveal(id, true);
  }

  /** The book's text changed: anchors follow, and both views of the notes. */
  textChanged() {
    this.store.textChanged();
    this.margin.refresh();
    this.panel.refresh();
  }

  /** Another book: its notes. */
  load(filePath: string) {
    this.margin.setActive(null);
    void this.store.load(filePath);
  }

  private slidePanel(open: boolean) {
    const slide = this.h.slide(open, () => {
      this.h.app.dataset.notes = open ? 'open' : 'closed';
      this.panel.setOpen(open);
    }, this.h.app.dataset.focus !== 'true');
    this.margin.refresh();
    if (!open && this.marginShows()) void this.margin.fade(true, cssNumber('--dur-notes-in'), slide * 0.6);
  }
}
