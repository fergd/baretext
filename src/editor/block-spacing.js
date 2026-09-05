import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import { injectStyle as injectStyleTag } from '../dom.js';

// Vertical rhythm must be represented in CodeMirror's block model. Applying
// padding/margins directly to thousands of virtualized .cm-line elements
// makes the height oracle oscillate as distant lines enter the viewport,
// producing blank phantom regions during scrollbar drags.
class BlockSpacerWidget extends WidgetType {
  constructor(kind, estimatedHeight) {
    super();
    this.kind = kind;
    this.height = estimatedHeight;
  }
  eq(other) { return other.kind === this.kind; }
  get estimatedHeight() { return this.height; }
  toDOM() {
    const spacer = document.createElement('div');
    spacer.className = 'cm-block-spacer cm-block-spacer-' + this.kind;
    spacer.setAttribute('aria-hidden', 'true');
    return spacer;
  }
  ignoreEvent() { return true; }
}

const SPACERS = {
  paragraph: new BlockSpacerWidget('paragraph', 15),
  heading1: new BlockSpacerWidget('heading-1', 10.5),
  heading2: new BlockSpacerWidget('heading-2', 8.25),
  heading3: new BlockSpacerWidget('heading-3', 6),
  heading4: new BlockSpacerWidget('heading-4', 4.5),
};

function build(state) {
  const doc = state.doc;
  const out = [];

  // Do not depend on syntaxTree() here. Immediately after loading a large
  // file its background parser may only cover the beginning of the document,
  // which previously left later paragraphs with no spacing at all. This
  // lightweight block scan is complete and deterministic in one pass.
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    const trimmed = line.text.trim();
    const heading = line.text.match(/^\s{0,3}(#{1,4})(?:\s+|$)/);
    const structural = /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)
      || /^<!--.*-->$/.test(trimmed);

    if (!trimmed) {
      continue;
    } else if (heading) {
      const level = String(heading[1].length);
      out.push(Decoration.line({ class: 'cm-heading cm-heading-' + level }).range(line.from));
      out.push(Decoration.widget({ widget: SPACERS['heading' + level], block: true, side: 1 }).range(line.to));
    } else if (structural) {
      continue;
    } else {
      out.push(Decoration.line({ class: 'cm-paragraph-line' }).range(line.from));
      // Baretext's manuscript convention treats every nonblank prose source
      // line as a paragraph, including single-newline-separated prose. The
      // spacer sits after the logical source line, so browser-wrapped visual
      // lines remain continuous inside that paragraph.
      out.push(Decoration.widget({ widget: SPACERS.paragraph, block: true, side: 1 }).range(line.to));
    }
  }

  return Decoration.set(out, true);
}

// A StateField is required for block decorations. It also keeps one stable
// height-aware set until the document actually changes.
export const blockSpacingPlugin = StateField.define({
  create: (state) => build(state),
  update: (value, tr) => (tr.docChanged ? build(tr.state) : value.map(tr.changes)),
  provide: (field) => EditorView.decorations.from(field),
});

export function injectBlockSpacingStyle() {
  injectStyleTag('bt-block-spacing', `
.cm-block-spacer { display: block; width: 1px; pointer-events: none; }
.cm-block-spacer-paragraph { height: 1em; }
.cm-block-spacer-heading-1 { height: 0.7em; }
.cm-block-spacer-heading-2 { height: 0.55em; }
.cm-block-spacer-heading-3 { height: 0.4em; }
.cm-block-spacer-heading-4 { height: 0.3em; }
`);
}
