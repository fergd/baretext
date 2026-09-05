import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { StateField } from '@codemirror/state';
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

  // This is application metadata, not author-facing Markdown. Keep its
  // comment delimiters hidden even when the caret happens to land on line
  // one (for example after restoring a saved cursor position). Revealing
  // them made the record look like manuscript text and invited accidental
  // edits that could make the outline treat it as real prose.
  ranges.push(Decoration.replace({}).range(first.from, first.from + titleStart));
  ranges.push(Decoration.replace({}).range(first.from + titleEnd, first.to));
  return Decoration.set(ranges, true);
}

export const bookTitlePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(update) {
    // The title record is derived solely from line one. Cursor movement and
    // scrolling must never rebuild layout-affecting decorations.
    if (update.docChanged) {
      this.decorations = build(update.view);
    }
  }
}, { decorations: (value) => value.decorations });

function buildAtomicRange(state) {
  const first = state.doc.line(1);
  if (!BOOK_TITLE_RE.test(first.text)) return Decoration.none;
  return Decoration.set([
    Decoration.mark({}).range(first.from, Math.min(first.to + 1, state.doc.length)),
  ]);
}

// The title record is private application metadata. Keeping its whole line
// atomic prevents arrow-key movement from ever parking the caret inside the
// hidden comment delimiters, where ordinary typing could corrupt the record.
export const bookTitleAtomicRange = StateField.define({
  create: (state) => buildAtomicRange(state),
  update: (value, tr) => (tr.docChanged ? buildAtomicRange(tr.state) : value.map(tr.changes)),
  provide: (field) => EditorView.atomicRanges.from(field, (ranges) => () => ranges),
});

export function positionAfterBookTitle(doc) {
  const first = doc.line(1);
  if (!BOOK_TITLE_RE.test(first.text)) return null;
  return doc.lines >= 3 ? doc.line(3).from : Math.min(first.to + 1, doc.length);
}

// Mouse position resolution can still choose an atomic range's near edge.
// Redirect clicks on the rendered title to the first manuscript line.
export const bookTitleClickGuard = EditorView.domEventHandlers({
  mousedown(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null || view.state.doc.lineAt(pos).number !== 1) return false;
    const safe = positionAfterBookTitle(view.state.doc);
    if (safe === null) return false;
    event.preventDefault();
    view.dispatch({ selection: { anchor: safe } });
    view.focus();
    return true;
  },
});

export function injectBookTitleStyle() {
  injectStyleTag('bt-book-title', `
html[data-mode="editor"] .cm-line.cm-book-title {
  color: var(--text-strong); font-size: var(--ms-h1-size, 36px);
  font-weight: var(--ms-h1-weight, 400); line-height: var(--ms-h1-lh, 1.1);
  padding-bottom: 1em;
}
`);
}
