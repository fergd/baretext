import test from 'node:test';
import assert from 'node:assert/strict';
import { insertSceneBreak } from '../../src/editor/scene-breaks.js';
import { makeView } from './helpers/make-view.js';

function moveCursor(view, pos) {
  view.dispatch({ selection: { anchor: pos } });
}

test('inserting on an empty line adds no extra leading blank line', () => {
  const view = makeView('# Chapter\n\n\nSome prose after.');
  moveCursor(view, 11); // the empty line between the heading and the prose
  insertSceneBreak(view);
  assert.equal(view.state.doc.toString(), '# Chapter\n\n---\n\n\nSome prose after.');
});

test('inserting mid-paragraph pads with a leading blank line first', () => {
  const view = makeView('# Chapter\n\nFirst paragraph of prose.');
  const pos = view.state.doc.toString().indexOf('First') + 5; // right after "First", mid-line
  moveCursor(view, pos);
  insertSceneBreak(view);
  assert.equal(view.state.doc.toString(), '# Chapter\n\nFirst\n\n---\n\n paragraph of prose.');
});

test('inserting at the very start of a line that has text still pads with a leading blank line', () => {
  const view = makeView('# Chapter\n\nProse line.');
  const pos = view.state.doc.toString().indexOf('Prose line.');
  moveCursor(view, pos); // at line start, but the line is NOT empty
  insertSceneBreak(view);
  assert.equal(view.state.doc.toString(), '# Chapter\n\n\n\n---\n\nProse line.');
});

test('replaces a real selection range, not just inserting at a point', () => {
  const view = makeView('# Chapter\n\nReplace this text please.');
  const from = view.state.doc.toString().indexOf('this text');
  const to = from + 'this text'.length;
  view.dispatch({ selection: { anchor: from, head: to } });
  insertSceneBreak(view);
  assert.equal(view.state.doc.toString(), '# Chapter\n\nReplace \n\n---\n\n please.');
});

test('leaves the cursor immediately after the inserted break', () => {
  const view = makeView('# Chapter\n\n\nProse.');
  moveCursor(view, 11);
  insertSceneBreak(view);
  const expectedInsert = '---\n\n';
  assert.equal(view.state.selection.main.head, 11 + expectedInsert.length);
});

test('returns true', () => {
  const view = makeView('\n');
  assert.equal(insertSceneBreak(view), true);
});
