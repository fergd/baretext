// Moving through the book (spec §4.5): one path for every "go to scene", and
// "where you are" — the caret's scene, or while reading back (a hand scroll)
// the scene in the middle of the window, so the spine and the breadcrumb
// follow the reading. Writing or moving the caret hands "where" back to it.

import { schema } from '@baretext/editor';
import { Selection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { cssNumber, cssValue } from './dom';
import { currentScene, outlineOf, sceneAt } from './outline';

export interface NavigationHost {
  view(): EditorView | null;
  scroller: HTMLElement;
  page: HTMLElement;
  typewriter(): { enabled: boolean; recenter(animate: boolean): void };
  /** Going somewhere in the manuscript: show it (leaving the board, or a parked scene). */
  toManuscript(): void;
  /** While reading back, the scene being read changed. */
  readingMoved(): void;
}

/** A scene and its chapter, where the writer is. */
export type Here = ReturnType<typeof currentScene>;

/** Where a scene's prose lands, from the top of the window. */
const LANDING_PX = 64;

export class Navigation {
  private reading = false;
  private readingHere: Here = null;
  private frame = 0;

  constructor(private readonly h: NavigationHost) {
    h.scroller.addEventListener('scroll', () => this.followReading(), { passive: true });
    h.scroller.addEventListener('wheel', () => this.startReading(), { passive: true });
  }

  /** Where the writer is in `state`: the scene being read back, else the caret's. */
  here(state: EditorState): Here {
    return (this.reading && this.readingHere) || currentScene(state);
  }

  /** A hand scroll began (the wheel, the scrollbar): the reading leads. */
  readonly startReading = () => {
    this.reading = true;
  };

  /** The editor moved on: writing or moving the caret hands "where" back to the caret. */
  stateChanged(before: EditorState, next: EditorState) {
    if (this.reading && (next.doc !== before.doc || !next.selection.eq(before.selection))) {
      this.reading = false;
      this.readingHere = null;
    }
  }

  /** Go to a scene: its first line of prose, brought into view. False if it doesn't exist (a deleted target never jumps elsewhere). */
  readonly go = (sceneId: string): boolean => {
    const view = this.h.view();
    if (!view) return false;
    this.h.toManuscript();
    const scene = outlineOf(view.state.doc).chapters.flatMap((c) => c.scenes).find((s) => s.id === sceneId);
    if (!scene) return false;
    // Land on the scene's first line of prose, not in its name.
    const node = view.state.doc.nodeAt(scene.pos)!;
    let firstParagraph = scene.pos + 1;
    node.forEach((child, offset) => {
      if (firstParagraph === scene.pos + 1 && child.type === schema.nodes.scene_heading) firstParagraph = scene.pos + 1 + offset + child.nodeSize;
    });
    const sel = Selection.findFrom(view.state.doc.resolve(firstParagraph), 1, true);
    if (!sel) return false;
    const { scroller } = this.h;
    const before = scroller.scrollTop;
    view.dispatch(view.state.tr.setSelection(sel).setMeta('navigation', true));
    const typewriter = this.h.typewriter();
    if (typewriter.enabled) {
      typewriter.recenter(false);
    } else {
      const dom = view.nodeDOM(scene.pos) as HTMLElement | null;
      if (dom) scroller.scrollTop += dom.getBoundingClientRect().top - scroller.getBoundingClientRect().top - LANDING_PX;
    }
    this.jumpMotion(scroller.scrollTop - before);
    view.focus();
    return true;
  };

  /**
   * The scroll position is already final; only the page's paint moves. Nearby
   * targets glide into place (FLIP); distant ones slide in a short way and
   * fade up, so crossing half a book never becomes a long, dizzying scroll.
   */
  private jumpMotion(delta: number) {
    const duration = cssNumber('--dur-jump');
    if (!duration || Math.abs(delta) < 1) return;
    const near = Math.abs(delta) <= this.h.scroller.clientHeight * 1.5;
    const frames = near
      ? [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }]
      : [{ transform: `translateY(${Math.sign(delta) * 32}px)`, opacity: 0.3 }, { transform: 'translateY(0)', opacity: 1 }];
    this.h.page.animate(frames, { duration, easing: cssValue('--ease-jump', 'ease-out') });
  }

  /** Reading back: the scene at the middle of the window is the one being read. */
  private followReading() {
    if (!this.reading || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const view = this.h.view();
      if (!view || !this.reading) return;
      const box = this.h.scroller.getBoundingClientRect();
      const column = view.dom.getBoundingClientRect();
      const hit = view.posAtCoords({ left: (column.left + column.right) / 2, top: box.top + box.height / 2 });
      const here = hit && sceneAt(view.state.doc, hit.pos, true);
      if (here && here.scene.id !== this.readingHere?.scene.id) {
        this.readingHere = here;
        this.h.readingMoved();
      }
    });
  }
}
