// Derives a chapters[]/scenes[] manuscript model from getOutline() + getDoc()
// — pure derived data, no editor-bundle changes needed. Both rail.js and
// corkboard.js render from this same shape.

const DRAFT_WORD_THRESHOLD = 20;
const SYNOPSIS_MAX_CHARS = 100;

function countWords(text) {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

// Strips the boundary marker itself (heading line / scene-break line) so the
// synopsis is actual prose, not "## Opening" or "---".
function synopsisFrom(text) {
  const proseLines = text.split('\n').filter((l) => {
    const t = l.trim();
    return t !== '' && !/^#{1,6}\s/.test(t) && !/^(-{3,}|\*{3,}|_{3,})$/.test(t);
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
export function getManuscript(view) {
  const outline = window.BaretextEditor.getOutline(view);
  const doc = window.BaretextEditor.getDoc(view);
  const docLength = doc.length;

  const chapters = [];
  let currentChapter = null;

  for (let i = 0; i < outline.length; i++) {
    const item = outline[i];
    const endPos = i + 1 < outline.length ? outline[i + 1].pos : docLength;

    if (item.type === 'h1') {
      currentChapter = { title: item.text, pos: item.pos, type: 'h1', number: chapters.length + 1, scenes: [] };
      chapters.push(currentChapter);
      continue;
    }

    if (!currentChapter) {
      // Content before any # heading — synthesized so it still has a home;
      // renaming this one has to insert a real heading line (see rename.js).
      currentChapter = { title: 'Untitled', pos: 0, synthetic: true, number: chapters.length + 1, scenes: [] };
      chapters.push(currentChapter);
    }

    const rawText = doc.slice(item.pos, endPos);
    const wordCount = countWords(rawText);
    currentChapter.scenes.push({
      id: (chapters.length - 1) + ':' + currentChapter.scenes.length,
      title: item.text,
      type: item.type,
      pos: item.pos,
      endPos,
      rawText,
      wordCount,
      synopsis: synopsisFrom(rawText),
      isDraft: wordCount < DRAFT_WORD_THRESHOLD,
    });
  }

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
