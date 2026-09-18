// Copy from the current document, not a potentially stale rendered card.
// Retain Markdown formatting, but never export Baretext's private records.
export function cleanCopiedText(text) {
  return text.split('\n').flatMap(line => {
    if (/^\s*<!--\s*(?:BOOK TITLE:|COLD STORAGE|SCENE LINK|SCENE GROUP:)/.test(line)) return [];
    const name = line.match(/^\s*<!--\s*(.*?)\s*-->\s*$/);
    return name ? ['## ' + name[1]] : [line];
  }).join('\n').replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*\n/, '').trim();
}

export function textToCopy(doc, chapters, ci, si) {
  const chapter = chapters[ci];
  if (!chapter) throw new Error('Chapter no longer exists');
  if (si !== undefined) {
    const scene = chapter.scenes[si];
    if (!scene) throw new Error('Scene no longer exists');
    return cleanCopiedText(doc.slice(scene.pos, scene.endPos));
  }
  const start = chapter.synthetic ? 0 : chapter.pos;
  const end = chapters.filter(c => c.pos !== null && c.pos > start)
    .reduce((end, c) => Math.min(end, c.pos), doc.length);
  return cleanCopiedText(doc.slice(start, end));
}
