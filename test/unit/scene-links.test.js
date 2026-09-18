import test from 'node:test';
import assert from 'node:assert/strict';
import { getOutline } from '../../src/editor/outline.js';
import { getManuscript } from '../../src/features/scene-nav/model.js';
import { toggleSceneLink, linkScenes, unlinkScene, reorderScenes, deleteScene, reorderChapters } from '../../src/features/scene-nav/reorder.js';
import { makeView } from './helpers/make-view.js';

globalThis.window = { BaretextEditor: { getOutline, getDoc: v => v.state.doc.toString() } };
const parse = text => getManuscript(makeView(text));
const fixture = '<!-- BOOK TITLE: Test -->\n\n# One\n\n## A\n\nAlpha.\n\n---\n<!-- B -->\n\nBeta.\n\n### C\n\nGamma.\n\n# Two\n\n## D\n\nDelta.\n';
const link = (doc, ci, si) => toggleSceneLink(parse(doc), { chapterIndex: ci, sceneIndex: si });
const titles = doc => parse(doc).map(c => c.scenes.map(s => s.title));
const move = (doc, si, ci, to) => reorderScenes(parse(doc), { fromChapterIndex: 0, fromSceneIndex: si, toChapterIndex: ci, toSceneIndex: to });

test('links round-trip without changing scene names, prose, synopsis or word counts', () => {
  const doc = link(fixture, 0, 0);
  assert.ok(doc.includes('<!-- SCENE LINK -->'));
  assert.deepEqual(titles(doc), titles(fixture));
  assert.equal(parse(doc).bookTitle, 'Test');
  assert.equal(parse(doc)[0].scenes[0].linkedNext, true);
  assert.deepEqual(parse(doc)[0].scenes.map(s => [s.synopsis, s.wordCount]), parse(fixture)[0].scenes.map(s => [s.synopsis, s.wordCount]));
  assert.equal(link(doc, 0, 0), fixture);
});

test('dragging either group member moves the ordered pair across chapters', () => {
  const doc = link(fixture, 0, 0);
  for (const si of [0, 1]) {
    const moved = move(doc, si, 1, 1);
    assert.deepEqual(titles(moved), [['C'], ['D', 'A', 'B'], []]);
    assert.deepEqual(parse(moved)[1].scenes.map(s => s.linkedNext), [false, true, false]);
  }
});

test('continuing to write after hidden metadata preserves the link and all new prose', () => {
  const doc = link(fixture, 0, 0).replace('<!-- SCENE LINK -->', '<!-- SCENE LINK -->\n\nMore prose.');
  const moved = move(doc, 1, 1, 1);
  assert.deepEqual(titles(moved), [['C'], ['D', 'A', 'B'], []]);
  assert.ok(moved.includes('Alpha.\n\nMore prose.'));
  assert.equal((moved.match(/<!-- SCENE LINK -->/g) || []).length, 1);
});

test('forward/backward moves keep the pair intact, and drops inside it are harmless', () => {
  const doc = link(fixture, 0, 0);
  assert.deepEqual(titles(move(doc, 1, 0, 3))[0], ['C', 'A', 'B']);
  assert.deepEqual(titles(move(doc, 2, 0, 1))[0], ['C', 'A', 'B']);
  assert.equal(move(doc, 1, 0, 1), doc);
  const moved = move(doc, 0, 0, 3);
  assert.equal(reorderScenes(parse(moved), { fromChapterIndex: 0, fromSceneIndex: 2, toChapterIndex: 0, toSceneIndex: 0 }), doc);
});

test('groups can grow and unlink at any boundary', () => {
  const doc = link(link(fixture, 0, 0), 0, 1);
  assert.deepEqual(titles(move(doc, 1, 1, 0)), [[], ['A', 'B', 'C', 'D'], []]);
  assert.deepEqual(titles(move(link(doc, 0, 0), 1, 1, 0)), [['A'], ['B', 'C', 'D'], []]);
  assert.equal(link(doc, 0, 2), null, 'last scene cannot link across chapters');
});

test('moving onto a different linked group never inserts between its members', () => {
  const doc = link(fixture + '\n---\n\nEcho.\n', 1, 0);
  assert.deepEqual(titles(move(doc, 0, 1, 1))[1], ['A', 'D', 'Scene 1']);
  assert.equal(parse(move(doc, 0, 1, 1))[1].scenes[1].linkedNext, true);
});

test('Cold Storage and chapter moves preserve links', () => {
  const doc = link(fixture, 0, 0);
  const parked = move(doc, 1, 2, 0);
  assert.deepEqual(titles(parked), [['C'], ['D'], ['A', 'B']]);
  assert.equal(parse(parked)[2].scenes[0].linkedNext, true);
  const swapped = reorderChapters(parse(doc), { fromIndex: 0, toIndex: 2 });
  assert.equal(parse(swapped)[1].scenes[0].linkedNext, true);
});

test('deleting a member removes only that scene and does not link unrelated neighbors', () => {
  const doc = link(fixture, 0, 0);
  const removed = deleteScene(parse(doc), { chapterIndex: 0, sceneIndex: 1 });
  assert.deepEqual(titles(removed)[0], ['A', 'C']);
  assert.equal(parse(removed)[0].scenes[0].linkedNext, false);
  const chain = link(doc, 0, 1);
  const middle = deleteScene(parse(chain), { chapterIndex: 0, sceneIndex: 1 });
  assert.equal(parse(middle)[0].scenes[0].linkedNext, true);
});

test('empty and implicit opening scenes remain real scenes after linking', () => {
  for (const content of ['# One\n\n---\n\n---\n\nText.\n', '# One\n\nOpening.\n\n---\n\nText.\n']) {
    const doc = link(content, 0, 0);
    assert.equal(parse(doc)[0].scenes.length, 2);
    assert.equal(parse(doc)[0].scenes[0].linkedNext, true);
    assert.ok(parse(doc)[0].scenes.every(s => !s.title.includes('SCENE LINK')));
    assert.equal(parse(link(doc, 0, 0))[0].scenes[0].linkedNext, false);
  }
});


test('selecting nonadjacent cards links only the chosen scenes without reordering', () => {
  const linked = linkScenes(parse(fixture), { chapterIndex: 0, sceneIndex: 0 }, { chapterIndex: 0, sceneIndex: 2 });
  assert.deepEqual(titles(linked), titles(fixture));
  const scenes = parse(linked)[0].scenes;
  assert.equal(scenes[0].groupId, scenes[2].groupId);
  assert.ok(scenes[0].groupId);
  assert.equal(scenes[1].groupId, null);
  assert.deepEqual(titles(move(linked, 2, 1, 1)), [['B'], ['D', 'A', 'C'], []]);
});

test('link selection crosses chapters, merges groups and unlink removes just one member', () => {
  const linked = linkScenes(parse(link(fixture, 0, 0)), { chapterIndex: 0, sceneIndex: 1 }, { chapterIndex: 1, sceneIndex: 0 });
  assert.deepEqual(titles(linked), titles(fixture));
  assert.deepEqual(titles(move(linked, 1, 0, 3)), [['C', 'A', 'B', 'D'], [], []]);
  const unlinked = unlinkScene(parse(linked), { chapterIndex: 0, sceneIndex: 1 });
  assert.equal(parse(unlinked)[0].scenes[1].groupId, null);
  assert.equal(parse(unlinked)[0].scenes[0].groupId, parse(unlinked)[1].scenes[0].groupId);
  assert.equal(linkScenes(parse(linked), {chapterIndex:0,sceneIndex:0}, {chapterIndex:1,sceneIndex:0}), null);
});

test('inserting a scene boundary keeps existing group metadata with the original scene', async () => {
  const { EditorState } = await import('@codemirror/state');
  const { preserveSceneLinks } = await import('../../src/editor/scene-links.js');
  const linked = linkScenes(parse(fixture), {chapterIndex:0,sceneIndex:0}, {chapterIndex:0,sceneIndex:2});
  for (const insert of ['\n\n---\n\nNew prose.', '\n\n## New scene\n\nNew prose.']) {
    const pos = linked.indexOf('Alpha.') + 'Alpha.'.length;
    const state = EditorState.create({doc:linked, extensions:[preserveSceneLinks]});
    const tr = state.update({changes:{from:pos,insert},selection:{anchor:pos+insert.length}});
    const scenes = parse(tr.newDoc.toString())[0].scenes;
    assert.equal(scenes.length,4);
    assert.ok(scenes[0].groupId);
    assert.equal(scenes[1].groupId,null);
    assert.equal(scenes[0].groupId,scenes[3].groupId);
    assert.ok(tr.newDoc.sliceString(tr.state.selection.main.head-10,tr.state.selection.main.head).includes('New prose.'));
    assert.equal((tr.newDoc.toString().match(/SCENE GROUP:/g)||[]).length,2);
  }
});
