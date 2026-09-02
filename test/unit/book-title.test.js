import test from 'node:test';
import assert from 'node:assert/strict';
import { readBookTitle, bookTitleLine, positionAfterBookTitle } from '../../src/editor/book-title.js';
import { makeView } from './helpers/make-view.js';

test('reads only the dedicated first-line book title record', () => {
  assert.equal(readBookTitle('<!-- BOOK TITLE: Winter House -->\n\n# Chapter One'), 'Winter House');
  assert.equal(readBookTitle('# Chapter One\n\nProse'), '');
  assert.equal(readBookTitle('\n<!-- BOOK TITLE: Too late -->'), '');
});

test('serializes a trimmed book title without allowing a comment terminator', () => {
  assert.equal(bookTitleLine('  Winter House  '), '<!-- BOOK TITLE: Winter House -->');
  assert.equal(bookTitleLine('A --> B'), '<!-- BOOK TITLE: A —> B -->');
});

test('restored cursors inside title metadata are redirected to manuscript content', () => {
  const view = makeView('<!-- BOOK TITLE: Winter House -->\n\n# Chapter One');
  assert.equal(positionAfterBookTitle(view.state.doc), view.state.doc.line(3).from);
});
