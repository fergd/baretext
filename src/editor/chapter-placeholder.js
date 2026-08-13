import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { editorModeField, setEditorModeEffect } from './mode-state.js';
import { injectStyle as injectStyleTag } from '../dom.js';

// Shows ghost text right where a chapter's title would go, whenever that h1
// heading's own title text is empty ("#" with nothing after it) — purely
// visual, a widget decoration, never real document content, so it can never
// leak into getDoc()/setDoc() or the outline parser. Disappears the instant
// real text exists on that line.
//
// Sprinter mode keeps the original "Chapter N" ghost (mirrors model.js's own
// displayTitle fallback so the rail/corkboard and the live editor agree on
// which chapters look untitled). Editor mode's manuscript surface uses
// "Untitled" instead, per MANUSCRIPT_SURFACE.md — the number gutter already
// shows the chapter's index there, so a generic label reads better than a
// duplicate number.
class ChapterPlaceholderWidget extends WidgetType {
  constructor(text, isEditorMode) { super(); this.text = text; this.isEditorMode = isEditorMode; }
  eq(other) { return other.text === this.text && other.isEditorMode === this.isEditorMode; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-chapter-placeholder' + (this.isEditorMode ? ' cm-chapter-placeholder-untitled' : '');
    span.textContent = this.isEditorMode ? 'Untitled' : this.text;
    return span;
  }
  ignoreEvent() { return true; }
}

// h1 only — h2/h3 are scene-level titles, out of scope here.
const H1_RE = /^#(?!#)[ \t]*(.*)$/;

function build(view) {
  const doc = view.state.doc;
  const isEditorMode = view.state.field(editorModeField);
  const decos = [];
  let chapterNumber = 0;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(H1_RE);
    if (!match) continue;
    chapterNumber++;
    if (match[1].trim() === '') {
      decos.push(Decoration.widget({
        widget: new ChapterPlaceholderWidget('Chapter ' + chapterNumber, isEditorMode),
        side: 1,
      }).range(line.to));
    }
  }
  return Decoration.set(decos);
}

export const chapterPlaceholderPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(update) {
    const modeToggled = update.transactions.some(tr => tr.effects.some(e => e.is(setEditorModeEffect)));
    if (update.docChanged || modeToggled) this.decorations = build(update.view);
  }
}, { decorations: v => v.decorations });

export function injectChapterPlaceholderStyle() {
  injectStyleTag('bt-chapter-placeholder', `
.cm-chapter-placeholder {
  font-size: var(--text-h1, 26px);
  font-weight: 700;
  color: var(--h1);
  opacity: .38;
  pointer-events: none;
  user-select: none;
}
.cm-chapter-placeholder-untitled {
  font-weight: 400;
  color: var(--text-dimmer);
  opacity: 1;
}
`);
}
