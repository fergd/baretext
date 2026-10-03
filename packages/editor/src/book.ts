// The book's setup (DECISIONS §26): its title (the book_title node), and its
// author, structure and target length (attributes on the document); and the
// story beats its scenes are marked as (§27; an attribute on each scene).

import { closeHistory } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import { isSlug, isTarget } from '@baretext/format';
import { schema } from './schema';
import { markStructural } from './structure';

export interface BookSetup {
  title: string;
  /** Blank: none. */
  author: string;
  structure: string | null;
  /** In words; null: none. */
  target: number | null;
}

/** The book's setup as the document holds it. */
export function bookSetupOf(doc: PMNode): BookSetup {
  return { title: doc.firstChild!.textContent, author: doc.attrs.author ?? '', structure: doc.attrs.structure, target: doc.attrs.target };
}

/**
 * Set the book's setup in one undoable step (the caret stays where it was).
 * Names stay on one line and are trimmed. False when nothing differs, or a
 * value couldn't be saved (a target that isn't a whole number of words, a
 * structure that isn't an id).
 */
export const setBookSetup = (next: BookSetup): Command => (state, dispatch) => {
  if (next.target !== null && !isTarget(next.target)) return false;
  if (next.structure !== null && !isSlug(next.structure)) return false;
  const line = (s: string) => s.replace(/\s+/g, ' ').trim();
  const title = line(next.title);
  const attrs = { author: line(next.author) || null, structure: next.structure, target: next.target };
  const doc = state.doc;
  const titleNode = doc.firstChild!;
  const tr = state.tr;
  if (titleNode.textContent !== title) {
    if (title) tr.replaceWith(1, titleNode.nodeSize - 1, schema.text(title));
    else tr.delete(1, titleNode.nodeSize - 1);
  }
  for (const [key, value] of Object.entries(attrs)) if (doc.attrs[key] !== value) tr.setDocAttribute(key, value);
  if (!tr.docChanged) return false;
  if (dispatch) dispatch(closeHistory(markStructural(tr)));
  return true;
};

/**
 * Mark a scene as a story beat (null: unmark it), in one undoable step. A
 * beat belongs to one scene: another scene marked with it is unmarked in the
 * same step. False when nothing changes or the scene isn't found.
 */
export const setBeat = (sceneId: string, beat: string | null): Command => (state, dispatch) => {
  if (beat !== null && !isSlug(beat)) return false;
  const tr = state.tr;
  let found = false;
  state.doc.descendants((node, pos) => {
    if (node.type !== schema.nodes.scene) return node.type !== schema.nodes.paragraph; // (scenes sit in chapters and cold storage)
    if (node.attrs.id === sceneId) {
      found = true;
      if (node.attrs.beat !== beat) tr.setNodeAttribute(pos, 'beat', beat);
    } else if (beat !== null && node.attrs.beat === beat) {
      tr.setNodeAttribute(pos, 'beat', null);
    }
    return false;
  });
  if (!found || !tr.docChanged) return false;
  if (dispatch) dispatch(closeHistory(markStructural(tr)));
  return true;
};
