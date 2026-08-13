// Derives a chapters[]/scenes[] manuscript model from getOutline() + getDoc()
// — pure derived data, no editor-bundle changes needed. Both rail.js and
// corkboard.js render from this same shape.

const DRAFT_WORD_THRESHOLD = 20;
const SYNOPSIS_MAX_CHARS = 100;

const NAME_COMMENT_RE = /^<!--.*-->$/;

function countWords(text) {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

// Strips the boundary marker itself (heading line / scene-break line / a
// waypoint-name comment) so the synopsis is actual prose, not "## Opening",
// "---", or "<!-- Confrontation -->".
function synopsisFrom(text) {
  const proseLines = text.split('\n').filter((l) => {
    const t = l.trim();
    return t !== '' && !/^#{1,6}\s/.test(t) && !/^(-{3,}|\*{3,}|_{3,})$/.test(t) && !NAME_COMMENT_RE.test(t);
  });
  const prose = proseLines.join(' ').trim();
  if (prose.length <= SYNOPSIS_MAX_CHARS) return prose;
  const cut = prose.slice(0, SYNOPSIS_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…';
}

// Chapters = h1 headings. Scenes = everything else getOutline() returns
// within a chapter (h2/h3 headings using their own text as the scene title,
// explicit ---/***/___ breaks, and the implicit first-content marker) —
// all already carry the right display text from getOutline() itself.
//
// Cold Storage (see outline.js's COLD_STORAGE_MARKER) is a scenes-only
// bucket for cut material — not counted as a chapter, not numbered, always
// the LAST entry of the returned array regardless of where its marker sits
// in the document. It's always present (even with zero scenes, when the
// marker doesn't exist in the doc at all yet) so callers never need a
// separate "does Cold Storage exist" branch — dropping the first scene into
// it and having reorder.js's buildDocument() write the marker for the first
// time is just an ordinary cross-"chapter" move, same code path as moving a
// scene between two real chapters.
export function getManuscript(view) {
  const outline = window.BaretextEditor.getOutline(view);
  const doc = window.BaretextEditor.getDoc(view);
  const docLength = doc.length;

  const chapters = [];
  const coldStorage = { title: 'Cold Storage', coldStorage: true, pos: null, scenes: [] };
  let currentChapter = null;
  let inColdStorage = false;

  for (let i = 0; i < outline.length; i++) {
    const item = outline[i];
    const endPos = i + 1 < outline.length ? outline[i + 1].pos : docLength;

    if (item.type === 'cold-storage') {
      coldStorage.pos = item.pos;
      inColdStorage = true;
      currentChapter = null;
      continue;
    }

    if (item.type === 'h1') {
      inColdStorage = false;
      const number = chapters.length + 1;
      currentChapter = { title: item.text, displayTitle: item.text || 'Chapter ' + number, pos: item.pos, type: 'h1', number, scenes: [] };
      chapters.push(currentChapter);
      continue;
    }

    if (!inColdStorage && !currentChapter) {
      // Content before any # heading — synthesized so it still has a home;
      // renaming this one has to insert a real heading line (see rename.js).
      // title stays '' (there's no real heading text to prefill a rename
      // with) — displayTitle is the placeholder shown in the UI.
      const number = chapters.length + 1;
      currentChapter = { title: '', displayTitle: 'Chapter ' + number, pos: 0, synthetic: true, number, scenes: [] };
      chapters.push(currentChapter);
    }

    const container = inColdStorage ? coldStorage : currentChapter;
    const rawText = doc.slice(item.pos, endPos);
    // The name comment (if any) is real characters in rawText -- needed so
    // reorder.js's rebuild can carry it along -- but shouldn't inflate the
    // word count the way it would if counted as literal words.
    const wordCount = countWords(rawText.split('\n').filter((l) => !NAME_COMMENT_RE.test(l.trim())).join('\n'));
    container.scenes.push({
      id: (inColdStorage ? 'cold' : chapters.length - 1) + ':' + container.scenes.length,
      title: item.text,
      type: item.type,
      named: !!item.named,
      pos: item.pos,
      endPos,
      rawText,
      wordCount,
      synopsis: synopsisFrom(rawText),
      isDraft: wordCount < DRAFT_WORD_THRESHOLD,
    });
  }

  chapters.push(coldStorage);
  return chapters;
}

// Which scene (if any) contains the given document position — used to
// highlight the active row/card as the caret moves.
export function findActiveScene(chapters, cursorPos) {
  for (let ci = 0; ci < chapters.length; ci++) {
    const scenes = chapters[ci].scenes;
    for (let si = 0; si < scenes.length; si++) {
      const scene = scenes[si];
      if (cursorPos >= scene.pos && cursorPos < scene.endPos) {
        return { chapterIndex: ci, sceneIndex: si, sceneId: scene.id };
      }
    }
  }
  return null;
}
