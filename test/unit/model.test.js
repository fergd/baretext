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

  // getManuscript() always appends a trailing Cold Storage entry (see
  // model.js) — 2 real chapters here, +1 for it, even though the doc has
  // no Cold Storage content of its own.
  assert.equal(chapters.length, 3);
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

test('scene navigation keeps the boundary position but targets the first prose line for the caret', () => {
  const text = '# Chapter\n\n## Visible Scene Title\n\nFirst prose line.\n\n---\n<!-- Named Marker Scene -->\n\nMarker prose line.';
  const chapters = getManuscript(makeView(text));
  const [headingScene, markerScene] = chapters[0].scenes;

  assert.equal(text.slice(headingScene.pos).startsWith('## Visible Scene Title'), true);
  assert.equal(text.slice(headingScene.contentPos).startsWith('First prose line.'), true);
  assert.equal(text.slice(markerScene.pos).startsWith('---'), true);
  assert.equal(text.slice(markerScene.contentPos).startsWith('Marker prose line.'), true);
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

// ── Cold Storage ────────────────────────────────────────────────────────

test('a document with no Cold Storage section still gets an empty, present bucket for it, always last', () => {
  const text = `# Chapter One\n\n${LONG_ENOUGH}`;
  const chapters = getManuscript(makeView(text));
  const last = chapters[chapters.length - 1];
  assert.equal(last.coldStorage, true);
  assert.equal(last.scenes.length, 0);
});

test('scenes after the Cold Storage marker are bucketed separately, not counted as a chapter', () => {
  const text = `# Chapter One\n\n${LONG_ENOUGH}\n\n# Chapter Two\n\n${LONG_ENOUGH}\n\n<!-- COLD STORAGE -->\n\n${LONG_ENOUGH}\n\n---\n\n${LONG_ENOUGH}`;
  const chapters = getManuscript(makeView(text));

  // Still exactly 2 real chapters — Cold Storage doesn't consume a chapter
  // number or slot in the numbered list.
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].number, 1);
  assert.equal(chapters[1].number, 2);

  const coldStorage = chapters[2];
  assert.equal(coldStorage.coldStorage, true);
  assert.equal(coldStorage.scenes.length, 2);
  assert.deepEqual(coldStorage.scenes.map((s) => s.title), ['Scene 1', 'Scene 2']);
});

test('a scene inside Cold Storage is found by findActiveScene like any other scene', () => {
  const text = `# Chapter\n\n${LONG_ENOUGH}\n\n<!-- COLD STORAGE -->\n\n${LONG_ENOUGH}`;
  const chapters = getManuscript(makeView(text));
  const coldStorageIndex = chapters.length - 1;
  const coldScene = chapters[coldStorageIndex].scenes[0];
  const hit = findActiveScene(chapters, coldScene.pos + 1);
  assert.deepEqual(hit, { chapterIndex: coldStorageIndex, sceneIndex: 0, sceneId: coldScene.id });
});
