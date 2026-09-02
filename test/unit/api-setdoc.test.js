import test from 'node:test';
import assert from 'node:assert/strict';
import { mapPosAcrossReplace } from '../../src/editor/cursor-map.js';
import { makeView } from './helpers/make-view.js';
import { history, undo } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';

// setDoc (api.js) is exercised end-to-end via its exported cursor-mapping
// logic here rather than by importing api.js itself -- api.js pulls in the
// full editor bundle, which isn't
// loadable under a plain Node test runner. dispatchSetDoc below reproduces
// setDoc's actual dispatch shape against a real EditorState (via makeView),
// so these tests still exercise the real CodeMirror selection-mapping
// pipeline, just without api.js's own module graph.
function dispatchSetDoc(view, text, { addToHistory = true } = {}) {
  const oldText = view.state.doc.toString();
  const newPos = mapPosAcrossReplace(oldText, text, view.state.selection.main.head);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: newPos },
    annotations: addToHistory ? undefined : Transaction.addToHistory.of(false),
  });
}

function moveCursor(view, pos) {
  view.dispatch({ selection: { anchor: pos } });
}

test('setDoc preserves the cursor when the edit lands after it (e.g. appending a new chapter)', () => {
  const oldDoc = '# Part 1\n\nScene one text.\n\n# Part 2\n\nScene two text.\n';
  const view = makeView(oldDoc);
  const cursorPos = oldDoc.length; // end of chapter 2, as if the writer had just finished typing there
  moveCursor(view, cursorPos);

  dispatchSetDoc(view, oldDoc + '\n# \n'); // scene-nav's addNewChapter appends a blank chapter

  assert.equal(view.state.selection.main.head, cursorPos);
});

test('setDoc preserves the cursor when the edit is entirely before it', () => {
  const oldDoc = '# Part 1\n\nFirst.\n\n# Part 2\n\nSecond.\n';
  const view = makeView(oldDoc);
  const cursorPos = oldDoc.indexOf('Second.');
  moveCursor(view, cursorPos);

  // Reordering chapters, deleting an earlier scene, etc. all rewrite the
  // document from scratch but leave text after the cursor's chapter intact.
  const newDoc = '# Part 0\n\nInserted earlier.\n\n' + oldDoc;
  dispatchSetDoc(view, newDoc);

  assert.equal(view.state.selection.main.head, newDoc.indexOf('Second.'));
});

test('setDoc clamps the cursor to just before a span that was itself rewritten', () => {
  const oldDoc = '# Part 1\n\nFirst.\n\n# Part 2\n\nSecond.\n';
  const view = makeView(oldDoc);
  const cursorPos = oldDoc.indexOf('Second.') + 3; // inside the deleted chapter
  moveCursor(view, cursorPos);

  // Deleting chapter 2 entirely -- nothing faithful for the old position to
  // map to, so it should land right at the boundary instead of resetting to 0.
  const newDoc = '# Part 1\n\nFirst.\n';
  dispatchSetDoc(view, newDoc);

  assert.equal(view.state.selection.main.head, newDoc.length);
});

test('a loaded manuscript is never an undo step back to the initial empty editor', () => {
  const view = makeView('', [history()]);
  const manuscript = '# Part 1\n\nThe manuscript.\n';
  dispatchSetDoc(view, manuscript, { addToHistory: false });

  // A later real edit remains undoable.
  view.dispatch({ changes: { from: manuscript.length, insert: 'A new line.\n' } });
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), manuscript);

  // There is no second undo into the pre-load empty buffer.
  assert.equal(undo(view), false);
  assert.equal(view.state.doc.toString(), manuscript);
});
