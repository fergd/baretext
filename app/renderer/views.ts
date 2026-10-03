// The views of the open book (DECISIONS §24): the manuscript, and the
// corkboard over it — chosen by the chips in the top bar. The board lies over
// the page, which stays exactly where it was underneath, so coming back finds
// it unmoved. Every change made on the board keeps the writer's place on the
// page (PageEdits).

import { addScene, joinGroup, moveChapter, moveGroup, placeScene, rename, renameGroup, setBeat, ungroup } from '@baretext/editor';
import type { EditorView } from 'prosemirror-view';
import type { BaretextBridge } from '../shared/bridge';
import { Corkboard } from './corkboard';
import { currentScene, outlineOf } from './outline';
import type { PageEdits } from './page-edits';
import { ViewTabs, type View } from './view-tabs';

export interface BookViewsHost {
  app: HTMLElement;
  workspace: HTMLElement;
  bridge: BaretextBridge;
  view(): EditorView | null;
  edits: PageEdits;
  /** Open a scene on the page (navigation shows the manuscript first). */
  navigate(sceneId: string): boolean;
  /** Open notes per scene. */
  noteCounts(): Map<string, number>;
  /** Delete a scene, with the outline's own care (a snapshot first, and its message). */
  deleteScene(sceneId: string): void;
  bookSettings(): void;
  /** Copy a scene's or a chapter's text. */
  copy: { scene(id: string): void; chapter(id: string): void; group(sceneIds: string[], name: string | null): void };
  /** The board is about to show: false if it can't now (a sprint); whatever covers the page closes. */
  beforeBoard(): boolean;
  /** Back to the page: the keyboard on it. */
  focusPage(): void;
  /** The view changed: the chrome follows. */
  changed(): void;
}

export class BookViews {
  readonly tabs: ViewTabs;
  readonly board: Corkboard;

  constructor(private readonly h: BookViewsHost) {
    const { bridge, edits } = h;
    const doc = () => h.view()!.state.doc;
    this.tabs = new ViewTabs((next) => this.set(next));
    this.board = new Corkboard(h.workspace, {
      open: (id) => h.navigate(id),
      close: () => this.set('manuscript'),
      noteCounts: () => h.noteCounts(),
      onLayout: (layout) => bridge.setPrefs({ corkboardLayout: layout }),
      onArc: (shown) => bridge.setPrefs({ corkboardArc: shown }),
      outline: () => outlineOf(doc()),
      rename: (id, name) => edits.outside(rename(id, name)),
      addScene: (chapterId) => (edits.outside(addScene(chapterId)) ? outlineOf(doc()).chapters.find((c) => c.id === chapterId)?.scenes.at(-1)?.id ?? null : null),
      deleteScene: (id) => edits.keepCaretLine(() => h.deleteScene(id)),
      copyScene: (id) => h.copy.scene(id),
      copyChapter: (id) => h.copy.chapter(id),
      // (A move carries the caret with its scene: the writer's place travels with it.)
      placeScene: (id, chapterId, index, group) => edits.outside(placeScene(id, chapterId, index, group), true),
      joinGroup: (id, targetId) => edits.outside(joinGroup(id, targetId), true),
      moveGroup: (id, chapterId, index) => edits.outside(moveGroup(id, chapterId, index), true),
      moveChapter: (id, index) => edits.outside(moveChapter(id, index), true),
      renameGroup: (id, name) => edits.outside(renameGroup(id, name)),
      ungroup: (id) => edits.outside(ungroup(id)),
      copyGroup: (ids, name) => h.copy.group(ids, name),
      popupMenu: (items) => bridge.popupMenu(items),
      structure: () => h.view()?.state.doc.attrs.structure ?? null,
      setBeat: (id, beat) => edits.outside(setBeat(id, beat)),
      bookSettings: () => h.bookSettings(),
    }, bridge.initial.corkboardLayout, bridge.initial.corkboardArc);
  }

  get current(): View {
    return (this.h.app.dataset.view as View | undefined) ?? 'manuscript';
  }

  /** Show the manuscript or the corkboard. */
  readonly set = (next: View) => {
    const view = this.h.view();
    if (!view || this.current === next) return;
    if (next === 'corkboard') {
      if (!this.h.beforeBoard()) return;
      this.h.app.dataset.view = 'corkboard';
      this.board.open(outlineOf(view.state.doc), currentScene(view.state)?.scene.id ?? null);
    } else {
      this.h.app.dataset.view = 'manuscript';
      this.board.close();
      this.h.focusPage();
    }
    this.tabs.set(next);
    this.h.changed();
  };

}
