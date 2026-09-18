// Pure — no DOM, no view. Given the current chapters[] model (from model.js)
// and a move/delete spec, returns a fully rewritten document string.
// Deliberately a full rebuild rather than a surgical text splice: every
// chapter becomes `# Title\n\n` + its scenes rejoined with a single
// consistent `---` separator, so any restructure always leaves clean,
// uniform scene-break formatting behind instead of trying to preserve
// whatever whitespace happened to exist around the affected block's old
// position.

import { SCENE_LINK_MARKER, stripSceneLink, sceneGroup, linkedMembers } from './links.js';

const NAME_COMMENT_RE = /^<!--.*-->$/;
const COLD_STORAGE_MARKER = '<!-- COLD STORAGE -->';
const BOOK_TITLE_PREFIX = '<!-- BOOK TITLE: ';

function carryBookTitle(from, to) {
  to.bookTitle = from.bookTitle || '';
  return to;
}

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
  return stripLeadingSceneBreak(stripSceneLink(scene.rawText)).trim();
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
    const prose = cleanScene(scene);
    const body = prose + (scene.groupId ? '\n<!-- SCENE GROUP: ' + scene.groupId + ' -->' : scene.linkedNext && i < scenes.length - 1 ? '\n' + SCENE_LINK_MARKER : '');
    const nameComment = scene.named ? '<!-- ' + scene.title + ' -->\n\n' : '';
    if (scene.type !== 'scene') {
      return i === 0 ? body : doc + '\n\n' + body;
    }
    let prefix;
    if (i === 0) {
      prefix = prose === '' ? '---\n' + (nameComment || '\n') : nameComment;
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
  const counts = new Map();
  for (const scene of chapters.flatMap(c => c.scenes)) if (scene.groupId) counts.set(scene.groupId, (counts.get(scene.groupId) || 0) + 1);
  chapters = carryBookTitle(chapters, chapters.map(c => ({ ...c, scenes: c.scenes.map(s => s.groupId && counts.get(s.groupId) < 2 ? { ...s, groupId: null } : s) })));
  const coldStorage = chapters.find((c) => c.coldStorage);
  const realChapters = chapters.filter((c) => !c.coldStorage);

  const parts = realChapters
    .map((chapter) => {
      const body = joinScenes(chapter.scenes);
      if (chapter.synthetic) return body;
      return '# ' + chapter.title + (body ? '\n\n' + body : '');
    })
    .filter((part) => part !== '');

  if (chapters.bookTitle) parts.unshift(BOOK_TITLE_PREFIX + chapters.bookTitle + ' -->');

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

  const source = chapters[fromChapterIndex]?.scenes;
  const target = chapters[toChapterIndex]?.scenes;
  if (!source?.[fromSceneIndex] || !target) return null;
  if (source[fromSceneIndex].groupId) {
    const members = linkedMembers(chapters, fromChapterIndex, fromSceneIndex);
    const selected = new Set(members.map(m => m.scene));
    let at = Math.max(0, Math.min(toSceneIndex, target.length));
    if (target[at] && selected.has(target[at])) return buildDocument(chapters);
    if (at < target.length) at = sceneGroup(target, at).start;
    const before = target.slice(0, at).filter(s => !selected.has(s)).length;
    const next = carryBookTitle(chapters, chapters.map(c => ({ ...c, scenes: c.scenes.filter(s => !selected.has(s)) })));
    next[toChapterIndex].scenes.splice(before, 0, ...members.map(m => m.scene));
    return buildDocument(next);
  }
  const { start, end } = sceneGroup(source, fromSceneIndex);
  let insertAt = Math.max(0, Math.min(toSceneIndex, target.length));
  if (fromChapterIndex === toChapterIndex && insertAt >= start && insertAt <= end) return buildDocument(chapters);
  // Dropping onto any member inserts before the entire destination group.
  if (insertAt < target.length) insertAt = sceneGroup(target, insertAt).start;

  const next = carryBookTitle(chapters, chapters.map((c) => ({ title: c.title, synthetic: c.synthetic, coldStorage: c.coldStorage, scenes: c.scenes.slice() })));

  const moved = next[fromChapterIndex].scenes.splice(start, end - start);
  if (fromChapterIndex === toChapterIndex && start < insertAt) {
    insertAt -= moved.length;
  }
  insertAt = Math.max(0, Math.min(insertAt, next[toChapterIndex].scenes.length));
  next[toChapterIndex].scenes.splice(insertAt, 0, ...moved);

  return buildDocument(next);
}

// moveSpec: { fromIndex, toIndex } -- same "insert before whatever chapter
// was at toIndex before the move" convention as reorderScenes' toSceneIndex.
export function reorderChapters(chapters, { fromIndex, toIndex }) {
  if (!chapters[fromIndex]) return null;

  const next = carryBookTitle(chapters, chapters.map((c) => ({ title: c.title, synthetic: c.synthetic, coldStorage: c.coldStorage, scenes: c.scenes.slice() })));
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
  const next = carryBookTitle(chapters, chapters.map((c) => ({ title: c.title, synthetic: c.synthetic, coldStorage: c.coldStorage, scenes: c.scenes.slice() })));
  const chapter = next[chapterIndex];
  if (!chapter) return null;
  const [removed] = chapter.scenes.splice(sceneIndex, 1);
  if (!removed) return null;
  if (sceneIndex > 0 && !removed.linkedNext) {
    chapter.scenes[sceneIndex - 1] = { ...chapter.scenes[sceneIndex - 1], linkedNext: false };
  }
  return buildDocument(next);
}

export function toggleSceneLink(chapters, { chapterIndex, sceneIndex }) {
  const scenes = chapters[chapterIndex]?.scenes;
  if (!scenes?.[sceneIndex] || !scenes[sceneIndex + 1]) return null;
  const next = carryBookTitle(chapters, chapters.map(c => ({ ...c, scenes: c.scenes.slice() })));
  next[chapterIndex].scenes[sceneIndex] = { ...scenes[sceneIndex], linkedNext: !scenes[sceneIndex].linkedNext };
  return buildDocument(next);
}

// Selecting cards changes membership only; manuscript order changes on drag.
export function linkScenes(chapters, source, target) {
  const a = linkedMembers(chapters, source.chapterIndex, source.sceneIndex);
  const b = linkedMembers(chapters, target.chapterIndex, target.sceneIndex);
  if (!a.length || !b.length || a.some(m => b.some(n => m.scene === n.scene))) return null;
  const members = new Set([...a, ...b].map(m => m.scene));
  const used = new Set(chapters.flatMap(c => c.scenes.map(s => s.groupId)));
  let id = 1;
  while (used.has('group-' + id)) id++;
  const groupId = a[0].scene.groupId || b[0].scene.groupId || 'group-' + id;
  const next = carryBookTitle(chapters, chapters.map(c => ({ ...c, scenes: c.scenes.map(s => members.has(s) ? { ...s, groupId, linkedNext: false } : s) })));
  return buildDocument(next);
}

export function unlinkScene(chapters, { chapterIndex, sceneIndex }) {
  const members = linkedMembers(chapters, chapterIndex, sceneIndex);
  if (members.length < 2) return null;
  const selected = chapters[chapterIndex].scenes[sceneIndex];
  const remaining = members.filter(m => m.scene !== selected);
  const used = new Set(chapters.flatMap(c => c.scenes.map(s => s.groupId)));
  let id = 1;
  while (used.has('group-' + id)) id++;
  const groupId = selected.groupId || 'group-' + id;
  const memberSet = new Set(members.map(m => m.scene));
  const next = carryBookTitle(chapters, chapters.map(c => ({ ...c, scenes: c.scenes.map(s => memberSet.has(s) ? { ...s, linkedNext: false, groupId: s === selected || remaining.length < 2 ? null : groupId } : s) })));
  return buildDocument(next);
}

// Removes an entire chapter (heading and every scene in it) and returns the
// rebuilt document, or null if the target doesn't exist.
export function deleteChapter(chapters, chapterIndex) {
  if (!chapters[chapterIndex]) return null;
  const next = carryBookTitle(chapters, chapters.filter((_, i) => i !== chapterIndex));
  return buildDocument(next);
}

// Appends a new, blank chapter (empty title -- shows the "Untitled"
// placeholder, see chapter-placeholder.js) as the last REAL chapter, i.e.
// right before Cold Storage if it exists (Cold Storage must always
// serialize last -- see buildDocument's own comment) rather than at the
// true end of the chapters[] array. Seeded with one blank scene rather than
// none -- a chapter with zero scenes has nowhere for the writer to actually
// start typing (the rail's own "+ add scene" row is the only way in, one
// extra click every single time) and doesn't match how every other chapter
// in a real manuscript looks. joinScenes' i===0 empty-body case already
// emits an explicit marker for exactly this "scene with no prose yet"
// shape, so it round-trips back out of getManuscript() as a real (draft)
// scene next render, not as an empty chapter.
export function addChapter(chapters) {
  const next = carryBookTitle(chapters, chapters.map((c) => ({ title: c.title, synthetic: c.synthetic, coldStorage: c.coldStorage, scenes: c.scenes.slice() })));
  const coldStorageIndex = next.findIndex((c) => c.coldStorage);
  const insertAt = coldStorageIndex === -1 ? next.length : coldStorageIndex;
  const blankScene = { title: '', type: 'scene', named: false, rawText: '' };
  next.splice(insertAt, 0, { title: '', synthetic: false, coldStorage: false, scenes: [blankScene] });
  return buildDocument(next);
}
