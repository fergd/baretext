// Rewrites a chapter's or scene's title directly in the document. Chapters
// (h1) and titled scenes (h2/h3) already have a heading line; this just
// swaps the text after the '#' marks. A chapter with no backing heading
// line yet (the synthesized "Untitled" chapter for content before any # in
// the doc) gets one inserted at the very top.
//
// A bare scene (a standalone ---/***/___ line, or the implicit first-content
// scene with no marker at all) is different on purpose: naming it is a
// navigation waypoint, not a manuscript edit, so it must never turn into a
// real heading (that would both delete the scene-break symbol and put new
// prose-level text in front of the reader). The name is stored as an HTML
// comment — invisible in any rendered/exported markdown, and hidden in the
// editor itself the same way the raw dashes already are (see
// scene-breaks.js) — placed immediately after the marker line with no blank
// line between them (or, for the markerless implicit first scene, directly
// before its content). See outline.js for the matching read side.

const HEADING_LEVELS = { h1: 1, h2: 2, h3: 3 };
const NAME_COMMENT_RE = /^<!--.*-->$/;

function commentFor(title) {
  return '<!-- ' + title + ' -->';
}

// A blank title is a real, valid rename (falls back to the "Untitled"/
// "Scene N" placeholder), not a no-op or a cancel -- the only way to
// actually clear a title once it's been set. It's handled differently per
// target shape below: a heading just goes back to a bare "#"-line (already
// what chapter-placeholder.js treats as untitled); a bare scene's name only
// exists as a comment at all, so clearing it means deleting that comment
// line outright rather than writing an empty one (an empty `<!-- -->`
// would itself still count as "named" to outline.js's own parser).
export function renameTitle(view, target, newTitle) {
  const title = newTitle.trim();
  const doc = view.state.doc;

  if (target.synthetic) {
    // No heading line exists yet to clear -- already as untitled as this
    // chapter can be.
    if (!title) return;
    view.dispatch({ changes: { from: 0, to: 0, insert: '# ' + title + '\n\n' } });
    return;
  }

  const level = HEADING_LEVELS[target.type];
  if (level) {
    const line = doc.lineAt(Math.min(target.pos, doc.length));
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '#'.repeat(level) + ' ' + title } });
    return;
  }

  // Bare scene — either the ---/***/___ marker line itself, or (for the
  // implicit first scene) no marker line at all, just prose starting cold.
  const line = doc.lineAt(Math.min(target.pos, doc.length));
  const isMarkerLine = /^(-{3,}|\*{3,}|_{3,})$/.test(line.text.trim());

  if (isMarkerLine) {
    const nextLine = line.number < doc.lines ? doc.line(line.number + 1) : null;
    const hasComment = nextLine && NAME_COMMENT_RE.test(nextLine.text.trim());
    if (!title) {
      if (hasComment) view.dispatch({ changes: { from: nextLine.from, to: Math.min(nextLine.to + 1, doc.length) } });
      return;
    }
    const comment = commentFor(title);
    if (hasComment) {
      view.dispatch({ changes: { from: nextLine.from, to: nextLine.to, insert: comment } });
    } else {
      view.dispatch({ changes: { from: line.to, to: line.to, insert: '\n' + comment } });
    }
    return;
  }

  // Implicit first scene of a chapter, no marker of its own — an existing
  // name comment (if any) sits a couple of lines above this one (the
  // comment, then the blank line always inserted after it — see the insert
  // branch below), not immediately adjacent, so scan back past blank lines
  // rather than checking just one line up.
  let checkNum = line.number - 1;
  while (checkNum >= 1 && doc.line(checkNum).text.trim() === '') checkNum--;
  const prevLine = checkNum >= 1 ? doc.line(checkNum) : null;
  const hasComment = prevLine && NAME_COMMENT_RE.test(prevLine.text.trim());
  if (!title) {
    if (hasComment) view.dispatch({ changes: { from: prevLine.from, to: line.from } });
    return;
  }
  const comment = commentFor(title);
  if (hasComment) {
    view.dispatch({ changes: { from: prevLine.from, to: prevLine.to, insert: comment } });
  } else {
    view.dispatch({ changes: { from: line.from, to: line.from, insert: comment + '\n\n' } });
  }
}
