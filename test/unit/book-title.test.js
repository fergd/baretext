import test from 'node:test';
import assert from 'node:assert/strict';
import { readBookTitle, bookTitleLine } from '../../src/editor/book-title.js';

test('reads only the dedicated first-line book title record', () => {
  assert.equal(readBookTitle('<!-- BOOK TITLE: Winter House -->\n\n# Chapter One'), 'Winter House');
  assert.equal(readBookTitle('# Chapter One\n\nProse'), '');
  assert.equal(readBookTitle('\n<!-- BOOK TITLE: Too late -->'), '');
});

test('serializes a trimmed book title without allowing a comment terminator', () => {
  assert.equal(bookTitleLine('  Winter House  '), '<!-- BOOK TITLE: Winter House -->');
  assert.equal(bookTitleLine('A --> B'), '<!-- BOOK TITLE: A —> B -->');
});
