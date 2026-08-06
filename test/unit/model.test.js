import test from 'node:test';
import assert from 'node:assert/strict';
import { getOutline } from '../../src/editor/outline.js';
import { getManuscript, findActiveScene } from '../../src/features/scene-nav/model.js';
import { makeView } from './helpers/make-view.js';

// model.js reaches through window.BaretextEditor — normally the editor
// bundle's global — so this stub wires it to the REAL outline.js (not a
// fake), keeping the test honest about what getOutline() actually returns.
globalThis.window = {
  BaretextEditor: {
    getOutline: (view) => getOutline(view),
    getDoc: (view) => view.state.doc.toString(),
  },
};

const LONG_ENOUGH = 'word '.repeat(25).trim(); // clears the 20-word draft threshold

test('groups chapters and scenes with correct numbering and titles', () => {
  const text = `# Chapter One\n\n${LONG_ENOUGH}\n\n---\n\n${LONG_ENOUGH}\n\n## A Titled Scene\n\n${LONG_ENOUGH}\n\n# Chapter Two\n\n${LONG_ENOUGH}`;
  const chapters = getManuscript(makeView(text));

  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, 'Chapter One');
  assert.equal(chapters[0].number, 1);
  assert.equal(chapters[0].type, 'h1');
  assert.equal(chapters[1].title, 'Chapter Two');
  assert.equal(chapters[1].number, 2);

  assert.equal(chapters[0].scenes.length, 3);
  assert.deepEqual(chapters[0].scenes.map((s) => s.title), ['Scene 1', 'Scene 2', 'A Titled Scene']);
  assert.deepEqual(chapters[0].scenes.map((s) => s.type), ['scene', 'scene', 'h2']);

  assert.equal(chapters[1].scenes.length, 1);
  assert.equal(chapters[1].scenes[0].title, 'Scene 1');
});

test('content before any heading becomes a synthesized chapter with a placeholder display title', () => {
  const text = `${LONG_ENOUGH}\n\n# Chapter Two\n\n${LONG_ENOUGH}`;
  const chapters = getManuscript(makeView(text));
  assert.equal(chapters[0].title, ''); // nothing real to prefill a rename with
  assert.equal(chapters[0].displayTitle, 'Chapter 1'); // placeholder shown in the UI only
  assert.equal(chapters[0].synthetic, true);
  assert.equal(chapters[0].number, 1);
  assert.equal(chapters[1].number, 2);
});

test('a real h1 heading with no title text yet gets a placeholder displayTitle', () => {
  const text = `# \n\n${LONG_ENOUGH}\n\n# Chapter Two\n\n${LONG_ENOUGH}`;
  const chapters = getManuscript(makeView(text));
  assert.equal(chapters[0].title, ''); // raw heading text really is empty
  assert.equal(chapters[0].displayTitle, 'Chapter 1');
  assert.equal(chapters[0].synthetic, undefined); // a real heading exists, unlike the no-heading-at-all case
  assert.equal(chapters[1].displayTitle, 'Chapter Two'); // a real title is never overridden
});

test('scenes under the draft word threshold are flagged isDraft', () => {
  const text = `# Chapter\n\nShort.\n\n---\n\n${LONG_ENOUGH}`;
  const chapters = getManuscript(makeView(text));
  assert.equal(chapters[0].scenes[0].isDraft, true);
  assert.equal(chapters[0].scenes[1].isDraft, false);
});

test('synopsis excludes the heading/marker line and truncates long prose', () => {
  const longProse = 'word '.repeat(40).trim(); // > 100 chars
  const text = `# Chapter\n\n## A Titled Scene\n\n${longProse}`;
  const chapters = getManuscript(makeView(text));
  const synopsis = chapters[0].scenes[0].synopsis;
  assert.ok(!synopsis.includes('A Titled Scene'));
  assert.ok(synopsis.endsWith('…'));
  assert.ok(synopsis.length <= 101);
});

test('short prose synopsis is not truncated and has no ellipsis', () => {
  const text = `# Chapter\n\nJust a short scene.`;
  const chapters = getManuscript(makeView(text));
  assert.equal(chapters[0].scenes[0].synopsis, 'Just a short scene.');
});

test('findActiveScene finds the scene containing the cursor', () => {
  const text = `# Chapter\n\n${LONG_ENOUGH}\n\n---\n\n${LONG_ENOUGH}`;
  const view = makeView(text);
  const chapters = getManuscript(view);
  const secondScenePos = chapters[0].scenes[1].pos;

  const hit = findActiveScene(chapters, secondScenePos + 2);
  assert.deepEqual(hit, { chapterIndex: 0, sceneIndex: 1, sceneId: chapters[0].scenes[1].id });
});

test('findActiveScene returns null for a position before any scene (on the heading itself)', () => {
  const text = `# Chapter\n\n${LONG_ENOUGH}`;
  const chapters = getManuscript(makeView(text));
  assert.equal(findActiveScene(chapters, 2), null); // inside "# Chapter"
});

test('findActiveScene treats a scene range as [pos, endPos) — the boundary belongs to the next scene', () => {
  const text = `# Chapter\n\n${LONG_ENOUGH}\n\n---\n\n${LONG_ENOUGH}`;
  const chapters = getManuscript(makeView(text));
  const firstScene = chapters[0].scenes[0];
  assert.equal(firstScene.endPos, chapters[0].scenes[1].pos);
  const hit = findActiveScene(chapters, firstScene.endPos);
  assert.equal(hit.sceneIndex, 1);
});
