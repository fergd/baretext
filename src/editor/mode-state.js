import { StateField, StateEffect } from '@codemirror/state';

// Tracks the app's Sprinter/Editor mode (driven by app.js, which is the
// source of truth via data-mode on <html>) as editor state, so decoration
// plugins that render differently per mode (chapter-placeholder.js,
// scene-breaks.js) can react to a mode switch even when it happens without
// a document change. Mirrors live-preview.js's renderedModeField exactly.
export const setEditorModeEffect = StateEffect.define();

export const editorModeField = StateField.define({
  create: () => document.documentElement.dataset.mode === 'editor',
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEditorModeEffect)) return effect.value;
    }
    return value;
  },
});

export function setEditorMode(view, isEditor) {
  view.dispatch({ effects: setEditorModeEffect.of(isEditor) });
}
