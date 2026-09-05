import test from 'node:test';
import assert from 'node:assert/strict';
import { renameTitle } from '../../src/features/scene-nav/rename.js';
import { makeView } from './helpers/make-view.js';

test('renames an h1 chapter heading in place', () => {
  const text = '# Old Title\n\nSome prose.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('# Old Title'), type: 'h1' }, 'New Title');
  assert.equal(view.state.doc.toString(), '# New Title\n\nSome prose.');
});

test('renames an h2 titled scene heading in place', () => {
  const text = '# Chapter\n\n## Old Scene\n\nProse.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('## Old Scene'), type: 'h2' }, 'New Scene');
  assert.equal(view.state.doc.toString(), '# Chapter\n\n## New Scene\n\nProse.');
});

test('renames an h3 titled scene heading in place', () => {
  const text = '# Chapter\n\n### Old Scene\n\nProse.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('### Old Scene'), type: 'h3' }, 'New Scene');
  assert.equal(view.state.doc.toString(), '# Chapter\n\n### New Scene\n\nProse.');
});

// A bare scene's name is a navigation waypoint, not manuscript content -- it
// must never turn into a real heading (that both deletes the scene-break
// symbol and puts new prose-level text in front of the reader). It's stored
// as an HTML comment right after the marker, invisible in rendered output.
test('names a bare marker-line scene via a hidden comment, keeping the --- intact', () => {
  const text = '# Chapter\n\nFirst.\n\n---\n\nSecond.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('---'), type: 'scene' }, 'Confrontation');
  assert.equal(view.state.doc.toString(), '# Chapter\n\nFirst.\n\n---\n<!-- Confrontation -->\n\nSecond.');
  assert.ok(view.state.doc.toString().includes('---'), 'the scene-break symbol must survive');
  assert.ok(!/^##? /m.test(view.state.doc.toString().split('---\n<!--')[1] || ''), 'must not become a heading');
});

test('re-naming an already-named marker scene replaces the comment in place, no duplicate', () => {
  const text = '# Chapter\n\nFirst.\n\n---\n<!-- Confrontation -->\n\nSecond.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('---'), type: 'scene' }, 'Confrontation Redux');
  assert.equal(view.state.doc.toString(), '# Chapter\n\nFirst.\n\n---\n<!-- Confrontation Redux -->\n\nSecond.');
});

test('names an implicit first-content scene (no marker at all) via a hidden comment, not a heading', () => {
  const text = '# Chapter\n\nOpening prose with no marker before it.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('Opening prose'), type: 'scene' }, 'The Beginning');
  assert.equal(
    view.state.doc.toString(),
    '# Chapter\n\n<!-- The Beginning -->\n\nOpening prose with no marker before it.'
  );
});

test('re-naming an already-named implicit first scene replaces the comment in place', () => {
  const text = '# Chapter\n\n<!-- The Beginning -->\n\nOpening prose with no marker before it.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('Opening prose'), type: 'scene' }, 'A New Start');
  assert.equal(
    view.state.doc.toString(),
    '# Chapter\n\n<!-- A New Start -->\n\nOpening prose with no marker before it.'
  );
});

test('naming the first Cold Storage scene preserves the structural Cold Storage marker', () => {
  const text = '# Chapter\n\nMain manuscript prose.\n\n<!-- COLD STORAGE -->\n\nParked prose.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('Parked prose'), type: 'scene' }, 'Cut opening');
  assert.equal(
    view.state.doc.toString(),
    '# Chapter\n\nMain manuscript prose.\n\n<!-- COLD STORAGE -->\n\n<!-- Cut opening -->\n\nParked prose.'
  );
});

test('clearing a named marker-line scene to blank removes the comment entirely, not just empties it', () => {
  const text = '# Chapter\n\nFirst.\n\n---\n<!-- Confrontation -->\n\nSecond.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('---'), type: 'scene' }, '   ');
  // Must land back on the ordinary unnamed "---\n\n" shape -- an empty
  // `<!-- -->` would still parse as a (blank-named) named scene.
  assert.equal(view.state.doc.toString(), '# Chapter\n\nFirst.\n\n---\n\nSecond.');
});

test('clearing an unnamed marker-line scene to blank is a no-op (nothing to remove)', () => {
  const text = '# Chapter\n\nFirst.\n\n---\n\nSecond.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('---'), type: 'scene' }, '   ');
  assert.equal(view.state.doc.toString(), text);
});

test('clearing a named implicit first scene to blank removes the comment and its spacing', () => {
  const text = '# Chapter\n\n<!-- The Beginning -->\n\nOpening prose with no marker before it.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('Opening prose'), type: 'scene' }, '   ');
  assert.equal(view.state.doc.toString(), '# Chapter\n\nOpening prose with no marker before it.');
});

test('inserts a real heading for the synthesized Untitled chapter', () => {
  const text = 'Prose before any heading exists.\n\n# Chapter Two\n\nMore.';
  const view = makeView(text);
  renameTitle(view, { pos: 0, synthetic: true }, 'Chapter One');
  assert.equal(
    view.state.doc.toString(),
    '# Chapter One\n\nProse before any heading exists.\n\n# Chapter Two\n\nMore.'
  );
});

test('a blank or whitespace-only title clears a heading back to untitled, not a no-op', () => {
  const text = '# Old Title\n\nSome prose.';
  const view = makeView(text);
  renameTitle(view, { pos: 0, type: 'h1' }, '   ');
  assert.equal(view.state.doc.toString(), '# \n\nSome prose.');
});

test('a blank title on the synthesized Untitled chapter is a genuine no-op (no heading line to clear)', () => {
  const text = 'Prose before any heading exists.';
  const view = makeView(text);
  renameTitle(view, { pos: 0, synthetic: true }, '   ');
  assert.equal(view.state.doc.toString(), text);
});

test('trims surrounding whitespace from the new title', () => {
  const text = '# Old Title\n\nSome prose.';
  const view = makeView(text);
  renameTitle(view, { pos: 0, type: 'h1' }, '  Spaced Title  ');
  assert.equal(view.state.doc.toString(), '# Spaced Title\n\nSome prose.');
});
