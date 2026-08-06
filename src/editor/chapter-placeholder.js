import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';

// Shows "Chapter N" as ghost text right where a chapter's title would go,
// whenever that h1 heading's own title text is empty ("#" with nothing
// after it) — purely visual, a widget decoration, never real document
// content, so it can never leak into getDoc()/setDoc() or the outline
// parser. Disappears the instant real text exists on that line. Mirrors
// model.js's own displayTitle fallback (same "trimmed heading text is
// empty" rule) so the rail/corkboard and the live editor always agree on
// which chapters look untitled.
class ChapterPlaceholderWidget extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(other) { return other.text === this.text; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-chapter-placeholder';
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() { return true; }
}

// h1 only — h2/h3 are scene-level titles, out of scope here.
const H1_RE = /^#(?!#)[ \t]*(.*)$/;

function build(view) {
  const doc = view.state.doc;
  const decos = [];
  let chapterNumber = 0;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(H1_RE);
    if (!match) continue;
    chapterNumber++;
    if (match[1].trim() === '') {
      decos.push(Decoration.widget({
        widget: new ChapterPlaceholderWidget('Chapter ' + chapterNumber),
        side: 1,
      }).range(line.to));
    }
  }
  return Decoration.set(decos);
}

export const chapterPlaceholderPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(update) {
    if (update.docChanged) this.decorations = build(update.view);
  }
}, { decorations: v => v.decorations });

export function injectChapterPlaceholderStyle() {
  if (document.getElementById('bt-chapter-placeholder')) return;
  const style = document.createElement('style');
  style.id = 'bt-chapter-placeholder';
  style.textContent = `
.cm-chapter-placeholder {
  font-size: var(--text-h1, 26px);
  font-weight: 700;
  color: var(--h1);
  opacity: .38;
  pointer-events: none;
  user-select: none;
}
`;
  document.head.appendChild(style);
}
