import test from 'node:test';
import assert from 'node:assert/strict';
import { setDoc as dispatchSetDoc } from '../../src/editor/api.js';
import { outlineState } from '../../src/editor/outline-state.js';
import { EditorView } from '@codemirror/view';
import { makeView as baseView } from './helpers/make-view.js';
import { history, undo } from '@codemirror/commands';

// Exercise the production API against an EditorState; only viewport effects
// and the onChange suppression hook need substitutes without a browser.
function makeView(doc, extensions = []) {
  const view = baseView(doc, [outlineState, ...extensions]);
  view._setSuppressed = () => {};
  view.scrollSnapshot = () => EditorView.scrollIntoView(0);
  return view;
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
