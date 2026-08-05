// A minimal stand-in for a CodeMirror EditorView, backed by a real
// EditorState — every editor/*.js module under test only ever touches
// `view.state` and `view.dispatch(spec)`, both of which are real CodeMirror
// behavior here (not mocked), so these tests exercise the actual state/
// transaction pipeline the app runs in production. `view.focus()` is a
// harmless no-op since there's no real DOM to focus.
import { EditorState } from '@codemirror/state';

export function makeView(doc, extensions = []) {
  let state = EditorState.create({ doc, extensions });
  return {
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
    focus() {},
  };
}
