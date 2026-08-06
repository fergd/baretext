import { EditorView, keymap, placeholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { theme, injectSelectionFix, injectHeadingColors } from './theme.js';
import { markdownExtensions } from './markdown-language.js';
import { livePreviewPlugin, renderedModeField } from './live-preview.js';
import { sceneBreakDecorator, injectSceneBreakStyle } from './scene-breaks.js';
import { blockSpacingPlugin, injectBlockSpacingStyle } from './block-spacing.js';
import { historyAndKeymaps, boldItalicKeymap } from './history-commands.js';
import { searchExtension, injectSearchMatchStyle } from './search.js';
import { spellcheckField, spellcheckPlugin, injectSpellcheckStyle } from './spellcheck.js';
import { chapterPlaceholderPlugin, injectChapterPlaceholderStyle } from './chapter-placeholder.js';

let registeredKeys = {};

// Must be called before create() — the app keymap is built from whatever's
// registered at creation time (matches app.js's existing call order:
// registerKeys() once at boot, before the one create() call).
export function registerKeys(keys) {
  registeredKeys = keys;
}

export function create(container, initialDoc, onChange, placeholderText) {
  let suppressed = false;

  const appKeymap = keymap.of(
    Object.entries(registeredKeys).map(([key, fn]) => ({
      key,
      run: () => (fn(), true),
      preventDefault: true,
    }))
  );

  injectSelectionFix();
  injectHeadingColors();
  injectSceneBreakStyle();
  injectBlockSpacingStyle();
  injectSearchMatchStyle();
  injectSpellcheckStyle();
  injectChapterPlaceholderStyle();

  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: initialDoc || '',
      extensions: [
        ...historyAndKeymaps(),
        EditorView.lineWrapping,
        renderedModeField,
        livePreviewPlugin,
        sceneBreakDecorator,
        blockSpacingPlugin,
        chapterPlaceholderPlugin,
        searchExtension,
        spellcheckField,
        spellcheckPlugin,
        boldItalicKeymap(),
        appKeymap,
        ...markdownExtensions(),
        theme,
        // Fixes a confirmed bug in the old bundle: the 4th create() arg
        // (placeholder text) was silently dropped — never wired to a real
        // placeholder() extension, despite the theme having a leftover
        // .cm-placeholder CSS rule waiting for it.
        placeholder(placeholderText || ''),
        EditorView.contentAttributes.of({ 'aria-label': 'editor' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !suppressed && onChange) onChange(view.state.doc.toString());
        }),
      ],
    }),
  });

  view._setSuppressed = (value) => { suppressed = value; };
  return view;
}

export function getDoc(view) {
  return view.state.doc.toString();
}

export function setDoc(view, text) {
  view._setSuppressed(true);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text || '' } });
  view._setSuppressed(false);
}

export function focus(view) {
  view.focus();
}

export function centerCursor(view) {
  const pos = view.state.selection.main.head;
  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
}

export function getCursorPos(view) {
  return view.state.selection.main.head;
}

export function setCursorPos(view, pos) {
  const max = view.state.doc.length;
  const clamped = Math.max(0, Math.min(pos, max));
  view.dispatch({
    selection: { anchor: clamped, head: clamped },
    effects: EditorView.scrollIntoView(clamped, { y: 'center' }),
  });
}

export function cursorToEnd(view) {
  const end = view.state.doc.length;
  view.dispatch({
    selection: { anchor: end, head: end },
    effects: EditorView.scrollIntoView(end, { y: 'center' }),
  });
}
