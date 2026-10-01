// Commands on the manuscript's structure, by identity: rename, add, move and
// delete chapters and scenes (the outline's actions). Each is one undo step,
// marked structural so the structure guard lets it through, and never
// changes any text but its own.

import type { Node as PMNode } from 'prosemirror-model';
import { Selection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { closeHistory } from 'prosemirror-history';
import { newChapter, newScene } from '@baretext/format';
import { chapterToNode, sceneToNode } from './convert';
import { schema } from './schema';
import { markStructural } from './structure';

/** Where a scene is: its position and node, and its chapter (null in Cold Storage). */
export interface FoundScene {
  pos: number;
  node: PMNode;
  chapter: { pos: number; node: PMNode } | null;
}

export function findScene(doc: PMNode, id: string): FoundScene | null {
  let found: FoundScene | null = null;
  doc.forEach((top, offset) => {
    if (found || (top.type !== schema.nodes.chapter && top.type !== schema.nodes.cold_storage)) return;
    top.forEach((child, childOffset) => {
      if (!found && child.type === schema.nodes.scene && child.attrs.id === id) {
        found = { pos: offset + 1 + childOffset, node: child, chapter: top.type === schema.nodes.chapter ? { pos: offset, node: top } : null };
      }
    });
  });
  return found;
}

/** `rename` target for the book's title. */
export const BOOK_TITLE = 'book';

/**
 * Rename the book, a chapter, or a scene by identity (the outline's inline
 * rename). Names stay on one line and are trimmed; a blank scene name
 * makes the scene unnamed. The caret stays where it was, and each rename
 * is its own undo step. Parked (cold storage) scenes are never touched.
 */
export const rename = (id: string, name: string): Command => (state, dispatch) => {
  const text = name.replace(/\s+/g, ' ').trim();
  const doc = state.doc;
  let tr: Transaction | null = null;
  const replaceText = (pos: number, node: PMNode) => {
    if (node.textContent === text) return null;
    const t = state.tr;
    return text ? t.replaceWith(pos + 1, pos + node.nodeSize - 1, schema.text(text)) : t.delete(pos + 1, pos + node.nodeSize - 1);
  };
  if (id === BOOK_TITLE) {
    tr = replaceText(0, doc.firstChild!);
  } else if (chapterPos(doc, id) >= 0) {
    const pos = chapterPos(doc, id);
    tr = replaceText(pos + 1, doc.nodeAt(pos)!.firstChild!);
  } else {
    const found = findScene(doc, id);
    if (!found) return false;
    const { pos: scenePos, node: scene } = found;
    const heading = scene.firstChild?.type === schema.nodes.scene_heading ? scene.firstChild : null;
    if (heading && !text) tr = markStructural(state.tr.delete(scenePos + 1, scenePos + 1 + heading.nodeSize));
    else if (heading) tr = replaceText(scenePos + 1, heading);
    else if (text) tr = markStructural(state.tr.insert(scenePos + 1, schema.nodes.scene_heading!.create(null, schema.text(text))));
    // A parked scene's name changes only through this command.
    if (tr && !found.chapter) markStructural(tr);
  }
  if (!tr) return false;
  if (dispatch) dispatch(closeHistory(tr));
  return true;
};

/** Position of the chapter with this identity, or -1. */
export function chapterPos(doc: PMNode, id: string): number {
  let found = -1;
  doc.forEach((node, offset) => { if (found < 0 && node.type === schema.nodes.chapter && node.attrs.id === id) found = offset; });
  return found;
}

/** Insert `node` at `pos` and put the caret on the first writable line inside it. */
function insertWithCaret(state: EditorState, pos: number, node: PMNode): Transaction {
  const tr = state.tr.insert(pos, node);
  const sel = Selection.findFrom(tr.doc.resolve(pos + 1), 1, true);
  if (sel) tr.setSelection(sel);
  // A chapter's first line is its title: start in its scene instead.
  if (node.type === schema.nodes.chapter) {
    const scene = Selection.findFrom(tr.doc.resolve(pos + 1 + node.firstChild!.nodeSize), 1, true);
    if (scene) tr.setSelection(scene);
  }
  return closeHistory(markStructural(tr)).scrollIntoView();
}

/** Add an empty, unnamed scene at the end of a chapter; the caret goes to it. */
export const addScene = (chapterId: string): Command => (state, dispatch) => {
  const pos = chapterPos(state.doc, chapterId);
  if (pos < 0) return false;
  if (dispatch) {
    const end = pos + state.doc.nodeAt(pos)!.nodeSize - 1;
    dispatch(insertWithCaret(state, end, sceneToNode(newScene())));
  }
  return true;
};

/** Add an untitled chapter with one empty scene, after `afterId` (default: last); the caret goes to it. */
export const addChapter = (afterId?: string): Command => (state, dispatch) => {
  let at: number;
  if (afterId !== undefined) {
    const pos = chapterPos(state.doc, afterId);
    if (pos < 0) return false;
    at = pos + state.doc.nodeAt(pos)!.nodeSize;
  } else {
    at = state.doc.content.size - state.doc.lastChild!.nodeSize; // before cold storage
  }
  if (dispatch) dispatch(insertWithCaret(state, at, chapterToNode(newChapter())));
  return true;
};

/**
 * Move `node` (at `from`) to wherever `target` says in the document without
 * it. The node moves whole: its text, names and identity are untouched. A
 * selection inside it travels with it; any other selection stays in its
 * own text. One undo step.
 */
export function relocate(state: EditorState, from: number, node: PMNode, target: (doc: PMNode) => number, insert: PMNode = node): Transaction {
  const sel = state.selection;
  const to = from + node.nodeSize;
  const inside = sel.from > from && sel.to < to;
  const tr = state.tr.delete(from, to);
  const at = target(tr.doc);
  tr.insert(at, insert);
  if (inside) {
    tr.setSelection(sel instanceof TextSelection
      ? TextSelection.create(tr.doc, at + (sel.anchor - from), at + (sel.head - from))
      : Selection.near(tr.doc.resolve(at + (sel.head - from))));
  } else if (sel.to > from && sel.from < to) {
    tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(sel.head)))); // straddled it: collapse
  }
  return closeHistory(markStructural(tr));
}

/** Where the `index`-th scene of the chapter at `chapterAt` starts (index may equal the scene count). */
export function sceneSlot(doc: PMNode, chapterAt: number, index: number): number {
  const chapter = doc.nodeAt(chapterAt)!;
  let pos = chapterAt + 1 + chapter.firstChild!.nodeSize;
  for (let i = 1; i <= index; i++) pos += chapter.child(i).nodeSize;
  return pos;
}

/**
 * Move a scene to `index` among the scenes of a chapter (indices as they
 * are once it has left). A chapter's only scene cannot leave it; parked
 * scenes never move this way.
 */
export const moveScene = (sceneId: string, toChapterId: string, index: number): Command => (state, dispatch) => {
  let from = -1;
  let fromChapter = '';
  let fromIndex = -1;
  let siblings = 0;
  state.doc.forEach((chapter, offset) => {
    if (from >= 0 || chapter.type !== schema.nodes.chapter) return;
    chapter.forEach((child, childOffset, i) => {
      if (child.type === schema.nodes.scene && child.attrs.id === sceneId) {
        from = offset + 1 + childOffset;
        fromChapter = chapter.attrs.id;
        fromIndex = i - 1;
        siblings = chapter.childCount - 1;
      }
    });
  });
  if (from < 0 || chapterPos(state.doc, toChapterId) < 0) return false;
  if (siblings === 1) return false; // a chapter always keeps a scene
  const target = state.doc.nodeAt(chapterPos(state.doc, toChapterId))!;
  const room = toChapterId === fromChapter ? siblings - 1 : target.childCount - 1;
  const at = Math.max(0, Math.min(index, room));
  if (toChapterId === fromChapter && at === fromIndex) return false;
  if (dispatch) {
    const node = state.doc.nodeAt(from)!;
    dispatch(relocate(state, from, node, (doc) => sceneSlot(doc, chapterPos(doc, toChapterId), at)));
  }
  return true;
};

/** Move a chapter (with all its scenes) to `index` among the chapters (as they are once it has left). */
export const moveChapter = (chapterId: string, index: number): Command => (state, dispatch) => {
  const from = chapterPos(state.doc, chapterId);
  if (from < 0) return false;
  const chapters: string[] = [];
  state.doc.forEach((n) => { if (n.type === schema.nodes.chapter) chapters.push(n.attrs.id); });
  const at = Math.max(0, Math.min(index, chapters.length - 1));
  if (at === chapters.indexOf(chapterId)) return false;
  if (dispatch) {
    const node = state.doc.nodeAt(from)!;
    dispatch(relocate(state, from, node, (doc) => {
      let pos = doc.firstChild!.nodeSize; // after the book title
      for (let i = 0; i < at; i++) pos += doc.child(i + 1).nodeSize;
      return pos;
    }));
  }
  return true;
};

/** A caret at the start of the first line of prose at or after `pos` (else the end of the last one before it). */
export function nearestProse(doc: PMNode, pos: number): Selection | null {
  const coldStart = doc.content.size - doc.lastChild!.nodeSize;
  let after = -1;
  let before = -1;
  doc.nodesBetween(0, coldStart, (node, p) => {
    if (node.type !== schema.nodes.paragraph) return true;
    if (p >= pos && after < 0) after = p + 1;
    if (p < pos) before = p + node.nodeSize - 1;
    return false;
  });
  const at = after >= 0 ? after : before;
  return at >= 0 ? TextSelection.create(doc, at) : null;
}

/**
 * Remove (or replace) the node at `from`. A caret or selection inside it
 * moves to the nearest line that remains; any other selection stays in its
 * own text. One undo step.
 */
export function removeNode(state: EditorState, from: number, node: PMNode, replacement?: PMNode): Transaction {
  const to = from + node.nodeSize;
  const sel = state.selection;
  const tr = replacement ? state.tr.replaceWith(from, to, replacement) : state.tr.delete(from, to);
  if (sel.to > from && sel.from < to) {
    const near = nearestProse(tr.doc, from);
    if (near) tr.setSelection(near);
  }
  return closeHistory(markStructural(tr)).scrollIntoView();
}

/** Delete a scene and all its text (parked ones too). A chapter's only scene leaves an empty scene behind. */
export const deleteScene = (sceneId: string): Command => (state, dispatch) => {
  const found = findScene(state.doc, sceneId);
  if (!found) return false;
  const only = found.chapter?.node.childCount === 2; // its title and this scene
  if (dispatch) dispatch(removeNode(state, found.pos, found.node, only ? sceneToNode(newScene()) : undefined));
  return true;
};

/** Delete a chapter with all its scenes. The book's only chapter leaves an empty chapter behind. */
export const deleteChapter = (chapterId: string): Command => (state, dispatch) => {
  const pos = chapterPos(state.doc, chapterId);
  if (pos < 0) return false;
  let chapters = 0;
  state.doc.forEach((n) => { if (n.type === schema.nodes.chapter) chapters++; });
  if (dispatch) dispatch(removeNode(state, pos, state.doc.nodeAt(pos)!, chapters === 1 ? chapterToNode(newChapter()) : undefined));
  return true;
};
