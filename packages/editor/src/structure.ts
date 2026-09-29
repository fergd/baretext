// Structure guard. Typing, deleting, pasting, IME, drag-and-drop — none of
// them may add, remove, reorder, or rename-into-existence a chapter or
// scene. Only explicit structural commands (tagged with STRUCTURAL) may.
// Anything else that would change structure is rejected; ProseMirror then
// redraws the untouched document, so a rejected DOM edit self-heals.

import type { Node as PMNode } from 'prosemirror-model';
import { isHistoryTransaction } from 'prosemirror-history';
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';

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
      // Cold storage is edited only through explicit commands (archive,
      // restore, the isolated scene view), never by ordinary input.
      const coldUnchanged = tr.doc.lastChild!.eq(state.doc.lastChild!);
      if (coldUnchanged && structureSignature(tr.doc) === structureSignature(state.doc)) return true;
      options.onReject?.(tr);
      return false;
    },
  });
}
