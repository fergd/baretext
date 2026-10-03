// Cold Storage (DECISIONS §14): scenes set aside out of the manuscript. A
// parked scene opens on the page by itself; Back (Esc) returns the writer to
// exactly where they were. Parking and restoring are each one undoable step.

import { closeParked, moveToColdStorage, openParked, parkedKey, restoreFromColdStorage } from '@baretext/editor';
import { Selection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { outlineOf } from './outline';
import type { ToastKind } from './status';

export interface ColdStorageHost {
  view(): EditorView | null;
  scroller: HTMLElement;
  app: HTMLElement;
  /** A parked scene is about to open: whatever covers the page closes. */
  beforeOpen(): void;
  /** The book's structure changed (the outline follows). */
  changed(): void;
  /** The page now shows another text (a parked scene, or the manuscript again). */
  pageChanged(): void;
  navigate(sceneId: string): void;
  toast(message: string, kind?: ToastKind): void;
}

export class ColdStorage {
  /** Where the writer was in the manuscript when a parked scene opened. */
  private returnTo: { pos: number; scroll: number } | null = null;

  constructor(private readonly h: ColdStorageHost) {}

  /** The parked scene open on the page, if any. */
  get openId(): string | null {
    const view = this.h.view();
    return (view && parkedKey.getState(view.state)) ?? null;
  }

  open(id: string) {
    const view = this.h.view();
    if (!view) return;
    if (!this.openId) this.returnTo = { pos: view.state.selection.head, scroll: this.h.scroller.scrollTop };
    this.h.beforeOpen();
    if (!openParked(id)(view.state, view.dispatch)) return;
    this.h.scroller.scrollTop = 0;
    view.focus();
  }

  /** Close the parked scene; `returnToPlace` puts the writer back where they were (else the caller moves them). */
  readonly leave = (returnToPlace = true) => {
    const view = this.h.view();
    if (!view || !this.openId) return;
    const back = this.returnTo;
    this.returnTo = null;
    closeParked(returnToPlace ? back?.pos ?? null : null)(view.state, view.dispatch);
    if (returnToPlace && back) this.h.scroller.scrollTop = back.scroll;
    view.focus();
  };

  park(id: string) {
    const view = this.h.view();
    if (!view) return;
    const scene = outlineOf(view.state.doc).chapters.flatMap((c) => c.scenes).find((s) => s.id === id);
    if (!scene || !moveToColdStorage(id)(view.state, view.dispatch)) return;
    this.h.changed();
    this.h.toast(`Moved ${scene.label}${scene.name ? ` “${scene.name}”` : ''} to Cold Storage. ⌘Z undoes it.`);
  }

  /** Back into the manuscript (at a place, or where it came from); if it was open, the writer follows it there. */
  restore(id: string, chapterId?: string, index?: number) {
    const view = this.h.view();
    if (!view) return;
    const parked = outlineOf(view.state.doc).parked.find((p) => p.id === id);
    if (!parked) return;
    const wasOpen = this.openId === id;
    if (wasOpen) this.returnTo = null;
    if (!restoreFromColdStorage(id, chapterId, index)(view.state, view.dispatch)) return;
    this.h.changed();
    const placed = outlineOf(view.state.doc).chapters.flatMap((c) => c.scenes).find((s) => s.id === id);
    if (wasOpen && placed) this.h.navigate(id);
    this.h.toast(`Restored ${parked.name ? `“${parked.name}”` : 'the scene'}${placed ? ` as ${placed.label}` : ''}. ⌘Z undoes it.`);
  }

  /** Restore the parked scene that's open, if any. */
  restoreOpen() {
    const id = this.openId;
    if (id) this.restore(id);
  }

  /** The editor moved on (`before` → `next`): follow a parked scene opening or closing. */
  stateChanged(before: EditorState, next: EditorState) {
    const now = parkedKey.getState(next);
    if (now === parkedKey.getState(before)) return;
    this.h.app.dataset.parked = String(!!now);
    this.h.pageChanged();
    // Closed some other way than Back (its scene deleted): return to where the writer was.
    const back = now ? null : this.returnTo;
    if (!now) this.returnTo = null;
    if (back) requestAnimationFrame(() => {
      const view = this.h.view();
      if (!view || this.openId) return;
      const sel = Selection.findFrom(view.state.doc.resolve(Math.min(back.pos, view.state.doc.content.size)), -1, true);
      if (sel) view.dispatch(view.state.tr.setSelection(sel));
      this.h.scroller.scrollTop = back.scroll;
    });
  }
}
