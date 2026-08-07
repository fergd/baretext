import test from 'node:test';
import assert from 'node:assert/strict';
import { reorderScenes, deleteScene, deleteChapter, reorderChapters } from '../../src/features/scene-nav/reorder.js';

// Builds a minimal chapters[] shape matching what model.js's getManuscript()
// produces — reorderScenes only reads .title/.scenes per chapter and
// .rawText/.type per scene, so the rest of the real shape isn't needed here.
function scene(rawText, type = 'scene') {
  return { id: 'x', title: 'x', type, pos: 0, endPos: 0, rawText, wordCount: 0, synopsis: '', isDraft: false };
}

// A named bare scene the way model.js actually produces one: rawText carries
// the marker + comment verbatim (or, for a chapter-opening scene, just the
// comment), and `named`/`title` are what joinScenes reads to re-emit it.
function namedScene(name, rawText) {
  return { id: 'x', title: name, type: 'scene', named: true, pos: 0, endPos: 0, rawText, wordCount: 0, synopsis: '', isDraft: false };
}

function chapter(title, scenes) {
  return { title, pos: 0, type: 'h1', number: 1, scenes };
}

function synthetic(scenes) {
  return { title: '', pos: 0, synthetic: true, number: 1, scenes };
}

test('within-chapter forward move re-orders and re-separates with ---', () => {
  const chapters = [
    chapter('One', [
      scene('First scene text.'),
      scene('---\n\nSecond scene text.'),
      scene('---\n\nThird scene text.'),
    ]),
  ];
  const doc = reorderScenes(chapters, { fromChapterIndex: 0, fromSceneIndex: 0, toChapterIndex: 0, toSceneIndex: 2 });
  assert.equal(
    doc,
    '# One\n\nSecond scene text.\n\n---\n\nFirst scene text.\n\n---\n\nThird scene text.\n'
  );
});

test('within-chapter backward move (last scene to front)', () => {
  const chapters = [
    chapter('One', [
      scene('First.'),
      scene('---\n\nSecond.'),
      scene('---\n\nThird.'),
    ]),
  ];
  const doc = reorderScenes(chapters, { fromChapterIndex: 0, fromSceneIndex: 2, toChapterIndex: 0, toSceneIndex: 0 });
  assert.equal(doc, '# One\n\nThird.\n\n---\n\nFirst.\n\n---\n\nSecond.\n');
});

test('cross-chapter move rebuilds both chapters correctly', () => {
  const chapters = [
    chapter('One', [scene('A1.'), scene('---\n\nA2.')]),
    chapter('Two', [scene('B1.')]),
  ];
  const doc = reorderScenes(chapters, { fromChapterIndex: 0, fromSceneIndex: 1, toChapterIndex: 1, toSceneIndex: 1 });
  assert.equal(doc, '# One\n\nA1.\n\n# Two\n\nB1.\n\n---\n\nA2.\n');
});

test('cross-chapter move to front of target chapter', () => {
  const chapters = [
    chapter('One', [scene('A1.')]),
    chapter('Two', [scene('B1.'), scene('---\n\nB2.')]),
  ];
  const doc = reorderScenes(chapters, { fromChapterIndex: 0, fromSceneIndex: 0, toChapterIndex: 1, toSceneIndex: 0 });
  assert.equal(doc, '# One\n\n# Two\n\nA1.\n\n---\n\nB1.\n\n---\n\nB2.\n');
});

// Regression: a heading-titled scene (h2/h3) is self-delimiting — its own
// "## Title" line IS the boundary. Joining a preceding scene onto it must
// use a blank line, not a --- marker, or the next outline parse reads that
// --- as its own phantom scene (the exact bug found and fixed this session).
test('moving a scene in front of a heading-titled scene does not inject a stray ---', () => {
  const chapters = [
    chapter('One', [
      scene('First.'),
      scene('---\n\nSecond.'),
      scene('## A Titled Scene\n\nTitled prose.', 'h2'),
    ]),
  ];
  const doc = reorderScenes(chapters, { fromChapterIndex: 0, fromSceneIndex: 0, toChapterIndex: 0, toSceneIndex: 2 });
  assert.equal(
    doc,
    '# One\n\nSecond.\n\n---\n\nFirst.\n\n## A Titled Scene\n\nTitled prose.\n'
  );
  // Specifically: no "---" immediately before the heading.
  assert.ok(!doc.includes('---\n\n## A Titled Scene'));
});

test('a heading-titled scene landing first in its chapter keeps its heading intact', () => {
  const chapters = [
    chapter('One', [
      scene('First.'),
      scene('## A Titled Scene\n\nTitled prose.', 'h2'),
    ]),
  ];
  const doc = reorderScenes(chapters, { fromChapterIndex: 0, fromSceneIndex: 1, toChapterIndex: 0, toSceneIndex: 0 });
  assert.equal(doc, '# One\n\n## A Titled Scene\n\nTitled prose.\n\n---\n\nFirst.\n');
});

test('a bare scene landing first has its own leading --- stripped', () => {
  const chapters = [
    chapter('One', [
      scene('First.'),
      scene('---\n\nSecond.'),
    ]),
  ];
  const doc = reorderScenes(chapters, { fromChapterIndex: 0, fromSceneIndex: 1, toChapterIndex: 0, toSceneIndex: 0 });
  // "Second." was preceded by --- in its original rawText; once it's first,
  // that marker must not survive into the rebuilt doc.
  assert.equal(doc, '# One\n\nSecond.\n\n---\n\nFirst.\n');
});

// A named bare scene's waypoint comment must survive a rebuild -- adjacent
// to the marker (or, if it lands first in its chapter, adjacent to the
// content with no marker at all) -- exactly like the un-named case above,
// just with the extra <!-- Name --> line carried along.
test('a named scene keeps its waypoint comment adjacent to the marker after a move', () => {
  const chapters = [
    chapter('One', [
      scene('First.'),
      namedScene('Confrontation', '---\n<!-- Confrontation -->\n\nSecond.'),
      scene('---\n\nThird.'),
    ]),
  ];
  const doc = reorderScenes(chapters, { fromChapterIndex: 0, fromSceneIndex: 2, toChapterIndex: 0, toSceneIndex: 1 });
  assert.equal(
    doc,
    '# One\n\nFirst.\n\n---\n\nThird.\n\n---\n<!-- Confrontation -->\n\nSecond.\n'
  );
});

test('a named scene landing first in its chapter drops the marker but keeps the comment', () => {
  const chapters = [
    chapter('One', [
      scene('First.'),
      namedScene('Confrontation', '---\n<!-- Confrontation -->\n\nSecond.'),
    ]),
  ];
  const doc = reorderScenes(chapters, { fromChapterIndex: 0, fromSceneIndex: 1, toChapterIndex: 0, toSceneIndex: 0 });
  assert.equal(doc, '# One\n\n<!-- Confrontation -->\n\nSecond.\n\n---\n\nFirst.\n');
});

test('a named implicit-first scene keeps its comment when a scene is moved in front of it', () => {
  const chapters = [
    chapter('One', [
      namedScene('Opening Image', '<!-- Opening Image -->\n\nFirst.'),
      scene('---\n\nSecond.'),
    ]),
  ];
  const doc = reorderScenes(chapters, { fromChapterIndex: 0, fromSceneIndex: 1, toChapterIndex: 0, toSceneIndex: 0 });
  assert.equal(doc, '# One\n\nSecond.\n\n---\n<!-- Opening Image -->\n\nFirst.\n');
});

test('empty scenes are dropped from the rebuilt document', () => {
  const chapters = [
    chapter('One', [
      scene('First.'),
      scene('---\n\n   \n'), // whitespace-only after stripping the marker
      scene('---\n\nThird.'),
    ]),
  ];
  const doc = reorderScenes(chapters, { fromChapterIndex: 0, fromSceneIndex: 0, toChapterIndex: 0, toSceneIndex: 2 });
  assert.ok(!doc.includes('   '));
  // Move happens on the full (still-3-item) array before filtering, so
  // First lands between the (soon-dropped) empty scene and Third — filtering
  // then collapses that to just [First, Third].
  assert.equal(doc, '# One\n\nFirst.\n\n---\n\nThird.\n');
});

test('does not mutate the input chapters array or its scene objects', () => {
  const original = [
    chapter('One', [scene('First.'), scene('---\n\nSecond.')]),
    chapter('Two', [scene('B1.')]),
  ];
  const snapshot = JSON.parse(JSON.stringify(original));
  reorderScenes(original, { fromChapterIndex: 0, fromSceneIndex: 0, toChapterIndex: 1, toSceneIndex: 0 });
  assert.deepEqual(original, snapshot);
});

test('returns null when fromSceneIndex is out of range', () => {
  const chapters = [chapter('One', [scene('First.')])];
  const doc = reorderScenes(chapters, { fromChapterIndex: 0, fromSceneIndex: 5, toChapterIndex: 0, toSceneIndex: 0 });
  assert.equal(doc, null);
});

// Regression: a synthetic chapter (content before any # heading — see
// model.js) has no real heading line of its own. Any rebuild must leave it
// that way; inventing a "# " line for it would corrupt previously
// heading-less content into having a real (if blank) heading the user never
// typed. This bug pre-dated delete — reorder already hit it too.
test('reordering never invents a heading line for a synthetic chapter', () => {
  const chapters = [
    synthetic([scene('Untitled opener.')]),
    chapter('Two', [scene('First.'), scene('---\n\nSecond.')]),
  ];
  const doc = reorderScenes(chapters, { fromChapterIndex: 1, fromSceneIndex: 0, toChapterIndex: 1, toSceneIndex: 2 });
  assert.equal(doc, 'Untitled opener.\n\n# Two\n\nSecond.\n\n---\n\nFirst.\n');
});

test('deleteScene removes exactly one scene and rebuilds the rest cleanly', () => {
  const chapters = [
    chapter('One', [scene('First.'), scene('---\n\nSecond.'), scene('---\n\nThird.')]),
  ];
  const doc = deleteScene(chapters, { chapterIndex: 0, sceneIndex: 1 });
  assert.equal(doc, '# One\n\nFirst.\n\n---\n\nThird.\n');
});

test('deleteScene on the first scene lets the next scene become first cleanly (no stray ---)', () => {
  const chapters = [chapter('One', [scene('First.'), scene('---\n\nSecond.')])];
  const doc = deleteScene(chapters, { chapterIndex: 0, sceneIndex: 0 });
  assert.equal(doc, '# One\n\nSecond.\n');
});

test('deleteScene never invents a heading for a synthetic chapter', () => {
  const chapters = [synthetic([scene('First.'), scene('---\n\nSecond.')])];
  const doc = deleteScene(chapters, { chapterIndex: 0, sceneIndex: 1 });
  assert.equal(doc, 'First.\n');
});

test('deleteScene returns null for an out-of-range target', () => {
  const chapters = [chapter('One', [scene('First.')])];
  assert.equal(deleteScene(chapters, { chapterIndex: 0, sceneIndex: 5 }), null);
  assert.equal(deleteScene(chapters, { chapterIndex: 5, sceneIndex: 0 }), null);
});

test('deleteScene does not mutate the input', () => {
  const original = [chapter('One', [scene('First.'), scene('---\n\nSecond.')])];
  const snapshot = JSON.parse(JSON.stringify(original));
  deleteScene(original, { chapterIndex: 0, sceneIndex: 0 });
  assert.deepEqual(original, snapshot);
});

test('deleteChapter removes the whole chapter, including all its scenes', () => {
  const chapters = [
    chapter('One', [scene('A1.'), scene('---\n\nA2.')]),
    chapter('Two', [scene('B1.')]),
  ];
  const doc = deleteChapter(chapters, 0);
  assert.equal(doc, '# Two\n\nB1.\n');
});

test('deleteChapter down to zero chapters returns an empty document', () => {
  const chapters = [chapter('Only', [scene('Content.')])];
  assert.equal(deleteChapter(chapters, 0), '');
});

test('deleteChapter returns null for an out-of-range index', () => {
  const chapters = [chapter('One', [scene('First.')])];
  assert.equal(deleteChapter(chapters, 5), null);
});

test('deleteChapter does not mutate the input', () => {
  const original = [chapter('One', [scene('A.')]), chapter('Two', [scene('B.')])];
  const snapshot = JSON.parse(JSON.stringify(original));
  deleteChapter(original, 0);
  assert.deepEqual(original, snapshot);
});

test('reorderChapters moves a chapter forward', () => {
  const chapters = [
    chapter('One', [scene('A1.')]),
    chapter('Two', [scene('B1.')]),
    chapter('Three', [scene('C1.')]),
  ];
  const doc = reorderChapters(chapters, { fromIndex: 0, toIndex: 2 });
  assert.equal(doc, '# Two\n\nB1.\n\n# One\n\nA1.\n\n# Three\n\nC1.\n');
});

test('reorderChapters moves a chapter backward', () => {
  const chapters = [
    chapter('One', [scene('A1.')]),
    chapter('Two', [scene('B1.')]),
    chapter('Three', [scene('C1.')]),
  ];
  const doc = reorderChapters(chapters, { fromIndex: 2, toIndex: 0 });
  assert.equal(doc, '# Three\n\nC1.\n\n# One\n\nA1.\n\n# Two\n\nB1.\n');
});

test('reorderChapters dropping a chapter onto its own position is a no-op', () => {
  const chapters = [chapter('One', [scene('A1.')]), chapter('Two', [scene('B1.')])];
  const doc = reorderChapters(chapters, { fromIndex: 0, toIndex: 0 });
  assert.equal(doc, '# One\n\nA1.\n\n# Two\n\nB1.\n');
});

test('reorderChapters never invents a heading for a synthetic chapter that moves', () => {
  const chapters = [
    chapter('One', [scene('A1.')]),
    synthetic([scene('Untitled opener.')]),
  ];
  const doc = reorderChapters(chapters, { fromIndex: 1, toIndex: 0 });
  assert.equal(doc, 'Untitled opener.\n\n# One\n\nA1.\n');
});

test('reorderChapters returns null for an out-of-range fromIndex', () => {
  const chapters = [chapter('One', [scene('A1.')])];
  assert.equal(reorderChapters(chapters, { fromIndex: 5, toIndex: 0 }), null);
});

test('reorderChapters does not mutate the input', () => {
  const original = [chapter('One', [scene('A.')]), chapter('Two', [scene('B.')])];
  const snapshot = JSON.parse(JSON.stringify(original));
  reorderChapters(original, { fromIndex: 0, toIndex: 1 });
  assert.deepEqual(original, snapshot);
});
