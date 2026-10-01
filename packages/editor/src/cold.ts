// Cold Storage (spec §8.5): a parking place for scenes the writer cut but
// isn't ready to delete. Parked scenes live at the end of the document,
// hidden and out of the caret's reach; they change only through commands —
// except the one scene opened on the page, which is edited like any scene
// (one document, one undo history, one save).

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, Selection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { closeHistory } from 'prosemirror-history';
import { newScene } from '@baretext/format';
import { sceneToNode } from './convert';
import { parkedKey } from './keys';
import { chapterPos, findScene, nearestProse, relocate, sceneSlot } from './outline-commands';
import { schema } from './schema';
import { markStructural } from './structure';

export { parkedKey };

const coldStart = (doc: PMNode) => doc.content.size - doc.lastChild!.nodeSize;

/** The open parked scene's position and node, if it still exists. */
function openScene(state: EditorState): { pos: number; node: PMNode } | null {
  const id = parkedKey.getState(state);
  const found = id ? findScene(state.doc, id) : null;
  return found && !found.chapter ? found : null;
}

/**
 * The parked view: which parked scene is open (if any), how the page shows
 * it (only that scene), and where the selection may go — inside the open
 * scene, or (when none is open) anywhere but Cold Storage. A selection that
 * runs past its bounds is trimmed, keeping its direction; one wholly outside
 * becomes a caret on the nearest line.
 */
export function parkedView(): Plugin<string | null> {
  return new Plugin<string | null>({
    key: parkedKey,
    state: {
      init: () => null,
      apply(tr, open) {
        const meta = tr.getMeta(parkedKey) as string | null | undefined;
        const id = meta !== undefined ? meta : open;
        if (!id) return null;
        const found = findScene(tr.doc, id);
        return found && !found.chapter ? id : null; // restored or deleted: closed
      },
    },
    appendTransaction(_trs, _old, state) {
      const { doc, selection } = state;
      const open = openScene(state);
      const from = open ? open.pos + 1 : 0;
      const to = open ? open.pos + open.node.nodeSize - 1 : coldStart(doc);
      if (selection.from >= from && selection.to <= to && selection instanceof TextSelection) return null;
      const firstIn = Selection.findFrom(doc.resolve(from), 1, true);
      const lastIn = Selection.findFrom(doc.resolve(to), -1, true);
      if (!firstIn || !lastIn) return null;
      if (!selection.empty && selection.from < to && selection.to > from) {
        // Runs past the bounds (Select All, a shift-click): trim it to them.
        const first = Selection.findFrom(doc.resolve(Math.max(from, selection.from)), 1, true) ?? firstIn;
        const last = Selection.findFrom(doc.resolve(Math.min(to, selection.to)), -1, true) ?? lastIn;
        if (first.from <= last.to) {
          const forward = selection.head >= selection.anchor;
          return state.tr.setSelection(forward ? TextSelection.create(doc, first.from, last.to) : TextSelection.create(doc, last.to, first.from));
        }
      }
      // Outside the bounds: the nearest line inside them.
      return state.tr.setSelection(selection.from < from ? firstIn : lastIn);
    },
    props: {
      attributes: (state): Record<string, string> => (parkedKey.getState(state) ? { 'data-parked': 'true' } : {}),
      decorations(state) {
        const open = openScene(state);
        return open ? DecorationSet.create(state.doc, [Decoration.node(open.pos, open.pos + open.node.nodeSize, { class: 'bt-parked-open' })]) : null;
      },
    },
  });
}

/** A caret at the start of a scene's first line of prose (not its name). */
function firstProse(doc: PMNode, pos: number, scene: PMNode): Selection {
  let at = -1;
  scene.descendants((node, offset) => {
    if (at >= 0) return false;
    if (node.type === schema.nodes.paragraph) { at = pos + 1 + offset + 1; return false; }
    return node.type !== schema.nodes.scene_heading;
  });
  return at >= 0 ? TextSelection.create(doc, at) : Selection.findFrom(doc.resolve(pos + 1), 1, true)!;
}

/** Open a parked scene on the page, caret on its first line of prose. */
export const openParked = (sceneId: string): Command => (state, dispatch) => {
  const found = findScene(state.doc, sceneId);
  if (!found || found.chapter) return false;
  if (dispatch) dispatch(state.tr.setMeta(parkedKey, sceneId).setSelection(firstProse(state.doc, found.pos, found.node)).scrollIntoView());
  return true;
};

/** Back to the manuscript, caret at `pos` (where the writer was), or its first line. */
export const closeParked = (pos: number | null = null): Command => (state, dispatch) => {
  if (!parkedKey.getState(state)) return false;
  if (dispatch) {
    const limit = coldStart(state.doc);
    const at = pos !== null && pos < limit ? pos : 0;
    const sel = Selection.findFrom(state.doc.resolve(at), 1, true) ?? Selection.findFrom(state.doc.resolve(limit), -1, true)!;
    dispatch(state.tr.setMeta(parkedKey, null).setSelection(sel).scrollIntoView());
  }
  return true;
};

/**
 * Move a scene to Cold Storage (newest first), remembering where it came
 * from. A chapter's only scene leaves an empty scene behind. A caret inside
 * it moves to the nearest line of prose. One undo step.
 */
export const moveToColdStorage = (sceneId: string): Command => (state, dispatch) => {
  const found = findScene(state.doc, sceneId);
  if (!found || !found.chapter) return false;
  if (dispatch) {
    const { pos, node, chapter } = found;
    const index = state.doc.resolve(pos).index() - 1; // among the chapter's scenes (after its title)
    const origin = { chapter: chapter.node.attrs.id as string, index };
    const sel = state.selection;
    const tr = state.tr;
    const parked = schema.nodes.scene!.create({ ...node.attrs, origin }, node.content);
    tr.insert(coldStart(state.doc) + 1, parked); // after everything: positions before it stay put
    if (chapter.node.childCount === 2) tr.replaceWith(pos, pos + node.nodeSize, sceneToNode(newScene()));
    else tr.delete(pos, pos + node.nodeSize);
    if (sel.to > pos && sel.from < pos + node.nodeSize) {
      const near = nearestProse(tr.doc, Math.min(pos, coldStart(tr.doc)));
      if (near) tr.setSelection(near);
    }
    dispatch(closeHistory(markStructural(tr)).scrollIntoView());
  }
  return true;
};

/**
 * Put a parked scene back: where it came from by default (its chapter and
 * position; the end of the last chapter if that chapter is gone), or at
 * `index` in chapter `toChapterId`. It forgets its origin. One undo step.
 */
export const restoreFromColdStorage = (sceneId: string, toChapterId?: string, index?: number): Command => (state, dispatch) => {
  const found = findScene(state.doc, sceneId);
  if (!found || found.chapter) return false;
  const origin = found.node.attrs.origin as { chapter: string; index: number } | null;
  let chapterId = toChapterId ?? origin?.chapter ?? null;
  let at = toChapterId !== undefined ? index ?? Infinity : origin?.index ?? Infinity;
  if (!chapterId || chapterPos(state.doc, chapterId) < 0) {
    if (toChapterId !== undefined) return false;
    let last: string | null = null;
    state.doc.forEach((n) => { if (n.type === schema.nodes.chapter) last = n.attrs.id; });
    chapterId = last!;
    at = Infinity;
  }
  if (dispatch) {
    const restored = schema.nodes.scene!.create({ ...found.node.attrs, origin: null }, found.node.content);
    const target = chapterId;
    dispatch(relocate(state, found.pos, found.node, (doc) => {
      const c = chapterPos(doc, target);
      return sceneSlot(doc, c, Math.min(at, doc.nodeAt(c)!.childCount - 1));
    }, restored).scrollIntoView());
  }
  return true;
};
