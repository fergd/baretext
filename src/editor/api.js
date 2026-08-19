import { EditorView, keymap, placeholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { theme, injectSelectionFix, injectHeadingColors } from './theme.js';
import { markdownExtensions } from './markdown-language.js';
import { livePreviewPlugin, renderedModeField } from './live-preview.js';
import { sceneBreakDecorator, sceneBreakAtomicRanges, injectSceneBreakStyle } from './scene-breaks.js';
import { blockSpacingPlugin, injectBlockSpacingStyle } from './block-spacing.js';
import { historyAndKeymaps, boldItalicKeymap } from './history-commands.js';
import { searchExtension, injectSearchMatchStyle } from './search.js';
import { spellcheckField, spellcheckPlugin, injectSpellcheckStyle } from './spellcheck.js';
import { emDashInputHandler } from './em-dash.js';
import { chapterPlaceholderPlugin, injectChapterPlaceholderStyle } from './chapter-placeholder.js';
import { manuscriptGutterPlugin, manuscriptGutterAlignPlugin, injectManuscriptGutterStyle } from './manuscript-gutter.js';
import { editorModeField, setEditorMode as setEditorModeField } from './mode-state.js';
import { coldStorageViewField, coldStorageHideField, setColdStorageViewEffect } from './cold-storage-view.js';

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
  injectManuscriptGutterStyle();

  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: initialDoc || '',
      extensions: [
        ...historyAndKeymaps(),
        EditorView.lineWrapping,
        renderedModeField,
        editorModeField,
        livePreviewPlugin,
        sceneBreakDecorator,
        sceneBreakAtomicRanges,
        blockSpacingPlugin,
        chapterPlaceholderPlugin,
        manuscriptGutterPlugin,
        manuscriptGutterAlignPlugin,
        coldStorageViewField,
        coldStorageHideField,
        searchExtension,
        spellcheckField,
        spellcheckPlugin,
        boldItalicKeymap(),
        emDashInputHandler,
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

// Scrolls so the cursor lands near the TOP of the viewport instead of
// centered — used for rail/corkboard navigation jumps (scene-nav), where
// centering buries the heading you just jumped to (and everything right
// after it) in the middle of the screen instead of letting you read forward
// from it. setCursorPos()'s own scroll (used by outline jump, search, etc.)
// stays centered — this is a deliberate, separate choice for jump
// navigation specifically, not a change to cursor-positioning in general.
export function scrollToTop(view) {
  const pos = view.state.selection.main.head;
  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }) });
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

// Enters Cold Storage "scene view" — hides everything outside [from, to)
// (see cold-storage-view.js) and moves the cursor to the start of that
// range. Cursor lands at top (not centered) for the same reason
// scrollToTop() exists: this is a jump into fresh context, not a
// small in-place move.
export function enterColdStorageScene(view, from, to) {
  view.dispatch({
    effects: [
      setColdStorageViewEffect.of({ from, to }),
      EditorView.scrollIntoView(from, { y: 'start', yMargin: 24 }),
    ],
    selection: { anchor: from, head: from },
  });
}

// Leaves scene view and restores the cursor to wherever it was in the real
// manuscript before scene view was entered — centered, not top-aligned,
// since this is "you're back where you left off" rather than a fresh jump.
export function exitColdStorageScene(view, restorePos) {
  const max = view.state.doc.length;
  const clamped = Math.max(0, Math.min(restorePos, max));
  view.dispatch({
    effects: [
      setColdStorageViewEffect.of(null),
      EditorView.scrollIntoView(clamped, { y: 'center' }),
    ],
    selection: { anchor: clamped, head: clamped },
  });
}

export function getColdStorageView(view) {
  return view.state.field(coldStorageViewField);
}

// Silently re-syncs scene view's hidden boundaries to fresh {from, to}
// values without touching cursor or scroll — used by scene-nav's own
// debounced refresh to correct for a structural edit elsewhere in the
// document (e.g. a rail action on a different scene) while a scene is
// being viewed. Ordinary typing inside the viewed scene is already kept
// correct synchronously by cold-storage-view.js's own field update, so this
// is a periodic safety net, not the primary mechanism — it must never move
// the cursor/scroll, or every debounce tick while viewing a scene would
// visibly jerk the view around.
export function syncColdStorageView(view, from, to) {
  const current = view.state.field(coldStorageViewField);
  if (!current || (current.from === from && current.to === to)) return;
  view.dispatch({ effects: setColdStorageViewEffect.of({ from, to }) });
}

export function setEditorMode(view, isEditor) {
  setEditorModeField(view, isEditor);
}

export function cursorToEnd(view) {
  const end = view.state.doc.length;
  view.dispatch({
    selection: { anchor: end, head: end },
    effects: EditorView.scrollIntoView(end, { y: 'center' }),
  });
}
