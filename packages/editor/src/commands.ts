// Editing commands that keep the manuscript's structure intact (spec §4.4).

import { chainCommands, deleteSelection, joinBackward, joinForward, liftEmptyBlock, splitBlock, toggleMark } from 'prosemirror-commands';
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from 'prosemirror-model';
import { undoInputRule } from 'prosemirror-inputrules';
import { Selection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { newId, type Manuscript } from '@baretext/format';
import { closeHistory } from 'prosemirror-history';
import { modelToDoc } from './convert';
import { schema, TITLE_TYPES } from './schema';
import { markStructural } from './structure';
import { markFreshSceneName } from './naming';

const isTitle = (node: PMNode) => TITLE_TYPES.has(node.type.name);

/** Depth of the enclosing scene, or -1. */
export function sceneDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type === schema.nodes.scene) return d;
  return -1;
}

/**
 * True when a range stays inside one editable region: a single title, or
 * the body of a single scene. Deleting or replacing such a range can never
 * touch structure, so ProseMirror's defaults are safe.
 */
export function withinOneRegion($from: ResolvedPos, $to: ResolvedPos): boolean {
  if ($from.sameParent($to)) return true;
  if (isTitle($from.parent) || isTitle($to.parent)) return false;
  const d = sceneDepth($from);
  return d > 0 && d === sceneDepth($to) && $from.start(d) === $to.start(d);
}

/**
 * Delete a selection that spans titles or scenes: remove the selected text
 * from each title and from each scene body, but keep every chapter, scene,
 * and title. Returns the transaction, or null if nothing changes.
 */
export function deleteAcrossStructure(state: EditorState): Transaction | null {
  const { from, to } = state.selection;
  if (from === to) return null;
  const ranges: Array<[number, number]> = [];
  const doc = state.doc;

  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === schema.nodes.cold_storage) return false;
    if (isTitle(node)) {
      const a = Math.max(from, pos + 1);
      const b = Math.min(to, pos + node.nodeSize - 1);
      if (a < b) ranges.push([a, b]);
      return false;
    }
    if (node.type === schema.nodes.scene) {
      const heading = node.firstChild?.type === schema.nodes.scene_heading ? node.firstChild : null;
      if (heading) {
        const a = Math.max(from, pos + 2);
        const b = Math.min(to, pos + 1 + heading.nodeSize - 1);
        if (a < b) ranges.push([a, b]);
      }
      const bodyFrom = pos + 1 + (heading ? heading.nodeSize : 0);
      const bodyTo = pos + node.nodeSize - 1;
      let a = Math.max(from, bodyFrom);
      let b = Math.min(to, bodyTo);
      if (a >= b) return false;
      // Snap block-boundary ends to text positions inside the scene body.
      if (a === bodyFrom) a = Selection.findFrom(doc.resolve(bodyFrom), 1, true)?.from ?? a;
      if (b === bodyTo) b = Selection.findFrom(doc.resolve(bodyTo), -1, true)?.to ?? b;
      if (a < b) ranges.push([a, b]);
      return false;
    }
    return true;
  });

  if (!ranges.length) return null;
  const tr = state.tr;
  ranges.sort((x, y) => y[0] - x[0]);
  for (const [a, b] of ranges) tr.delete(a, b);
  const at = tr.mapping.map(from, -1);
  tr.setSelection(Selection.near(tr.doc.resolve(at), 1));
  return tr.scrollIntoView();
}

/** Delete the selection without ever damaging structure. */
export const safeDeleteSelection: Command = (state, dispatch) => {
  if (state.selection.empty) return false;
  const { $from, $to } = state.selection;
  if (withinOneRegion($from, $to)) return deleteSelection(state, dispatch);
  const tr = deleteAcrossStructure(state);
  if (tr && dispatch) dispatch(tr);
  return true;
};

function cursor(state: EditorState): ResolvedPos | null {
  const sel = state.selection;
  return sel instanceof TextSelection ? sel.$cursor : null;
}

/** Index of the cursor's textblock within its scene, and the scene node. */
function sceneContext($pos: ResolvedPos) {
  const d = sceneDepth($pos);
  if (d < 0 || $pos.depth !== d + 1) return null; // not a direct child of the scene
  return { depth: d, scene: $pos.node(d), index: $pos.index(d), sceneStart: $pos.start(d) };
}

function childPos(sceneStart: number, scene: PMNode, index: number): number {
  let pos = sceneStart;
  for (let i = 0; i < index; i++) pos += scene.child(i).nodeSize;
  return pos;
}

/** Backspace at the start of a line: never merges titles or scenes. */
export const backspaceAtBoundary: Command = (state, dispatch) => {
  const $c = cursor(state);
  if (!$c || $c.parentOffset > 0) return false;
  if (isTitle($c.parent)) return true;
  const ctx = sceneContext($c);
  if (!ctx) return false; // inside a quote: default lift/join stays within the scene
  const prev = ctx.index > 0 ? ctx.scene.child(ctx.index - 1) : null;
  if (!prev || prev.type === schema.nodes.scene_heading) return true;
  if (prev.type === schema.nodes.section_break) {
    if (dispatch) {
      const at = childPos(ctx.sceneStart, ctx.scene, ctx.index - 1);
      dispatch(state.tr.delete(at, at + prev.nodeSize).scrollIntoView());
    }
    return true;
  }
  return false;
};

/** Delete at the end of a line: never pulls the next scene or a paragraph into a title. */
export const deleteAtBoundary: Command = (state, dispatch) => {
  const $c = cursor(state);
  if (!$c || $c.parentOffset < $c.parent.content.size) return false;
  if (isTitle($c.parent)) return true;
  const ctx = sceneContext($c);
  if (!ctx) {
    // Last paragraph of a quote: joining forward would pull the next block in.
    const d = $c.depth - 1;
    return $c.node(d).type === schema.nodes.quote && $c.index(d) === $c.node(d).childCount - 1;
  }
  const next = ctx.index + 1 < ctx.scene.childCount ? ctx.scene.child(ctx.index + 1) : null;
  if (!next) return true;
  if (next.type === schema.nodes.section_break) {
    if (dispatch) {
      const at = childPos(ctx.sceneStart, ctx.scene, ctx.index + 1);
      dispatch(state.tr.delete(at, at + next.nodeSize).scrollIntoView());
    }
    return true;
  }
  return false;
};

/** Enter in a title or name moves to the first paragraph; it never splits. */
export const enterInTitle: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!isTitle($from.parent)) return false;
  if (dispatch) {
    const after = $from.after();
    let target: number | null = null;
    state.doc.nodesBetween(after, state.doc.content.size, (node, pos) => {
      if (target !== null || node.type === schema.nodes.cold_storage) return false;
      if (node.type === schema.nodes.paragraph) { target = pos + 1; return false; }
      return true;
    });
    if (target !== null) dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)).scrollIntoView());
  }
  return true;
};

/** Enter in an empty quote paragraph leaves the quote (stays in the scene). */
const liftEmptyQuoteParagraph: Command = (state, dispatch) => {
  const $c = cursor(state);
  if (!$c || $c.parent.content.size > 0) return false;
  if ($c.node($c.depth - 1).type !== schema.nodes.quote) return false;
  return liftEmptyBlock(state, dispatch);
};

/** Swallow Backspace/Delete at a textblock edge so the browser never acts there. */
const swallowAtEdge = (dir: -1 | 1): Command => (state) => {
  const $c = cursor(state);
  if (!$c) return false;
  return dir < 0 ? $c.parentOffset === 0 : $c.parentOffset === $c.parent.content.size;
};

const splitParagraph: Command = chainCommands(liftEmptyQuoteParagraph, splitBlock);

/** Enter: titles move on; a selection across structure is cleared first. */
export const enter: Command = (state, dispatch) => {
  if (enterInTitle(state, dispatch)) return true;
  const { $from, $to, empty } = state.selection;
  if (empty || withinOneRegion($from, $to)) return splitParagraph(state, dispatch);
  const cleared = deleteAcrossStructure(state);
  if (!cleared) return true;
  const next = state.apply(cleared);
  if (isTitle(next.selection.$from.parent)) {
    if (dispatch) dispatch(cleared);
    return true;
  }
  let split: Transaction | null = null;
  splitParagraph(next, (tr) => { split = tr; });
  if (dispatch) {
    const finalSplit = split as Transaction | null;
    if (finalSplit) {
      for (const step of finalSplit.steps) cleared.step(step);
      cleared.setSelection(Selection.fromJSON(cleared.doc, finalSplit.selection.toJSON()));
    }
    dispatch(cleared.scrollIntoView());
  }
  return true;
};

// ───────────────────────────── scene names ─────────────────────────────

/**
 * Name the scene at `scenePos` (a scene inside a chapter). An unnamed scene
 * gets an empty name with the caret in it; a named one has its name
 * selected, ready to retype (rename).
 */
export const nameSceneAt = (scenePos: number): Command => (state, dispatch) => {
  const scene = state.doc.nodeAt(scenePos);
  if (!scene || scene.type !== schema.nodes.scene) return false;
  if (state.doc.resolve(scenePos).parent.type !== schema.nodes.chapter) return false; // never in cold storage
  if (!dispatch) return true;
  const heading = scene.firstChild?.type === schema.nodes.scene_heading ? scene.firstChild : null;
  const tr = state.tr;
  if (heading) {
    tr.setSelection(TextSelection.create(tr.doc, scenePos + 2, scenePos + 2 + heading.content.size));
  } else {
    tr.insert(scenePos + 1, schema.nodes.scene_heading!.create());
    tr.setSelection(TextSelection.create(tr.doc, scenePos + 2));
    markFreshSceneName(markStructural(tr), scenePos + 1);
  }
  dispatch(tr.scrollIntoView());
  return true;
};

/** Name (or rename) the scene holding the caret. */
export const nameScene: Command = (state, dispatch) => {
  const $h = state.selection.$head;
  const d = sceneDepth($h);
  return d < 0 ? false : nameSceneAt($h.before(d))(state, dispatch);
};

/** Backspace in an empty scene name: the scene becomes unnamed again. */
export const removeEmptySceneName: Command = (state, dispatch) => {
  const $c = cursor(state);
  if (!$c || $c.parent.type !== schema.nodes.scene_heading || $c.parent.content.size > 0) return false;
  if (dispatch) {
    const tr = state.tr.delete($c.before(), $c.after());
    const $scene = tr.doc.resolve(tr.mapping.map($c.before()));
    tr.setSelection(Selection.findFrom($scene, 1, true) ?? Selection.near($scene));
    dispatch(markStructural(tr).scrollIntoView());
  }
  return true;
};

export const backspace: Command = chainCommands(undoInputRule, safeDeleteSelection, removeEmptySceneName, backspaceAtBoundary, joinBackward, swallowAtEdge(-1));
export const forwardDelete: Command = chainCommands(safeDeleteSelection, deleteAtBoundary, joinForward, swallowAtEdge(1));

/**
 * Split the current scene at the caret (⌘↵). The new scene gets a fresh
 * identity; the caret lands on its first line.
 */
export const splitScene: Command = (state, dispatch) => {
  const $c = cursor(state);
  if (!$c) return false;
  const ctx = sceneContext($c);
  if (!ctx || $c.parent.type !== schema.nodes.paragraph) return true;
  if ($c.node(ctx.depth - 1).type !== schema.nodes.chapter) return true; // never in cold storage
  if (!dispatch) return true;
  const sceneType = schema.nodes.scene!;
  const newScene = { type: sceneType, attrs: { id: newId(), link: null } };
  const tr = state.tr;
  const firstBody = ctx.scene.firstChild?.type === schema.nodes.scene_heading ? 1 : 0;
  const atStart = $c.parentOffset === 0 && ctx.index > firstBody;
  const atEnd = $c.parentOffset === $c.parent.content.size && ctx.index < ctx.scene.childCount - 1;

  // tr.split takes the types for the nodes after the split outermost-first.
  let splitAt: number;
  if (atStart && ctx.scene.child(ctx.index - 1).type === schema.nodes.paragraph) {
    // Split between blocks: no empty paragraph left behind.
    splitAt = $c.before();
    tr.split(splitAt, 1, [newScene]);
  } else if (atEnd) {
    splitAt = $c.after();
    tr.split(splitAt, 1, [newScene]);
  } else {
    splitAt = $c.pos;
    tr.split(splitAt, 2, [newScene, { type: schema.nodes.paragraph! }]);
  }
  const $in = tr.doc.resolve(tr.mapping.map(splitAt, 1));
  const d = sceneDepth($in);
  const start = d > 0 ? $in.start(d) : $in.pos;
  tr.setSelection(Selection.findFrom(tr.doc.resolve(start), 1, true) ?? Selection.near(tr.doc.resolve(start)));
  dispatch(markStructural(tr).scrollIntoView());
  return true;
};

/**
 * Insert a pause — a section break within the scene (⌘⇧↵). Mid-line it
 * splits the paragraph; at a line's start it goes before the line; at its
 * end, after it. The caret lands where writing continues. Never doubles a
 * pause or opens a scene with one; never in titles, quotes, or cold storage.
 */
export const insertSectionBreak: Command = (state, dispatch) => {
  const $c = cursor(state);
  if (!$c) return false;
  const ctx = sceneContext($c);
  if (!ctx || $c.parent.type !== schema.nodes.paragraph) return true;
  if ($c.node(ctx.depth - 1).type !== schema.nodes.chapter) return true;
  const pause = schema.nodes.section_break!;
  const at = (i: number) => (i >= 0 && i < ctx.scene.childCount ? ctx.scene.child(i) : null);
  const prev = at(ctx.index - 1);
  const next = at(ctx.index + 1);
  const atStart = $c.parentOffset === 0;
  const atEnd = $c.parentOffset === $c.parent.content.size;
  const tr = state.tr;

  if (atStart) {
    // Nothing to pause after (scene start or its name), or a pause already there.
    if (!prev || prev.type === schema.nodes.scene_heading || prev.type === pause) return true;
    tr.insert($c.before(), pause.create());
  } else if (atEnd) {
    if (next?.type === pause) return true;
    // Continue on the next line; add one only when there isn't a paragraph to continue on.
    const lineAfter = next?.type === schema.nodes.paragraph ? [] : [schema.nodes.paragraph!.create()];
    tr.insert($c.after(), [pause.create(), ...lineAfter]);
    tr.setSelection(TextSelection.create(tr.doc, $c.after() + 2));
  } else {
    tr.split($c.pos);
    tr.insert($c.pos + 1, pause.create());
    tr.setSelection(TextSelection.create(tr.doc, $c.pos + 3));
  }
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
};

export const toggleBold: Command = (state, dispatch) => {
  if (isTitle(state.selection.$from.parent)) return true;
  toggleMark(schema.marks.bold!, null, { removeWhenPresent: false })(state, dispatch);
  return true;
};

export const toggleItalic: Command = (state, dispatch) => {
  if (isTitle(state.selection.$from.parent)) return true;
  toggleMark(schema.marks.italic!, null, { removeWhenPresent: false })(state, dispatch);
  return true;
};

// ───────────────────────────── paste ─────────────────────────────

/** Pasted text keeps bold/italic; links go (spec §4.1); a note's anchor stays only if it moved (cut, not copied). */
function cleanInline(node: PMNode, present: Set<string>): PMNode {
  if (!node.isText) return node;
  return node.mark(node.marks.filter((m) => m.type !== schema.marks.link && !(m.type === schema.marks.note && present.has(m.attrs.id))));
}

/**
 * Pasted content becomes paragraphs with bold/italic only. Headings,
 * chapters, and scenes in the clipboard never become structure here.
 */
export function flattenPastedSlice(slice: Slice, state?: EditorState): Slice {
  const present = new Set<string>();
  state?.doc.descendants((n) => { for (const m of n.marks) if (m.type === schema.marks.note) present.add(m.attrs.id); return true; });
  const clean = (n: PMNode) => cleanInline(n, present);
  let inlineOnly = true;
  slice.content.forEach((n) => { if (!n.isInline) inlineOnly = false; });
  if (inlineOnly) {
    const nodes: PMNode[] = [];
    slice.content.forEach((n) => nodes.push(clean(n)));
    return new Slice(Fragment.fromArray(nodes), 0, 0);
  }
  const blocks: PMNode[] = [];
  slice.content.descendants((node) => {
    if (node.type === schema.nodes.section_break) { blocks.push(node); return false; }
    if (node.isTextblock) {
      const inline: PMNode[] = [];
      node.forEach((c) => inline.push(clean(c)));
      blocks.push(schema.nodes.paragraph!.create(null, inline));
      return false;
    }
    return true;
  });
  if (!blocks.length) return Slice.empty;
  const openStart = blocks[0]!.isTextblock ? 1 : 0;
  const openEnd = blocks[blocks.length - 1]!.isTextblock ? 1 : 0;
  return new Slice(Fragment.fromArray(blocks), openStart, openEnd);
}

/** Paste into a title inserts plain text on one line. */
export function pasteIntoTitle(state: EditorState, slice: Slice): Transaction | null {
  if (!isTitle(state.selection.$from.parent) || !withinOneRegion(state.selection.$from, state.selection.$to)) return null;
  const text = slice.content.textBetween(0, slice.content.size, ' ', ' ').replace(/\s+/g, ' ');
  return state.tr.insertText(text).scrollIntoView();
}

// ───────────────────────────── restore ─────────────────────────────

/**
 * Replace the whole manuscript with an earlier version (History → Restore).
 * One undo step of its own; the caret lands on the first line of prose.
 */
export function restoreManuscript(state: EditorState, m: Manuscript): Transaction {
  const doc = modelToDoc(m);
  const tr = closeHistory(state.tr).replaceWith(0, state.doc.content.size, doc.content);
  let first = -1;
  tr.doc.descendants((node, pos) => {
    if (first >= 0 || node.type === schema.nodes.cold_storage) return false;
    if (node.type === schema.nodes.paragraph) { first = pos + 1; return false; }
    return true;
  });
  tr.setSelection(first >= 0 ? TextSelection.create(tr.doc, first) : Selection.atStart(tr.doc));
  return markStructural(tr).scrollIntoView();
}
