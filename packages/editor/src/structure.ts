// Structure guard. Typing, deleting, pasting, IME, drag-and-drop — none of
// them may add, remove, reorder, or rename-into-existence a chapter or
// scene. Only explicit structural commands (tagged with STRUCTURAL) may.
// Anything else that would change structure is rejected; ProseMirror then
// redraws the untouched document, so a rejected DOM edit self-heals.

import type { Node as PMNode } from 'prosemirror-model';
import { isHistoryTransaction } from 'prosemirror-history';
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { parkedKey } from './keys';

export const STRUCTURAL = 'baretext:structural';

export function markStructural(tr: Transaction): Transaction {
  return tr.setMeta(STRUCTURAL, true);
}

/**
 * A compact signature of the document's structure: chapter and scene
 * identities, their order, and whether each scene is named. Cheap — it
 * visits only top-level and chapter-level nodes.
 */
export function structureSignature(doc: PMNode): string {
  const parts: string[] = [];
  doc.forEach((top) => {
    if (top.type.name === 'chapter') {
      parts.push('C' + top.attrs.id);
      top.forEach((s) => {
        if (s.type.name === 'scene') parts.push('S' + s.attrs.id + (s.firstChild?.type.name === 'scene_heading' ? '#' : '') + (s.attrs.link ? '@' + s.attrs.link : ''));
      });
    } else if (top.type.name === 'cold_storage') {
      parts.push('K');
      top.forEach((s) => parts.push('S' + s.attrs.id + (s.firstChild?.type.name === 'scene_heading' ? '#' : '') + (s.attrs.link ? '@' + s.attrs.link : '')));
    }
  });
  return parts.join(' ');
}

/** Cold storage is the same, apart from the content of the scene `open` (its identity and attributes kept). */
function coldUnchangedExcept(before: PMNode, after: PMNode, open: string | null): boolean {
  if (!open) return after.eq(before);
  if (after.childCount !== before.childCount) return false;
  for (let i = 0; i < before.childCount; i++) {
    const a = before.child(i);
    const b = after.child(i);
    if (a.attrs.id === open ? !b.sameMarkup(a) : !b.eq(a)) return false;
  }
  return true;
}

export const structureGuardKey = new PluginKey<{ rejected: number }>('structureGuard');

export interface GuardOptions {
  /** Called when a transaction is rejected (for diagnostics and tests). */
  onReject?: (tr: Transaction) => void;
}

export function structureGuard(options: GuardOptions = {}): Plugin {
  return new Plugin({
    key: structureGuardKey,
    filterTransaction(tr, state) {
      // Undo/redo only replay changes that were accepted when first made.
      if (!tr.docChanged || tr.getMeta(STRUCTURAL) || isHistoryTransaction(tr)) return true;
      // Cold storage changes only through explicit commands (move, restore,
      // rename, delete) — except the text of the one parked scene open on
      // the page, which the writer edits like any scene.
      const coldUnchanged = coldUnchangedExcept(state.doc.lastChild!, tr.doc.lastChild!, parkedKey.getState(state) ?? null);
      if (coldUnchanged && structureSignature(tr.doc) === structureSignature(state.doc)) return true;
      options.onReject?.(tr);
      return false;
    },
  });
}
