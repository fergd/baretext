// No text node may contain a line break: paragraphs are nodes, not "\n".
// Input methods, dictation, or programmatic inserts can still produce one,
// so any that appear are replaced with a space in the same undo step.

import { Plugin, Selection } from 'prosemirror-state';

const LINE_BREAK = /[\r\n]/g;

export function lineBreakSanitizer(): Plugin {
  return new Plugin({
    appendTransaction(trs, oldState, newState) {
      if (!trs.some((tr) => tr.docChanged)) return null;
      const start = oldState.doc.content.findDiffStart(newState.doc.content);
      if (start == null) return null;
      const end = oldState.doc.content.findDiffEnd(newState.doc.content);
      const to = end ? Math.max(end.b, start) : newState.doc.content.size;
      const fixes: Array<[number, number]> = [];
      newState.doc.nodesBetween(start, to, (node, pos) => {
        if (!node.isText) return true;
        for (const m of node.text!.matchAll(LINE_BREAK)) fixes.push([pos + m.index!, pos + m.index! + 1]);
        return false;
      });
      if (!fixes.length) return null;
      const tr = newState.tr;
      for (const [a, b] of fixes.reverse()) tr.insertText(' ', a, b);
      return tr;
    },
  });
}

/**
 * The selection may never rest inside cold storage (it isn't rendered in
 * the manuscript). If anything puts it there, move it to the last
 * manuscript line.
 */
export function selectionOutsideColdStorage(): Plugin {
  return new Plugin({
    appendTransaction(_trs, _old, state) {
      const coldStart = state.doc.content.size - state.doc.lastChild!.nodeSize;
      if (state.selection.to <= coldStart) return null;
      const target = Selection.findFrom(state.doc.resolve(coldStart), -1, true);
      return target ? state.tr.setSelection(target) : null;
    },
  });
}
