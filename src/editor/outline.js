// A bare scene's waypoint name, when it has one, lives as an HTML comment
// immediately after its ---/***/___ marker line (no blank line between them
// -- that adjacency is what distinguishes a named scene from an unnamed
// one's ordinary "---\n\n" spacing). It's a navigation aid only, never
// manuscript content: invisible in any rendered/exported markdown, and
// hidden in the editor the same way the raw dashes already are (see
// scene-breaks.js) in favor of showing just the name itself.
const NAME_COMMENT_RE = /^<!--\s*(.*?)\s*-->$/;

// Marks the start of the Cold Storage section (see scene-nav/model.js) — a
// place to drop scenes you don't want in the manuscript but aren't ready to
// delete. A literal, exact-match line rather than the generic NAME_COMMENT_RE
// pattern above: it plays the same structural role as a chapter's own "#"
// line (a section boundary scenes get parsed under), not a scene's own name,
// so it needs to be checked on its own before that per-scene comment logic
// ever runs.
const COLD_STORAGE_MARKER = '<!-- COLD STORAGE -->';
const BOOK_TITLE_RE = /^<!--\s*BOOK TITLE:\s*.*?\s*-->$/;

// Scans the document for headings (# / ## / ###) and scene breaks
// (---/***/___), plus an implicit "Scene 1" at the first content after a
// CHAPTER heading (#, before any explicit scene break) so the outline
// always has a jump target for a chapter's opening. Only # resets this —
// ## / ### headings are themselves scene-level markers (their own text IS
// the scene title), so content right after one belongs to that heading, not
// a synthesized sibling "Scene 1". (Originally this fired for any heading
// level 1-3; harmless for outline-jump's extra entry, but wrong once scene
// content ranges are derived from it — see src/features/scene-nav/model.js.)
export function getOutline(view) {
  const doc = view.state.doc;
  const items = [];
  let sceneCount = 0;
  let awaitingFirstContent = true;
  // A name comment seen while awaiting a chapter's first real content --
  // held until that content line actually arrives, since the comment isn't
  // content itself and shouldn't be mistaken for the implicit first scene.
  let pendingName = null;

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    const text = line.text;
    const trimmed = text.trim();
    if (lineNum === 1 && BOOK_TITLE_RE.test(trimmed)) continue;
    // CommonMark allows an ATX heading with no title at all ("#", or "#"
    // plus trailing whitespace) — the title group is wrapped in an optional
    // non-capturing group (not \s+(.+), which requires at least one
    // leftover character after the separator) so a freshly-typed "# " with
    // nothing typed yet still counts as a heading instead of being invisible
    // to the outline until real title text exists.
    if (trimmed === COLD_STORAGE_MARKER) {
      items.push({ type: 'cold-storage', text: 'Cold Storage', line: lineNum, pos: line.from });
      sceneCount = 0;
      awaitingFirstContent = true;
      pendingName = null;
      continue;
    }

    const headingMatch = text.match(/^(#{1,3})(?:[ \t]+(.*))?$/);

    if (headingMatch) {
      items.push({ type: 'h' + headingMatch[1].length, text: (headingMatch[2] || '').trim(), line: lineNum, pos: line.from });
      pendingName = null;
      if (headingMatch[1].length === 1) {
        sceneCount = 0;
        awaitingFirstContent = true;
      } else {
        awaitingFirstContent = false;
      }
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      sceneCount++;
      const next = lineNum + 1 <= doc.lines ? doc.line(lineNum + 1).text.trim() : '';
      const nameMatch = next.match(NAME_COMMENT_RE);
      items.push({ type: 'scene', text: nameMatch ? nameMatch[1] : 'Scene ' + sceneCount, line: lineNum, pos: line.from, named: !!nameMatch });
      awaitingFirstContent = false;
      continue;
    }
    if (awaitingFirstContent) {
      const nameMatch = trimmed.match(NAME_COMMENT_RE);
      if (nameMatch) {
        pendingName = nameMatch[1];
        continue;
      }
      if (trimmed !== '') {
        sceneCount = 1;
        items.push({ type: 'scene', text: pendingName || 'Scene 1', line: lineNum, pos: line.from, named: !!pendingName });
        pendingName = null;
        awaitingFirstContent = false;
      }
    }
  }

  return items;
}
