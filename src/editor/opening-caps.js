import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { injectStyle as injectStyleTag } from '../dom.js';

// A scene's opening line may render its first few words in small caps — a
// quiet literary convention (typography-rhythm.md #4), Editor mode only
// (see the manuscript-surface / gutter precedent this file follows: a light
// local scan, independent of outline.js, that only needs enough of the
// document's shape to find "the first real content line of every scene").
const NAME_COMMENT_RE = /^<!--\s*(.*?)\s*-->$/;
const BOOK_TITLE_RE = /^<!--\s*BOOK TITLE:\s*.*?\s*-->$/;
const MARKER_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const HEADING_RE = /^(#{1,3})(?:[ \t]+.*)?$/;
const COLD_STORAGE_MARKER = '<!-- COLD STORAGE -->';
// Up to the first 3 words, including any leading punctuation/quote mark so a
// line opening with a quotation mark isn't split mid-quote.
const OPENING_RE = /^[^\w]*\S+(?:\s+\S+){0,2}/;

function build(state) {
  const doc = state.doc;
  const decos = [];
  // True from the moment a chapter/scene boundary (heading or marker) is
  // seen until the first non-blank, non-comment line after it — the same
  // "preamble" window scene-breaks.js/manuscript-gutter.js already scan for
  // a name comment, just watching for real prose instead.
  let awaitingSceneStart = false;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const trimmed = line.text.trim();
    if (i === 1 && BOOK_TITLE_RE.test(trimmed)) continue;
    if (trimmed === COLD_STORAGE_MARKER) { awaitingSceneStart = false; continue; }

    if (HEADING_RE.test(line.text) || MARKER_RE.test(trimmed)) {
      awaitingSceneStart = true;
      continue;
    }
    if (!awaitingSceneStart) continue;
    if (NAME_COMMENT_RE.test(trimmed)) continue; // still preamble
    if (/^>/.test(trimmed)) continue; // an epigraph precedes the scene's prose
    if (trimmed === '') continue; // blank line before real content
    const m = line.text.match(OPENING_RE);
    if (m && m[0].trim()) {
      decos.push(Decoration.mark({ class: 'cm-opening-caps' }).range(line.from, line.from + m[0].length));
    }
    awaitingSceneStart = false;
  }
  return Decoration.set(decos, true);
}

export const openingCapsDecorator = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view.state); }
  update(update) {
    if (update.docChanged) this.decorations = build(update.state);
  }
}, { decorations: (v) => v.decorations });

export function injectOpeningCapsStyle() {
  injectStyleTag('bt-opening-caps', `
html[data-mode="editor"] .cm-opening-caps {
  font-variant: small-caps; font-weight: 700; letter-spacing: .02em;
}
`);
}
