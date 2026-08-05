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

test('promotes a bare marker-line scene to a real h2 heading', () => {
  const text = '# Chapter\n\nFirst.\n\n---\n\nSecond.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('---'), type: 'scene' }, 'Confrontation');
  assert.equal(view.state.doc.toString(), '# Chapter\n\nFirst.\n\n## Confrontation\n\nSecond.');
});

test('promotes an implicit first-content scene (no marker at all) to a heading', () => {
  const text = '# Chapter\n\nOpening prose with no marker before it.';
  const view = makeView(text);
  renameTitle(view, { pos: text.indexOf('Opening prose'), type: 'scene' }, 'The Beginning');
  assert.equal(
    view.state.doc.toString(),
    '# Chapter\n\n## The Beginning\n\nOpening prose with no marker before it.'
  );
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

test('a blank or whitespace-only title is a no-op', () => {
  const text = '# Old Title\n\nSome prose.';
  const view = makeView(text);
  renameTitle(view, { pos: 0, type: 'h1' }, '   ');
  assert.equal(view.state.doc.toString(), text);
});

test('trims surrounding whitespace from the new title', () => {
  const text = '# Old Title\n\nSome prose.';
  const view = makeView(text);
  renameTitle(view, { pos: 0, type: 'h1' }, '  Spaced Title  ');
  assert.equal(view.state.doc.toString(), '# Spaced Title\n\nSome prose.');
});
