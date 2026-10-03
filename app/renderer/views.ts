// The views of the open book (DECISIONS §24): the manuscript, and the
// corkboard over it — chosen by the chips in the top bar. The board lies over
// the page, which stays exactly where it was underneath, so coming back finds
// it unmoved. Every change made on the board keeps the writer's place on the
// page (PageEdits).

import { addScene, moveChapter, moveScene, nodeToScene, rename, setBeat } from '@baretext/editor';
import { sceneClipboard } from '@baretext/format';
import type { EditorView } from 'prosemirror-view';
import type { BaretextBridge } from '../shared/bridge';
import { Corkboard } from './corkboard';
import { currentScene, outlineOf } from './outline';
import type { PageEdits } from './page-edits';
import type { ToastKind } from './status';
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
  toast(message: string, kind?: ToastKind): void;
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
      copyScene: (id) => void this.copyScene(id),
      // (A move carries the caret with its scene: the writer's place travels with it.)
      moveScene: (id, chapterId, index) => edits.outside(moveScene(id, chapterId, index), true),
      moveChapter: (id, index) => edits.outside(moveChapter(id, index), true),
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

  /** Copy a scene, with its title, as rich text and plain text (spec §8.6). */
  private async copyScene(id: string) {
    const view = this.h.view();
    if (!view) return;
    const scene = outlineOf(view.state.doc).chapters.flatMap((c) => c.scenes).find((s) => s.id === id);
    const node = scene && view.state.doc.nodeAt(scene.pos);
    if (!scene || !node) return;
    const { html, text } = sceneClipboard(scene.name || `Scene ${scene.label}`, nodeToScene(node).blocks);
    if (await this.h.bridge.copyRich(html, text)) this.h.toast(`Copied ${scene.label}${scene.name ? ` “${scene.name}”` : ''}.`);
    else this.h.toast('Couldn’t copy the scene.', 'error');
  }
}
