import { history, redo, undo } from 'prosemirror-history';
import { InputRule, inputRules } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { EditorState, Plugin, TextSelection, type Transaction } from 'prosemirror-state';
import type { EditorProps } from 'prosemirror-view';
import type { Manuscript } from '@baretext/format';
import {
  backspace,
  deleteAcrossStructure,
  enter,
  flattenPastedSlice,
  forwardDelete,
  insertSectionBreak,
  pasteIntoTitle,
  splitScene,
  splitChapter,
  toggleBold,
  toggleItalic,
  withinOneRegion,
} from './commands';
import { modelToDoc } from './convert';
import { structureDecorations, type Placeholders } from './decorations';
import { lineBreakSanitizer } from './sanitize';
import { parkedView } from './cold';
import { structureGuard, type GuardOptions } from './structure';
import { dropEmptySceneNames } from './naming';
import { findHighlights } from './find';

export * from './schema';
export * from './convert';
export * from './commands';
export { bookSetupOf, setBeat, setBookSetup, type BookSetup } from './book';
export { BOOK_TITLE, rename, addScene, addChapter, moveScene, moveChapter, deleteScene, deleteChapter } from './outline-commands';
export { parkedKey, openParked, closeParked, moveToColdStorage, restoreFromColdStorage } from './cold';
export { addNoteAnchor, removeNoteAnchor, anchorsIn, describeAnchor, locateAnchor, applyAnchors, type AnchorRange, type SavedAnchor } from './notes';
export * from './structure';
export * from './decorations';
export * from './format';
export * from './find';
export { docToExport, type ExportNoteInput, type ExportOptions } from './export';
export { sprintSchema, sprintDoc, sprintBlocks, sprintWords, createSprintState, placeSprint, insertSprintPause, type SprintPlacement } from './sprint';

const emDash = new InputRule(/--$/, '—');

/** Typing or pasting over a selection that spans structure clears it safely first. */
const safeReplace = new Plugin({
  props: {
    handleTextInput(view, _from, _to, text) {
      const { $from, $to } = view.state.selection;
      if (view.state.selection.empty || withinOneRegion($from, $to)) return false;
      const tr = deleteAcrossStructure(view.state);
      if (!tr) return true;
      tr.insertText(text);
      view.dispatch(tr);
      return true;
    },
    handlePaste(view, _event, slice) {
      const titleTr = pasteIntoTitle(view.state, slice);
      if (titleTr) { view.dispatch(titleTr); return true; }
      const { $from, $to, empty } = view.state.selection;
      if (!empty && !withinOneRegion($from, $to)) {
        const tr = deleteAcrossStructure(view.state);
        if (tr) view.dispatch(tr);
      }
      return false;
    },
    handleDOMEvents: {
      // Composition over a cross-structure selection: collapse it first so
      // the browser never deletes across a boundary in the DOM.
      compositionstart(view) {
        const { $from, $to, empty } = view.state.selection;
        if (empty || withinOneRegion($from, $to)) return false;
        const tr = deleteAcrossStructure(view.state);
        if (tr) view.dispatch(tr);
        return false;
      },
    },
    transformPasted: (slice, view) => flattenPastedSlice(slice, view.state),
  } satisfies EditorProps,
});

export interface EditorOptions extends GuardOptions {
  placeholders?: Placeholders;
}

export function manuscriptPlugins(options: EditorOptions = {}): Plugin[] {
  const placeholders = options.placeholders ?? { book: 'Untitled', chapter: 'Untitled', scene: 'Untitled' };
  return [
    structureGuard(options),
    lineBreakSanitizer(),
    parkedView(),
    dropEmptySceneNames(),
    inputRules({ rules: [emDash] }),
    safeReplace,
    keymap({
      Enter: enter,
      'Mod-Enter': splitScene,
      'Shift-Mod-Enter': insertSectionBreak,
      'Alt-Mod-Enter': splitChapter,
      // Every delete-type key goes through the structure-safe commands;
      // mid-line they fall through to the browser's native word/line deletes.
      Backspace: backspace,
      'Shift-Backspace': backspace,
      'Mod-Backspace': backspace,
      'Alt-Backspace': backspace,
      'Ctrl-h': backspace,
      'Ctrl-Alt-Backspace': backspace,
      Delete: forwardDelete,
      'Mod-Delete': forwardDelete,
      'Alt-Delete': forwardDelete,
      'Ctrl-d': forwardDelete,
      'Ctrl-Alt-Delete': forwardDelete,
      'Alt-d': forwardDelete,
      'Mod-b': toggleBold,
      'Mod-i': toggleItalic,
      'Mod-z': undo,
      'Shift-Mod-z': redo,
      'Mod-y': redo,
    }),
    keymap(baseKeymap),
    history({ newGroupDelay: 500 }),
    structureDecorations(placeholders),
    findHighlights(),
  ];
}

export function createManuscriptState(m: Manuscript, options: EditorOptions = {}): EditorState {
  const doc = modelToDoc(m);
  const state = EditorState.create({ doc, plugins: manuscriptPlugins(options) });
  // Start on the first paragraph, not in the book title.
  let first = 0;
  doc.descendants((node, pos) => {
    if (first || node.type.name === 'cold_storage') return false;
    if (node.type.name === 'paragraph') { first = pos + 1; return false; }
    return true;
  });
  return first ? state.apply(state.tr.setSelection(TextSelection.create(doc, first))) : state;
}

export type { Transaction };
