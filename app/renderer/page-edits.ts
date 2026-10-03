// Changing the book without disturbing the writer's place on the page: a
// layout change keeps the caret's line where it is on screen, and a change
// made away from the page (on the board, in a panel) keeps the caret where it
// was, adjusted only for the change itself.

import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export interface PageEditsHost {
  view(): EditorView | null;
  scroller: HTMLElement;
  /** In typewriter mode the typewriter owns the caret line's place. */
  typewriter(): { enabled: boolean; recenter(animate: boolean): void };
  /** The book changed: bring the outline and its views up to date. */
  changed(): void;
}

export class PageEdits {
  constructor(private readonly h: PageEditsHost) {}

  /** Keep the caret's line where it is on screen across `change` (a layout change). */
  readonly keepCaretLine = (change: () => void) => {
    const view = this.h.view();
    let anchor: number | null = null;
    if (view) { try { anchor = view.coordsAtPos(view.state.selection.head).top; } catch { anchor = null; } }
    change();
    const typewriter = this.h.typewriter();
    if (typewriter.enabled) { typewriter.recenter(false); return; }
    if (anchor !== null && view) this.h.scroller.scrollTop += view.coordsAtPos(view.state.selection.head).top - anchor;
  };

  /**
   * Run `command` from away from the page: the caret stays where it was (not
   * moved to a new scene) and its line stays on screen, so coming back finds
   * it, adjusted only for the change itself. `ownCaret`: the command places
   * the caret itself (a move carries it along with its scene). One
   * transaction, so undo puts the caret back too.
   */
  readonly outside = (command: Command, ownCaret = false): boolean => {
    const view = this.h.view();
    if (!view) return false;
    const state = view.state;
    let changed = false;
    this.keepCaretLine(() => {
      changed = command(state, (tr) => view.dispatch(ownCaret ? tr : tr.setSelection(state.selection.map(tr.doc, tr.mapping))));
    });
    if (changed) this.h.changed();
    return changed;
  };
}
