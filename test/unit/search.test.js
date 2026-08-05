import test from 'node:test';
import assert from 'node:assert/strict';
import {
  searchExtension, setSearchQuery, findNext, findPrevious, replaceCurrent, replaceAll, clearSearch,
} from '../../src/editor/search.js';
import { makeView } from './helpers/make-view.js';

function view(doc) {
  return makeView(doc, [searchExtension]);
}

test('setSearchQuery finds matches and selects the first one', () => {
  const v = view('the cat sat on the mat');
  const result = setSearchQuery(v, 'the', { caseSensitive: false });
  assert.deepEqual(result, { count: 2, index: 1 });
  assert.equal(v.state.selection.main.from, 0);
});

test('search is case-insensitive by default', () => {
  const v = view('The Cat sat near the mat');
  const result = setSearchQuery(v, 'the', { caseSensitive: false });
  assert.equal(result.count, 2);
});

test('caseSensitive: true only matches exact case', () => {
  const v = view('The Cat sat near the mat');
  const result = setSearchQuery(v, 'the', { caseSensitive: true });
  assert.equal(result.count, 1);
});

test('an empty query yields zero matches', () => {
  const v = view('some text here');
  const result = setSearchQuery(v, '', { caseSensitive: false });
  assert.deepEqual(result, { count: 0, index: 0 });
});

test('findNext advances through matches and wraps around', () => {
  const v = view('a-a-a');
  setSearchQuery(v, 'a', { caseSensitive: false });
  assert.equal(findNext(v).index, 2);
  assert.equal(findNext(v).index, 3);
  assert.equal(findNext(v).index, 1); // wraps back to the first match
});

test('findPrevious moves backward and wraps around', () => {
  const v = view('a-a-a');
  setSearchQuery(v, 'a', { caseSensitive: false }); // starts at match 1
  assert.equal(findPrevious(v).index, 3); // wraps to the last match
  assert.equal(findPrevious(v).index, 2);
});

test('findNext on zero matches is a safe no-op', () => {
  const v = view('nothing matches here');
  setSearchQuery(v, 'xyz', { caseSensitive: false });
  assert.deepEqual(findNext(v), { count: 0, index: 0 });
});

test('replaceCurrent replaces only the current match and updates the count', () => {
  const v = view('cat cat cat');
  setSearchQuery(v, 'cat', { caseSensitive: false });
  const result = replaceCurrent(v, 'dog');
  assert.equal(v.state.doc.toString(), 'dog cat cat');
  assert.equal(result.count, 2); // two "cat" occurrences remain
});

test('replaceAll replaces every match and returns the count', () => {
  const v = view('cat cat cat');
  const count = replaceAll(v, 'cat', 'dog', { caseSensitive: false });
  assert.equal(count, 3);
  assert.equal(v.state.doc.toString(), 'dog dog dog');
});

test('replaceAll with no matches returns 0 and leaves the doc untouched', () => {
  const v = view('nothing to replace');
  const count = replaceAll(v, 'xyz', 'abc', { caseSensitive: false });
  assert.equal(count, 0);
  assert.equal(v.state.doc.toString(), 'nothing to replace');
});

test('clearSearch removes the active query so findNext reports zero matches', () => {
  const v = view('cat cat');
  setSearchQuery(v, 'cat', { caseSensitive: false });
  clearSearch(v);
  assert.deepEqual(findNext(v), { count: 0, index: 0 });
});

test('editing the document after a search recomputes matches', () => {
  const v = view('cat cat');
  setSearchQuery(v, 'cat', { caseSensitive: false });
  v.dispatch({ changes: { from: 0, to: 3, insert: 'dog' } });
  assert.equal(findNext(v).count, 1);
});
