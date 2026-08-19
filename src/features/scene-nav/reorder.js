// Pure — no DOM, no view. Given the current chapters[] model (from model.js)
// and a move/delete spec, returns a fully rewritten document string.
// Deliberately a full rebuild rather than a surgical text splice: every
// chapter becomes `# Title\n\n` + its scenes rejoined with a single
// consistent `---` separator, so any restructure always leaves clean,
// uniform scene-break formatting behind instead of trying to preserve
// whatever whitespace happened to exist around the affected block's old
// position.

const NAME_COMMENT_RE = /^<!--.*-->$/;
const COLD_STORAGE_MARKER = '<!-- COLD STORAGE -->';

// Strips a leading ---/***/___ marker line and, if present immediately after
// it (no blank line between -- see model.js/rename.js), the waypoint-name
// comment that goes with it -- leaving pure prose behind either way. A named
// implicit-first scene (the markerless one right after a chapter heading)
// never has a marker to begin with, just the comment on its own -- handled
// as a second, independent case rather than falling through unstripped
// (which would otherwise double the comment once joinScenes re-adds it for
// the scene's new position).
function stripLeadingSceneBreak(text) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && /^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())) {
    i++;
    if (i < lines.length && NAME_COMMENT_RE.test(lines[i].trim())) i++;
    while (i < lines.length && lines[i].trim() === '') i++;
    return lines.slice(i).join('\n');
  }
  if (i < lines.length && NAME_COMMENT_RE.test(lines[i].trim())) {
    i++;
    while (i < lines.length && lines[i].trim() === '') i++;
    return lines.slice(i).join('\n');
  }
  return text;
}

function cleanScene(scene) {
  return stripLeadingSceneBreak(scene.rawText).trim();
}

// Heading-titled scenes (h2/h3) are self-delimiting — their own heading line
// is the boundary marker, so joining one after another scene needs only a
// blank-line paragraph break. Only a bare scene (type 'scene', started by a
// standalone ---/***/___ line with no heading of its own) needs that marker
// re-inserted between it and whatever precedes it — otherwise moving a bare
// scene in front of a heading-titled one leaves the heading looking like
// ordinary prose directly under a --- rule, and the next outline scan reads
// that --- as its own phantom scene. A named bare scene also needs its
// waypoint-name comment re-inserted right after the marker (or, for the
// first scene in a chapter, right before its content — there's no marker to
// attach to there since the chapter heading is already the boundary).
//
// A bare scene with NO prose yet (a freshly-added, still-empty scene — see
// scene-nav/index.js's addNewScene, which inserts a marker with nothing
// after it) needs its explicit marker even at i===0, unlike a written first
// scene: outline.js's implicit-first-scene detection only recognizes a
// scene once REAL content follows the chapter heading (a markerless empty
// first "scene" is literally indistinguishable from an empty chapter, so it
// would round-trip out of existence). Real bug, caught live: dragging a
// just-added empty scene to the front of any chapter made it vanish
// entirely, with no undo-worthy trace it had ever existed.
function joinScenes(scenes) {
  return scenes.reduce((doc, scene, i) => {
    const body = cleanScene(scene);
    const nameComment = scene.named ? '<!-- ' + scene.title + ' -->\n\n' : '';
    if (scene.type !== 'scene') {
      return i === 0 ? body : doc + '\n\n' + body;
    }
    let prefix;
    if (i === 0) {
      prefix = body === '' ? '---\n' + (nameComment || '\n') : nameComment;
    } else {
      prefix = '\n\n---\n' + (nameComment || '\n');
    }
    return i === 0 ? prefix + body : doc + prefix + body;
  }, '');
}

// Rebuilds the full document from a chapters[] array. A synthetic chapter
// (content before any # heading exists — see model.js) never gets a "# "
// line invented for it; every other chapter keeps its own heading text
// as-is, including a blank one ("# " alone — see chapter-placeholder.js,
// which shows a UI-only "Chapter N" ghost for exactly that case without it
// ever being real document text). Every scene passed in is kept, even one
// with no prose yet — an empty scene is a normal, supported "draft" state
// (see model.js's isDraft), not something a rebuild gets to silently prune;
// an earlier version of this function filtered scenes with empty bodies out
// entirely, which quietly deleted the user's own just-created scenes on the
// very next reorder/rename/move.
//
// Cold Storage (chapter.coldStorage === true — see model.js) is never
// rendered as "# Title": its own marker line stands in for the heading, and
// it always serializes LAST regardless of where its entry sits in the input
// array — a chapter-level reorder/splice can never accidentally interleave
// a real chapter after it. An empty Cold Storage (no scenes, including
// "never used yet") writes nothing at all, so an unused Cold Storage never
// touches the document on disk, and dragging its last scene back out
// cleanly erases the section again on the next rebuild.
function buildDocument(chapters) {
  const coldStorage = chapters.find((c) => c.coldStorage);
  const realChapters = chapters.filter((c) => !c.coldStorage);

  const parts = realChapters
    .map((chapter) => {
      const body = joinScenes(chapter.scenes);
      if (chapter.synthetic) return body;
      return '# ' + chapter.title + (body ? '\n\n' + body : '');
    })
    .filter((part) => part !== '');

  if (coldStorage && coldStorage.scenes.length) {
    parts.push(COLD_STORAGE_MARKER + '\n\n' + joinScenes(coldStorage.scenes));
  }

  return parts.length ? parts.join('\n\n') + '\n' : '';
}

// moveSpec: { fromChapterIndex, fromSceneIndex, toChapterIndex, toSceneIndex }
// toSceneIndex is the insertion index into the TARGET chapter's scene array
// as it existed *before* the move (i.e. "insert before whatever scene is
// currently at this index there") — same-chapter moves are adjusted
// internally for the index shift the removal causes.
export function reorderScenes(chapters, moveSpec) {
  const { fromChapterIndex, fromSceneIndex, toChapterIndex, toSceneIndex } = moveSpec;

  const next = chapters.map((c) => ({ title: c.title, synthetic: c.synthetic, coldStorage: c.coldStorage, scenes: c.scenes.slice() }));

  const [moved] = next[fromChapterIndex].scenes.splice(fromSceneIndex, 1);
  if (!moved) return null;

  let insertAt = toSceneIndex;
  if (fromChapterIndex === toChapterIndex && fromSceneIndex < toSceneIndex) {
    insertAt -= 1;
  }
  insertAt = Math.max(0, Math.min(insertAt, next[toChapterIndex].scenes.length));
  next[toChapterIndex].scenes.splice(insertAt, 0, moved);

  return buildDocument(next);
}

// moveSpec: { fromIndex, toIndex } -- same "insert before whatever chapter
// was at toIndex before the move" convention as reorderScenes' toSceneIndex.
export function reorderChapters(chapters, { fromIndex, toIndex }) {
  if (!chapters[fromIndex]) return null;

  const next = chapters.map((c) => ({ title: c.title, synthetic: c.synthetic, coldStorage: c.coldStorage, scenes: c.scenes.slice() }));
  const [moved] = next.splice(fromIndex, 1);

  let insertAt = toIndex;
  if (fromIndex < toIndex) insertAt -= 1;
  insertAt = Math.max(0, Math.min(insertAt, next.length));
  next.splice(insertAt, 0, moved);

  return buildDocument(next);
}

// Removes one scene from a chapter and returns the rebuilt document, or
// null if the target doesn't exist.
export function deleteScene(chapters, { chapterIndex, sceneIndex }) {
  const next = chapters.map((c) => ({ title: c.title, synthetic: c.synthetic, coldStorage: c.coldStorage, scenes: c.scenes.slice() }));
  const chapter = next[chapterIndex];
  if (!chapter) return null;
  const [removed] = chapter.scenes.splice(sceneIndex, 1);
  if (!removed) return null;
  return buildDocument(next);
}

// Removes an entire chapter (heading and every scene in it) and returns the
// rebuilt document, or null if the target doesn't exist.
export function deleteChapter(chapters, chapterIndex) {
  if (!chapters[chapterIndex]) return null;
  const next = chapters.filter((_, i) => i !== chapterIndex);
  return buildDocument(next);
}

// Appends a new, blank chapter (empty title -- shows the "Untitled"
// placeholder, see chapter-placeholder.js -- and no scenes yet, a normal
// draft state) as the last REAL chapter, i.e. right before Cold Storage if
// it exists (Cold Storage must always serialize last -- see buildDocument's
// own comment) rather than at the true end of the chapters[] array.
export function addChapter(chapters) {
  const next = chapters.map((c) => ({ title: c.title, synthetic: c.synthetic, coldStorage: c.coldStorage, scenes: c.scenes.slice() }));
  const coldStorageIndex = next.findIndex((c) => c.coldStorage);
  const insertAt = coldStorageIndex === -1 ? next.length : coldStorageIndex;
  next.splice(insertAt, 0, { title: '', synthetic: false, coldStorage: false, scenes: [] });
  return buildDocument(next);
}
