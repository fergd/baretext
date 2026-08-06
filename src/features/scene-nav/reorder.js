// Pure — no DOM, no view. Given the current chapters[] model (from model.js)
// and a move/delete spec, returns a fully rewritten document string.
// Deliberately a full rebuild rather than a surgical text splice: every
// chapter becomes `# Title\n\n` + its scenes rejoined with a single
// consistent `---` separator, so any restructure always leaves clean,
// uniform scene-break formatting behind instead of trying to preserve
// whatever whitespace happened to exist around the affected block's old
// position.

function stripLeadingSceneBreak(text) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && /^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())) {
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
// that --- as its own phantom scene.
function joinScenes(scenes) {
  return scenes.reduce((doc, scene, i) => {
    const body = cleanScene(scene);
    if (i === 0) return body;
    return doc + (scene.type === 'scene' ? '\n\n---\n\n' : '\n\n') + body;
  }, '');
}

// Rebuilds the full document from a chapters[] array. A synthetic chapter
// (content before any # heading exists — see model.js) never gets a "# "
// line invented for it; every other chapter keeps its own heading text
// as-is, including a blank one ("# " alone — see chapter-placeholder.js,
// which shows a UI-only "Chapter N" ghost for exactly that case without it
// ever being real document text).
function buildDocument(chapters) {
  const parts = chapters
    .map((chapter) => {
      const body = joinScenes(chapter.scenes.filter((s) => cleanScene(s) !== ''));
      if (chapter.synthetic) return body;
      return '# ' + chapter.title + (body ? '\n\n' + body : '');
    })
    .filter((part) => part !== '');
  return parts.length ? parts.join('\n\n') + '\n' : '';
}

// moveSpec: { fromChapterIndex, fromSceneIndex, toChapterIndex, toSceneIndex }
// toSceneIndex is the insertion index into the TARGET chapter's scene array
// as it existed *before* the move (i.e. "insert before whatever scene is
// currently at this index there") — same-chapter moves are adjusted
// internally for the index shift the removal causes.
export function reorderScenes(chapters, moveSpec) {
  const { fromChapterIndex, fromSceneIndex, toChapterIndex, toSceneIndex } = moveSpec;

  const next = chapters.map((c) => ({ title: c.title, synthetic: c.synthetic, scenes: c.scenes.slice() }));

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

// Removes one scene from a chapter and returns the rebuilt document, or
// null if the target doesn't exist.
export function deleteScene(chapters, { chapterIndex, sceneIndex }) {
  const next = chapters.map((c) => ({ title: c.title, synthetic: c.synthetic, scenes: c.scenes.slice() }));
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
