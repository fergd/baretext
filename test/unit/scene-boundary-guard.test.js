import test from 'node:test';
import assert from 'node:assert/strict';
import { wouldCrossBoundary } from '../../src/editor/scene-boundary-guard.js';
import { makeView } from './helpers/make-view.js';

function moveCursor(view, pos) {
  view.dispatch({ selection: { anchor: pos } });
}

test('blocks at the very start of a chapter heading (deleting into the "#" itself)', () => {
  const doc = '# One\n\nFirst.\n\n# Two\n\nSecond.';
  const view = makeView(doc);
  moveCursor(view, doc.indexOf('# Two'));
  assert.equal(wouldCrossBoundary(view), true);
});

test('blocks right after a heading\'s "# " prefix, before any title text', () => {
  const doc = '# One\n\nFirst.\n\n# \n\nSecond.'; // an untitled chapter -- cursor right after "# "
  const view = makeView(doc);
  moveCursor(view, doc.indexOf('# \n') + 2);
  assert.equal(wouldCrossBoundary(view), true);
});

test('allows a normal backspace in the middle of a chapter title', () => {
  const doc = '# One\n\nFirst.\n\n# Two\n\nSecond.';
  const view = makeView(doc);
  moveCursor(view, doc.indexOf('Two') + 2); // between "Tw" and "o"
  assert.equal(wouldCrossBoundary(view), false);
});

test('blocks at the start of a scene\'s content, right after an explicit --- marker', () => {
  const doc = '# One\n\nFirst.\n\n---\n\nSecond.';
  const view = makeView(doc);
  moveCursor(view, doc.indexOf('Second.'));
  assert.equal(wouldCrossBoundary(view), true);
});

test('blocks at the start of a named scene\'s content, right after the marker + waypoint comment', () => {
  const doc = '# One\n\nFirst.\n\n---\n<!-- Confrontation -->\n\nSecond.';
  const view = makeView(doc);
  moveCursor(view, doc.indexOf('Second.'));
  assert.equal(wouldCrossBoundary(view), true);
});

test('blocks anywhere inside the marker/preamble region, not just exactly at its edges', () => {
  const doc = '# One\n\nFirst.\n\n---\n\nSecond.';
  const view = makeView(doc);
  const markerPos = doc.indexOf('---');
  moveCursor(view, markerPos + 1); // inside the dashes themselves
  assert.equal(wouldCrossBoundary(view), true);
});

test('allows a normal backspace in the middle of scene prose', () => {
  const doc = '# One\n\nFirst.\n\n---\n\nSecond scene prose.';
  const view = makeView(doc);
  moveCursor(view, doc.indexOf('scene'));
  assert.equal(wouldCrossBoundary(view), false);
});

test('blocks at the start of an implicit first scene (no marker -- content IS the boundary)', () => {
  const doc = '# One\n\nFirst prose here.';
  const view = makeView(doc);
  moveCursor(view, doc.indexOf('First'));
  assert.equal(wouldCrossBoundary(view), true);
});

test('blocks at the marker of a still-empty draft scene (nothing typed into it yet)', () => {
  const doc = '# One\n\nFirst.\n\n# Two\n\n---\n\n'; // a freshly added chapter+blank-scene, e.g. from "New Chapter"
  const view = makeView(doc);
  moveCursor(view, doc.lastIndexOf('---'));
  assert.equal(wouldCrossBoundary(view), true);
});

test('never blocks at document position 0 -- nothing to delete there anyway', () => {
  const doc = '# One\n\nFirst.';
  const view = makeView(doc);
  moveCursor(view, 0);
  assert.equal(wouldCrossBoundary(view), false);
});

test('does not guard an active (non-collapsed) selection', () => {
  const doc = '# One\n\nFirst.\n\n# Two\n\nSecond.';
  const view = makeView(doc);
  view.dispatch({ selection: { anchor: doc.indexOf('First'), head: doc.indexOf('# Two') + 2 } });
  assert.equal(wouldCrossBoundary(view), false);
});
