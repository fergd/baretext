// Hooks for end-to-end tests, on window.__baretext. They read the model and
// drive the caret the way a writer would, so tests assert on the manuscript,
// not on the DOM.

import { AllSelection, Selection, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { docToModel } from '@baretext/editor';
import { currentScene, outlineOf } from './outline';
import type { FindPanel } from './find';
import type { HistoryPanel } from './history';
import type { Palette } from './palette';
import type { Saver } from './saving';
import type { SelectionToolbar } from './toolbar';

declare global {
  interface Window {
    __baretext?: unknown;
  }
}

export interface HookHost {
  view: () => EditorView | null;
  filePath: () => string | null;
  navigate: (sceneId: string) => boolean;
  saver: Saver;
  toolbar: SelectionToolbar;
  palette: Palette;
  find: FindPanel;
  history: HistoryPanel;
  appearance: () => unknown;
  exporting: () => unknown;
  book: () => unknown;
  outline: () => unknown;
  notes: () => unknown;
  sprint: () => unknown;
  sprints: () => unknown;
  sprintFinishNow: () => void;
  sprintFlush: () => Promise<boolean>;
  recoverSprint: () => Promise<void>;
}

/**
 * Document position of the first occurrence of `text` at or after `from`, or
 * -1. Searches each paragraph's whole text, so a match may span formatting
 * and note-anchor boundaries (all inline content is text).
 */
function find(doc: PMNode, text: string, from = 0): number {
  let at = -1;
  doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (!node.isTextblock) return true;
    const content = node.textContent;
    for (let i = content.indexOf(text); i >= 0; i = content.indexOf(text, i + 1)) {
      if (pos + 1 + i >= from) { at = pos + 1 + i; break; }
    }
    return false;
  });
  return at;
}

function select(view: EditorView, selection: Selection): true {
  view.dispatch(view.state.tr.setSelection(selection));
  view.focus();
  return true;
}

export function installTestHooks(h: HookHost) {
  window.__baretext = {
    model: () => { const v = h.view(); return v ? docToModel(v.state.doc) : null; },
    selection: () => { const v = h.view(); return v ? { from: v.state.selection.from, to: v.state.selection.to, head: v.state.selection.head } : null; },
    currentScene: () => { const v = h.view(); return v ? currentScene(v.state)?.scene.id ?? null : null; },
    navigate: h.navigate,
    /** Place the caret at the end of a scene's last line. */
    caretToSceneEnd: (sceneId: string) => {
      const v = h.view();
      const scene = v && outlineOf(v.state.doc).chapters.flatMap((c) => c.scenes).find((s) => s.id === sceneId);
      if (!v || !scene) return false;
      const sel = Selection.findFrom(v.state.doc.resolve(scene.pos + v.state.doc.nodeAt(scene.pos)!.nodeSize - 1), -1, true);
      return sel ? select(v, sel) : false;
    },
    /** Select the whole manuscript (as ⌘A does through the native Edit menu). */
    selectAll: () => { const v = h.view(); return v ? select(v, new AllSelection(v.state.doc)) : false; },
    /** Place the caret right after the first occurrence of `text` in the prose. */
    caretAfter: (text: string) => {
      const v = h.view();
      const at = v ? find(v.state.doc, text) : -1;
      return v && at >= 0 ? select(v, TextSelection.create(v.state.doc, at + text.length)) : false;
    },
    /** Select the first occurrence of `text` in the prose. */
    selectText: (text: string) => {
      const v = h.view();
      const at = v ? find(v.state.doc, text) : -1;
      return v && at >= 0 ? select(v, TextSelection.create(v.state.doc, at, at + text.length)) : false;
    },
    /** Select from the first occurrence of `start` to the end of the first `end` after it. */
    selectRange: (start: string, end: string) => {
      const v = h.view();
      const from = v ? find(v.state.doc, start) : -1;
      const to = v && from >= 0 ? find(v.state.doc, end, from) : -1;
      return v && to >= 0 ? select(v, TextSelection.create(v.state.doc, from, to + end.length)) : false;
    },
    saveNow: () => h.saver.saveNow(),
    isSaved: () => { const v = h.view(); return v ? h.saver.isSaved(v.state.doc) : true; },
    filePath: h.filePath,
    toolbar: () => ({ visible: h.toolbar.visible, el: h.toolbar.el.getBoundingClientRect().toJSON() }),
    palette: () => ({ open: h.palette.isOpen, view: h.palette.current, timings: { ...h.palette.timings } }),
    /** Where the caret's line is on screen (viewport y of its top). */
    caretTop: () => { const v = h.view(); return v ? v.coordsAtPos(v.state.selection.head).top : null; },
    hasFocus: () => h.view()?.hasFocus() ?? false,
    textBetween: (from: number, to: number) => h.view()?.state.doc.textBetween(from, to, '\n') ?? '',
    history: () => ({ open: h.history.isOpen }),
    appearance: h.appearance,
    exporting: h.exporting,
    book: h.book,
    outline: h.outline,
    notes: h.notes,
    sprint: h.sprint,
    sprints: h.sprints,
    sprintFinishNow: h.sprintFinishNow,
    sprintFlush: h.sprintFlush,
    recoverSprint: h.recoverSprint,
    find: () => ({ open: h.find.isOpen, count: h.find.el.querySelector('.bt-find-count')!.textContent, ms: h.find.lastSearchMs }),
  };
}
