// Notes' anchors (spec §9): an invisible `note` mark on the passage a note is
// about. Marks travel with the text through edits, moves, Cold Storage and
// undo, and are never saved in the manuscript; the notes file keeps each
// anchor as { scene, quote, offset } so it can be found again on reopening.
// Anchors are bookkeeping: never undo steps, never part of the prose.

import type { Node as PMNode } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { schema } from './schema';
import { markStructural } from './structure';
import { findScene } from './outline-commands';

export interface AnchorRange {
  from: number;
  to: number;
  /** The scene it's in (parked scenes included). */
  scene: string;
}

/** What the notes file stores to find an anchor again. */
export interface SavedAnchor {
  scene: string;
  /** The anchored text, paragraphs joined by "\n". */
  quote: string;
  /** Where the quote starts in its scene's prose text. */
  offset: number;
}

const bookkeeping = (tr: Transaction) => markStructural(tr).setMeta('addToHistory', false);

/** Every anchor in the document: id → its range and scene. */
export function anchorsIn(doc: PMNode): Map<string, AnchorRange> {
  const out = new Map<string, AnchorRange>();
  doc.forEach((top, offset) => {
    if (top.type !== schema.nodes.chapter && top.type !== schema.nodes.cold_storage) return;
    top.forEach((scene, sceneOffset) => {
      if (scene.type !== schema.nodes.scene) return;
      const base = offset + 1 + sceneOffset;
      scene.descendants((node, pos) => {
        for (const m of node.marks) {
          if (m.type !== schema.marks.note) continue;
          const from = base + 1 + pos;
          const to = from + node.nodeSize;
          const a = out.get(m.attrs.id);
          if (!a) out.set(m.attrs.id, { from, to, scene: scene.attrs.id });
          else { a.from = Math.min(a.from, from); a.to = Math.max(a.to, to); }
        }
        return true;
      });
    });
  });
  return out;
}

/** The scene's prose as one string (paragraphs joined by "\n"), with each character's document position. */
function proseIndex(scene: PMNode, scenePos: number): { text: string; at: number[] } {
  let text = '';
  const at: number[] = [];
  scene.descendants((node, pos) => {
    if (node.type === schema.nodes.scene_heading) return false;
    if (!node.isTextblock) return true;
    if (text) { text += '\n'; at.push(-1); }
    node.forEach((child, childOffset) => {
      if (!child.isText) return;
      for (let i = 0; i < child.text!.length; i++) at.push(scenePos + 1 + pos + 1 + childOffset + i);
      text += child.text!;
    });
    return false;
  });
  return { text, at };
}

/** Anchor the selection to note `id`. The passage must lie in one scene's prose. */
export const addNoteAnchor = (id: string): Command => (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty) return false;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  const sceneOf = ($p: typeof $from) => { for (let d = $p.depth; d > 0; d--) if ($p.node(d).type === schema.nodes.scene) return $p.before(d); return -1; };
  const scene = sceneOf($from);
  if (scene < 0 || scene !== sceneOf($to)) return false;
  let prose = false;
  state.doc.nodesBetween(from, to, (n, _pos, parent) => { if (n.isText && parent?.type.allowsMarkType(schema.marks.note!)) prose = true; return !prose; });
  if (!prose) return false;
  if (dispatch) dispatch(bookkeeping(state.tr.addMark(from, to, schema.marks.note!.create({ id }))));
  return true;
};

/** Remove note `id`'s anchor (the note was deleted). */
export const removeNoteAnchor = (id: string): Command => (state, dispatch) => {
  const a = anchorsIn(state.doc).get(id);
  if (!a) return false;
  if (dispatch) dispatch(bookkeeping(state.tr.removeMark(a.from, a.to, schema.marks.note!.create({ id }))));
  return true;
};

/** How to find an anchor again: its scene, its text, and where that text starts in the scene. */
export function describeAnchor(doc: PMNode, a: AnchorRange): SavedAnchor {
  const found = findScene(doc, a.scene)!;
  const { text, at } = proseIndex(found.node, found.pos);
  const start = at.findIndex((p) => p >= a.from);
  const end = at.findIndex((p) => p >= a.to);
  return { scene: a.scene, quote: text.slice(start, end < 0 ? text.length : end), offset: Math.max(0, start) };
}

/** Find a saved anchor: its quote in its scene, nearest the old offset; else anywhere in the book. */
export function locateAnchor(doc: PMNode, saved: SavedAnchor): { from: number; to: number } | null {
  if (!saved.quote) return null;
  const inScene = (scene: PMNode, pos: number, near: number) => {
    const { text, at } = proseIndex(scene, pos);
    let best = -1;
    for (let i = text.indexOf(saved.quote); i >= 0; i = text.indexOf(saved.quote, i + 1)) {
      if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) best = i;
    }
    if (best < 0) return null;
    return { from: at[best]!, to: at[best + saved.quote.length - 1]! + 1 };
  };
  const own = findScene(doc, saved.scene);
  const hit = own ? inScene(own.node, own.pos, saved.offset) : null;
  if (hit) return hit;
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type !== schema.nodes.scene) return true;
    found = inScene(node, pos, 0);
    return false;
  });
  return found;
}

/** Put anchors on a freshly opened document (bookkeeping: not an undo step). */
export function applyAnchors(state: EditorState, anchors: Array<{ id: string; from: number; to: number }>): Transaction {
  const tr = state.tr;
  for (const a of anchors) tr.addMark(a.from, a.to, schema.marks.note!.create({ id: a.id }));
  return bookkeeping(tr);
}
