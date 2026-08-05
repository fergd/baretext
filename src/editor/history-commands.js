import { history, historyKeymap, defaultKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { keymap } from '@codemirror/view';

export function historyAndKeymaps() {
  return [
    history(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
  ];
}

// Re-exported so app-level code can trigger undo/redo directly (e.g. from
// the corkboard, which isn't the CodeMirror content DOM and so never sees
// historyKeymap's own Mod-z/Mod-Shift-z bindings — those only fire when the
// editor itself has focus).
export { undo, redo };

// Wraps (or, if the selection is already wrapped, unwraps) the selection in
// a markdown delimiter — e.g. Mod-b -> **bold**, Mod-i -> *italic*, toggling
// off if the exact delimiter is already found immediately outside the
// selection on both sides.
export function wrapSelection(delimiter) {
  return (view) => {
    const { from, to } = view.state.selection.main;
    const doc = view.state.doc;
    const len = delimiter.length;
    const before = doc.sliceString(Math.max(0, from - len), from);
    const after = doc.sliceString(to, Math.min(doc.length, to + len));

    if (before === delimiter && after === delimiter) {
      view.dispatch({
        changes: [
          { from: from - len, to: from, insert: '' },
          { from: to, to: to + len, insert: '' },
        ],
        selection: { anchor: from - len, head: to - len },
      });
    } else {
      view.dispatch({
        changes: [
          { from, to: from, insert: delimiter },
          { from: to, to, insert: delimiter },
        ],
        selection: { anchor: from + len, head: to + len },
      });
    }
    view.focus();
    return true;
  };
}

export function boldItalicKeymap() {
  return keymap.of([
    { key: 'Mod-b', run: wrapSelection('**'), preventDefault: true },
    { key: 'Mod-i', run: wrapSelection('*'), preventDefault: true },
  ]);
}
