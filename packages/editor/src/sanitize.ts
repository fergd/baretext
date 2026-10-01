// No text node may contain a line break: paragraphs are nodes, not "\n".
// Input methods, dictation, or programmatic inserts can still produce one,
// so any that appear are replaced with a space in the same undo step.

import { Plugin, Selection, TextSelection } from 'prosemirror-state';

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
 * The selection may never reach into cold storage (it isn't rendered in the
 * manuscript). A selection that runs into it (Select All, a shift-click past
 * the end) is trimmed to end on the last manuscript line, keeping its
 * direction; one entirely inside it becomes a caret on that line.
 */
export function selectionOutsideColdStorage(): Plugin {
  return new Plugin({
    appendTransaction(_trs, _old, state) {
      const { doc, selection } = state;
      const coldStart = doc.content.size - doc.lastChild!.nodeSize;
      if (selection.to <= coldStart) return null;
      const last = Selection.findFrom(doc.resolve(coldStart), -1, true);
      if (!last) return null;
      if (selection.from >= coldStart) return state.tr.setSelection(last);
      const first = Selection.findFrom(doc.resolve(selection.from), 1, true);
      if (!first || first.from >= last.to) return state.tr.setSelection(last);
      const forward = selection.head >= selection.anchor;
      return state.tr.setSelection(forward
        ? TextSelection.create(doc, first.from, last.to)
        : TextSelection.create(doc, last.to, first.from));
    },
  });
}
