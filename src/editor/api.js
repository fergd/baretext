import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { EditorState, Transaction, EditorSelection, ChangeSet } from '@codemirror/state';
import { theme, injectSelectionFix, injectHeadingColors } from './theme.js';
import { markdownExtensions } from './markdown-language.js';
import { livePreviewPlugin, injectLivePreviewStyle } from './live-preview.js';
import { sceneBreakDecorator, sceneBreakAtomicRanges, sceneBreakClickGuard, injectSceneBreakStyle } from './scene-breaks.js';
import { blockSpacingPlugin, injectBlockSpacingStyle } from './block-spacing.js';
import { historyAndKeymaps, boldItalicKeymap } from './history-commands.js';
import { searchExtension, injectSearchMatchStyle } from './search.js';
import { emDashInputHandler } from './em-dash.js';
import { chapterPlaceholderPlugin, injectChapterPlaceholderStyle } from './chapter-placeholder.js';
import { manuscriptGutterPlugin, manuscriptGutterAlignPlugin, manuscriptGutterActivePlugin, injectManuscriptGutterStyle } from './manuscript-gutter.js';
import { editorModeField, setEditorMode as setEditorModeField } from './mode-state.js';
import { coldStorageViewField, coldStorageHideField, setColdStorageViewEffect } from './cold-storage-view.js';
import { bookTitlePlugin, bookTitleAtomicRange, bookTitleClickGuard, positionAfterBookTitle, injectBookTitleStyle } from './book-title.js';
import { openingCapsDecorator, injectOpeningCapsStyle } from './opening-caps.js';
import { documentChanges } from './document-changes.js';
import { outlineState, getStableOutline } from './outline-state.js';
import { structuralEdit } from './transaction-types.js';
import { sceneBoundaryGuardKeymap } from './scene-boundary-guard.js';
import { sceneLinkMetadata, preserveSceneLinks } from './scene-links.js';

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
  injectLivePreviewStyle();
  injectSceneBreakStyle();
  injectBlockSpacingStyle();
  injectSearchMatchStyle();
  injectChapterPlaceholderStyle();
  injectManuscriptGutterStyle();
  injectBookTitleStyle();
  injectOpeningCapsStyle();

  const listeners = new Set();
  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: initialDoc || '',
      extensions: [
        ...historyAndKeymaps(),
        EditorView.lineWrapping,
        // Takes over cursor rendering from the browser's native caret with
        // CodeMirror's own decorated one -- needed so the CRT theme's block
        // cursor (see index.html) can actually change the caret's WIDTH,
        // not just its color. Native carets have no cross-browser way to
        // do that (the standards-track `caret-shape` property isn't
        // supported by this Electron's bundled Chromium yet, confirmed
        // live). theme.js's own `.cm-cursor` rule already existed for
        // this before drawSelection() was ever enabled -- it was dead CSS
        // targeting an element CodeMirror never rendered, matching the
        // native caret's thin-bar look closely enough that every other
        // theme should look unchanged now that it's real.
        drawSelection(),
        editorModeField,
        outlineState,
        livePreviewPlugin,
        bookTitlePlugin,
        sceneLinkMetadata,
        preserveSceneLinks,
        bookTitleAtomicRange,
        bookTitleClickGuard,
        sceneBreakDecorator,
        sceneBreakAtomicRanges,
        sceneBreakClickGuard(),
        openingCapsDecorator,
        blockSpacingPlugin,
        chapterPlaceholderPlugin,
        manuscriptGutterPlugin,
        manuscriptGutterAlignPlugin,
        manuscriptGutterActivePlugin,
        coldStorageViewField,
        coldStorageHideField,
        searchExtension,
        boldItalicKeymap(),
        sceneBoundaryGuardKeymap(),
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
          for (const listener of listeners) listener(update);
          if (update.docChanged && !suppressed && onChange) onChange(view.state.doc.toString());
        }),
      ],
    }),
  });

  view._listeners = listeners;
  view._setSuppressed = (value) => { suppressed = value; };
  return view;
}

export function getDoc(view) {
  return view.state.doc.toString();
}

// File loads replace the buffer; manuscript edits apply only changed ranges.
export function setDoc(view, text, { addToHistory = true } = {}) {
  const newText = text || '';
  const oldText = view.state.doc.toString();
  if (oldText === newText) return;
  const changes = ChangeSet.of(addToHistory ? documentChanges(oldText, newText) : [{ from: 0, to: oldText.length, insert: newText }], oldText.length);
  const newState = view.state.update({ changes, annotations: structuralEdit.of(true) }).state;
  const beforeOutline = getStableOutline(view);
  const afterOutline = getStableOutline({ state: newState });
  const mapAnchor = pos => {
    const owner = beforeOutline.findLast(item => item.pos <= pos);
    const target = owner && afterOutline.find(item => item.stableId === owner.stableId);
    if (target && owner.signature === target.signature) return Math.min(newText.length, target.pos + pos - owner.pos);
    if (target && owner.identityKey === target.identityKey) {
      const line = view.state.doc.lineAt(pos);
      const targetEnd = afterOutline[afterOutline.indexOf(target) + 1]?.pos ?? newText.length;
      const body = newText.slice(target.pos, targetEnd);
      const offset = body.indexOf(line.text);
      if (line.text && offset >= 0 && body.indexOf(line.text, offset + 1) < 0)
        return target.pos + offset + pos - line.from;
    }
    return changes.mapPos(pos, 1);
  };
  const selection = EditorSelection.create(view.state.selection.ranges.map(range =>
    EditorSelection.range(mapAnchor(range.anchor), mapAnchor(range.head))), view.state.selection.mainIndex);
  view._setSuppressed(true);
  try {
    view.dispatch({ changes, selection, effects: view.scrollSnapshot().map(changes),
      annotations: [structuralEdit.of(true), isolateHistory.of("full"), Transaction.addToHistory.of(addToHistory)],
    });
  } finally { view._setSuppressed(false); }
}

// Make the target visible before calling. One jump owns selection and scroll.
export function navigate(view, pos, { align = 'center', scrollPos = pos, effects = [] } = {}) {
  const max = view.state.doc.length;
  let anchor = Math.max(0, Math.min(pos, max));
  const safeBookPos = positionAfterBookTitle(view.state.doc);
  if (safeBookPos !== null && anchor <= view.state.doc.line(1).to) anchor = safeBookPos;
  view.focus();
  view.dispatch({ selection: { anchor }, effects: [...effects,
    EditorView.scrollIntoView(align === 'center' ? anchor : Math.max(0, Math.min(scrollPos, max)), { y: align, yMargin: 24 }),
  ] });
}

export function subscribe(view, listener) {
  view._listeners.add(listener);
  return () => view._listeners.delete(listener);
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
export function scrollToTop(view, targetPos) {
  const pos = typeof targetPos === 'number' ? targetPos : view.state.selection.main.head;
  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }) });
}

export function getCursorPos(view) {
  return view.state.selection.main.head;
}

export function hasSelection(view) {
  return !view.state.selection.main.empty;
}

export function setCursorPos(view, pos) {
  navigate(view, pos);
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
export function exitColdStorageScene(view, restorePos, { restore = true } = {}) {
  if (!restore) { view.dispatch({ effects: setColdStorageViewEffect.of(null) }); return; }
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
