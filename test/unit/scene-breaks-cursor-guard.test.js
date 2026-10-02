import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneBreakCursorGuard } from '../../src/editor/scene-breaks.js';
import { makeView } from './helpers/make-view.js';

// The caret must never rest at the very start of a hidden "---" marker
// line: it renders alone in the gap between scenes and typing there
// corrupts the next scene's marker.
const doc = [
  '# Chapter',
  '',
  'Last paragraph of scene one.',
  '',
  '---',
  '<!-- Journal -->',
  '',
  'First paragraph of scene two.',
].join('\n');
const markerPos = doc.indexOf('---');
const blankBeforeMarker = markerPos - 1;
const sceneTwoStart = doc.indexOf('First paragraph');

test('moving forward onto a marker start lands on the next scene\'s first prose line', () => {
  const view = makeView(doc, [sceneBreakCursorGuard]);
  view.dispatch({ selection: { anchor: blankBeforeMarker } });
  view.dispatch({ selection: { anchor: markerPos } });
  assert.equal(view.state.selection.main.head, sceneTwoStart);
});

test('moving backward onto a marker start lands on the line before the marker', () => {
  const view = makeView(doc, [sceneBreakCursorGuard]);
  view.dispatch({ selection: { anchor: sceneTwoStart } });
  view.dispatch({ selection: { anchor: markerPos } });
  assert.equal(view.state.selection.main.head, blankBeforeMarker);
});

test('typing after a relocation never edits the marker line', () => {
  const view = makeView(doc, [sceneBreakCursorGuard]);
  view.dispatch({ selection: { anchor: markerPos } });
  const at = view.state.selection.main.head;
  view.dispatch({ changes: { from: at, insert: 'x' }, selection: { anchor: at + 1 } });
  assert.ok(view.state.doc.toString().includes('\n---\n<!-- Journal -->\n'));
});

test('a deletion that pulls the marker under the caret moves the caret off it', () => {
  const view = makeView(doc, [sceneBreakCursorGuard]);
  view.dispatch({ selection: { anchor: blankBeforeMarker } });
  // Delete-forward on the blank line: removes its newline, marker now starts at the caret.
  view.dispatch({ changes: { from: blankBeforeMarker, to: blankBeforeMarker + 1 } });
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  assert.notEqual(line.text, '---');
});

test('an unnamed marker with an empty scene after it lands just past the marker', () => {
  const d = 'Prose.\n\n---\n';
  const view = makeView(d, [sceneBreakCursorGuard]);
  view.dispatch({ selection: { anchor: d.indexOf('---') } });
  assert.equal(view.state.selection.main.head, d.length);
});

test('selections that span a marker are left alone', () => {
  const view = makeView(doc, [sceneBreakCursorGuard]);
  view.dispatch({ selection: { anchor: markerPos, head: sceneTwoStart } });
  assert.equal(view.state.selection.main.anchor, markerPos);
});

test('ordinary cursor placement is untouched', () => {
  const view = makeView(doc, [sceneBreakCursorGuard]);
  view.dispatch({ selection: { anchor: 5 } });
  assert.equal(view.state.selection.main.head, 5);
});
