// Rewrites a chapter's or scene's title directly in the document — there's
// no metadata layer in this app, so a title only exists if it's real heading
// text. Chapters (h1) and titled scenes (h2/h3) already have a heading line;
// this just swaps the text after the '#' marks. A bare scene (a standalone
// ---/***/___ line, or the implicit first-content scene with no marker at
// all) has no heading line to rewrite — giving it a title promotes it to a
// real h2 heading. A chapter with no backing heading line yet (the
// synthesized "Untitled" chapter for content before any # in the doc) gets
// one inserted at the very top.

const HEADING_LEVELS = { h1: 1, h2: 2, h3: 3 };

export function renameTitle(view, target, newTitle) {
  const title = newTitle.trim();
  if (!title) return;

  const doc = view.state.doc;

  if (target.synthetic) {
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
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '## ' + title } });
  } else {
    view.dispatch({ changes: { from: line.from, to: line.from, insert: '## ' + title + '\n\n' } });
  }
}
