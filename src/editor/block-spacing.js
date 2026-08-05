import { Decoration, ViewPlugin } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

// Fakes block-level vertical rhythm (headings/paragraphs having margin)
// since CodeMirror lines don't have real block margins — tags the last
// line of each heading and every line of each top-level paragraph with a
// class, then CSS applies bottom padding.
function build(view) {
  const state = view.state;
  const doc = state.doc;
  const out = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      const headingMatch = /^(?:ATX|Setext)Heading([1-4])$/.exec(node.name);
      if (headingMatch) {
        out.push(Decoration.line({ class: 'cm-heading cm-heading-' + headingMatch[1] }).range(doc.lineAt(node.to).from));
      } else if (node.name === 'Paragraph' && node.node.parent && node.node.parent.name === 'Document') {
        const firstLine = doc.lineAt(node.from).number;
        const lastLine = doc.lineAt(node.to).number;
        for (let ln = firstLine; ln <= lastLine; ln++) {
          out.push(Decoration.line({ class: 'cm-paragraph-line' }).range(doc.line(ln).from));
        }
      }
    },
  });

  out.sort((a, b) => a.from - b.from);
  return Decoration.set(out, true);
}

export const blockSpacingPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
  }
}, { decorations: v => v.decorations });

export function injectBlockSpacingStyle() {
  if (document.getElementById('bt-block-spacing')) return;
  const style = document.createElement('style');
  style.id = 'bt-block-spacing';
  style.textContent = `
.cm-line.cm-heading-1 { padding-bottom: 0.7em; }
.cm-line.cm-heading-2 { padding-bottom: 0.55em; }
.cm-line.cm-heading-3 { padding-bottom: 0.4em; }
.cm-line.cm-heading-4 { padding-bottom: 0.3em; }
.cm-line.cm-paragraph-line { padding-bottom: 1em; }
`;
  document.head.appendChild(style);
}
