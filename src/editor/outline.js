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

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    const text = line.text;
    const trimmed = text.trim();
    const headingMatch = text.match(/^(#{1,3})\s+(.+)$/);

    if (headingMatch) {
      items.push({ type: 'h' + headingMatch[1].length, text: headingMatch[2].trim(), line: lineNum, pos: line.from });
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
      items.push({ type: 'scene', text: 'Scene ' + sceneCount, line: lineNum, pos: line.from });
      awaitingFirstContent = false;
      continue;
    }
    if (awaitingFirstContent && trimmed !== '') {
      sceneCount = 1;
      items.push({ type: 'scene', text: 'Scene 1', line: lineNum, pos: line.from });
      awaitingFirstContent = false;
    }
  }

  return items;
}
