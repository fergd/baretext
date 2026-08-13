import test from 'node:test';
import assert from 'node:assert/strict';
import { getOutline } from '../../src/editor/outline.js';
import { makeView } from './helpers/make-view.js';

function types(items) { return items.map((i) => i.type); }
function texts(items) { return items.map((i) => i.text); }

test('h1 heading followed by implicit first-content scene', () => {
  const view = makeView('# Chapter One\n\nSome opening prose.');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'scene']);
  assert.deepEqual(texts(items), ['Chapter One', 'Scene 1']);
});

test('explicit scene breaks increment scene numbering', () => {
  const view = makeView('# Chapter One\n\nFirst.\n\n---\n\nSecond.\n\n---\n\nThird.');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'scene', 'scene', 'scene']);
  assert.deepEqual(texts(items), ['Chapter One', 'Scene 1', 'Scene 2', 'Scene 3']);
});

test('*** and ___ are also recognized as scene breaks, but shorter runs are not', () => {
  const view = makeView('# Chapter\n\nA.\n\n***\n\nB.\n\n___\n\nC.\n\n--\n\nstill part of C');
  const items = getOutline(view);
  // -- (only 2 dashes) is not a valid scene break, so no 4th scene item.
  assert.deepEqual(types(items), ['h1', 'scene', 'scene', 'scene']);
});

// Regression: h2/h3 headings are themselves scene-level titles, so content
// right after one belongs to that heading — it must NOT also spawn a
// synthesized "Scene 1" sibling. This was a real bug (fixed this session)
// that only surfaced once scene-nav derived content ranges from getOutline().
test('content after an h2/h3 heading does not spawn a phantom Scene 1', () => {
  const view = makeView('# Chapter\n\n## A Titled Scene\n\nProse right after the heading.');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'h2']);
  assert.deepEqual(texts(items), ['Chapter', 'A Titled Scene']);
});

test('an h3 heading also suppresses the phantom first-scene', () => {
  const view = makeView('# Chapter\n\n### A Titled Scene\n\nProse.');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'h3']);
});

test('only h1 resets scene numbering and the awaiting-first-content flag', () => {
  const view = makeView(
    '# Chapter One\n\nA.\n\n---\n\nB.\n\n# Chapter Two\n\nC.\n\n---\n\nD.'
  );
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'scene', 'scene', 'h1', 'scene', 'scene']);
  assert.deepEqual(texts(items), ['Chapter One', 'Scene 1', 'Scene 2', 'Chapter Two', 'Scene 1', 'Scene 2']);
});

test('a mixed-boundary chapter: implicit first scene, explicit break, then a titled scene', () => {
  const view = makeView(
    '# Chapter\n\nImplicit opener.\n\n---\n\nExplicit break scene.\n\n## Titled Scene\n\nMore prose.'
  );
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'scene', 'scene', 'h2']);
  assert.deepEqual(texts(items), ['Chapter', 'Scene 1', 'Scene 2', 'Titled Scene']);
});

test('prose before any heading at all still gets an implicit Scene 1', () => {
  const view = makeView('Content with no heading above it.\n\n# Chapter Two\n\nMore.');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['scene', 'h1', 'scene']);
  assert.deepEqual(texts(items), ['Scene 1', 'Chapter Two', 'Scene 1']);
});

// CommonMark allows an ATX heading with no title at all — this matters here
// specifically because it's the most realistic real-world trigger for a
// "blank chapter": a user types "#" then a space and stops. The old regex
// (\s+(.+)) required a leftover non-whitespace-swallowed character after
// the separator, so this exact, extremely common case was invisible to the
// outline entirely (not even a heading item, let alone an empty-titled one).
test('a bare "#" with nothing after it is still a heading, with empty text', () => {
  const view = makeView('#');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1']);
  assert.equal(items[0].text, '');
});

test('"#" followed by just a space (title not typed yet) is a heading with empty text', () => {
  const view = makeView('# \n\nSome prose.');
  const items = getOutline(view);
  assert.equal(items[0].type, 'h1');
  assert.equal(items[0].text, '');
});

test('"##" alone is an empty h2, not swallowed as plain text', () => {
  const view = makeView('# Chapter\n\n##');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'h2']);
  assert.equal(items[1].text, '');
});

test('four or more #s is not a valid heading (still out of scope) — read as ordinary prose', () => {
  const view = makeView('#### Not a heading');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['scene']); // implicit first content, not a heading
});

test('an empty document produces no items', () => {
  const view = makeView('');
  assert.deepEqual(getOutline(view), []);
});

test('blank lines alone produce no items', () => {
  const view = makeView('\n\n\n');
  assert.deepEqual(getOutline(view), []);
});

test('pos and line fields point at the correct line', () => {
  const text = '# Chapter\n\nFirst.\n\n---\n\nSecond.';
  const view = makeView(text);
  const items = getOutline(view);
  const sceneBreakItem = items.find((i) => i.text === 'Scene 2');
  assert.equal(sceneBreakItem.line, 5);
  assert.equal(text.slice(sceneBreakItem.pos, sceneBreakItem.pos + 3), '---');
});

// A waypoint name comment immediately after a ---/***/___ marker (no blank
// line between them) names that scene instead of the auto "Scene N" — this
// is how a rail/corkboard rename is stored (see rename.js) without ever
// becoming real manuscript content.
test('a name comment right after a marker names that scene, still typed "scene" not a heading', () => {
  const view = makeView('# Chapter\n\nFirst.\n\n---\n<!-- Confrontation -->\n\nSecond.');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'scene', 'scene']);
  assert.deepEqual(texts(items), ['Chapter', 'Scene 1', 'Confrontation']);
  assert.equal(items[2].named, true);
});

test('a marker with the default blank-line spacing (no adjacent comment) is not treated as named', () => {
  const view = makeView('# Chapter\n\nFirst.\n\n---\n\nSecond.');
  const items = getOutline(view);
  assert.equal(items[2].named, false);
  assert.equal(items[2].text, 'Scene 2');
});

test('a name comment before a chapter\'s first real content names the implicit first scene', () => {
  const source = '# Chapter\n<!-- Opening Image -->\n\nFirst scene prose.';
  const view = makeView(source);
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'scene']);
  assert.equal(items[1].text, 'Opening Image');
  assert.equal(items[1].named, true);
  // pos lands on the real content line, past the comment -- so a jump goes
  // straight to the prose, and model.js's rawText slice naturally excludes
  // the comment from word count / synopsis without any extra filtering.
  assert.equal(source.slice(items[1].pos, items[1].pos + 5), 'First');
});

test('a name comment on its own does not itself count as the start of content', () => {
  const view = makeView('# Chapter\n<!-- Opening Image -->\n\n\n\nFirst scene prose.');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'scene']);
  assert.equal(items.length, 2); // not a third item for the comment line itself
});

test('a titled (h2/h3) scene ignores a preceding name comment -- headings are self-naming', () => {
  const view = makeView('# Chapter\n<!-- Ignored -->\n\n## Real Title\n\nProse.');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'h2']);
  assert.equal(items[1].text, 'Real Title');
});

test('the Cold Storage marker is its own item type, resetting scene numbering like an h1', () => {
  const view = makeView('# Chapter\n\nFirst.\n\n<!-- COLD STORAGE -->\n\nCut scene.\n\n---\n\nAnother cut scene.');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'scene', 'cold-storage', 'scene', 'scene']);
  assert.equal(items[2].text, 'Cold Storage');
  // Scene numbering restarted after the marker, same as it would after a
  // real h1 -- the two cut scenes are "Scene 1"/"Scene 2" of their own
  // section, not "Scene 2"/"Scene 3" continuing the chapter above.
  assert.equal(items[3].text, 'Scene 1');
  assert.equal(items[4].text, 'Scene 2');
});

test('a name comment right after the Cold Storage marker does not get mistaken for a scene name', () => {
  // The marker line itself must never be captured as a preceding scene's
  // own name comment -- it's a section boundary, not scene content.
  const view = makeView('# Chapter\n\nFirst.\n\n---\n\n<!-- COLD STORAGE -->\n\nCut scene.');
  const items = getOutline(view);
  assert.deepEqual(types(items), ['h1', 'scene', 'scene', 'cold-storage', 'scene']);
  assert.equal(items[2].named, false);
});
