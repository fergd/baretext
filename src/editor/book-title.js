import { Decoration, ViewPlugin } from '@codemirror/view';
import { injectStyle as injectStyleTag } from '../dom.js';

export const BOOK_TITLE_RE = /^<!--\s*BOOK TITLE:\s*(.*?)\s*-->$/;

export function readBookTitle(text) {
  const firstLine = String(text || '').split('\n', 1)[0];
  const match = firstLine.match(BOOK_TITLE_RE);
  return match && match[1].trim() ? match[1].trim() : '';
}

export function bookTitleLine(title) {
  return '<!-- BOOK TITLE: ' + title.trim().replace(/-->/g, '—>') + ' -->';
}

export function setBookTitle(view, title) {
  const value = title.trim();
  if (!value) return;
  const doc = view.state.doc;
  const first = doc.line(1);
  const insert = bookTitleLine(value);
  if (BOOK_TITLE_RE.test(first.text)) {
    view.dispatch({ changes: { from: first.from, to: first.to, insert } });
  } else {
    view.dispatch({ changes: { from: 0, to: 0, insert: insert + '\n\n' } });
  }
}

function build(view) {
  const first = view.state.doc.line(1);
  const match = first.text.match(BOOK_TITLE_RE);
  if (!match) return Decoration.none;

  const titleStart = first.text.indexOf(match[1]);
  const titleEnd = titleStart + match[1].length;
  const ranges = [Decoration.line({ class: 'cm-book-title' }).range(first.from)];

  // Reveal the record syntax only while the writer is editing this line,
  // matching Baretext's existing live-preview behavior for Markdown marks.
  if (view.state.doc.lineAt(view.state.selection.main.head).number !== 1) {
    ranges.push(Decoration.replace({}).range(first.from, first.from + titleStart));
    ranges.push(Decoration.replace({}).range(first.from + titleEnd, first.to));
  }
  return Decoration.set(ranges, true);
}

export const bookTitlePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = build(update.view);
    }
  }
}, { decorations: (value) => value.decorations });

export function injectBookTitleStyle() {
  injectStyleTag('bt-book-title', `
html[data-mode="editor"] .cm-line.cm-book-title {
  color: var(--text-strong); font-size: var(--ms-h1-size, 36px);
  font-weight: var(--ms-h1-weight, 400); line-height: var(--ms-h1-lh, 1.1);
  padding-bottom: 1em;
}
`);
}
