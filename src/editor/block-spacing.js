import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import { editorModeField } from './mode-state.js';
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

// Asymmetric rhythm around headings (typography-rhythm.md #2): a heading
// sits close to what it introduces and far from what precedes it, at every
// level — a chapter title before its first scene heading gets the same
// tight treatment as a scene heading before its own first paragraph, since
// both are "the heading's own content," not a new section starting. So the
// gap AFTER any heading line is always tight, regardless of what follows it
// (nested heading or prose); the gap BEFORE a heading — i.e. the trailing
// spacer on whatever paragraph precedes it — is bumped to the large,
// section-break gap instead of the ordinary paragraph-to-paragraph one.
// (Scene-break markers, ---/***/___, aren't part of this: their own fixed-
// height ornament, see scene-breaks.js, already governs the space around
// them independently of this rhythm system.)
const SPACERS = {
  paragraph: new BlockSpacerWidget('paragraph', 15),
  paragraphBeforeHeading: new BlockSpacerWidget('paragraph-before-heading', 57),
  headingTight: new BlockSpacerWidget('heading-tight', 12),
};

const NAMED_SCENE_RE = /^(?!<!--\s*(?:BOOK TITLE:|COLD STORAGE|SCENE LINK|SCENE GROUP:))<!--\s*(.+?)\s*-->$/;
const isHeading = text => HEADING_LINE_RE.test(text) || NAMED_SCENE_RE.test(text.trim());
const HEADING_LINE_RE = /^\s{0,3}(#{1,4})(?:\s+|$)/;

function nextNonBlankLineText(doc, afterLineNumber) {
  for (let n = afterLineNumber + 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (text.trim() !== '') return text;
  }
  return null;
}

function previousNonBlankLineText(doc, beforeLineNumber) {
  for (let n = beforeLineNumber - 1; n >= 1; n--) {
    const text = doc.line(n).text;
    if (text.trim() !== '') return text;
  }
  return null;
}

const isStructuralText = (text) => {
  if (!text) return false;
  const trimmed = text.trim();
  return HEADING_LINE_RE.test(text)
    || /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)
    || /^<!--.*-->$/.test(trimmed);
};

function build(state) {
  const doc = state.doc;
  const out = [];

  // Do not depend on syntaxTree() here. Immediately after loading a large
  // file its background parser may only cover the beginning of the document,
  // which previously left later paragraphs with no spacing at all. This
  // lightweight block scan is complete and deterministic in one pass.
  const prettyManuscript = state.field(editorModeField, false);
  // Blank lines are editable document content. Never replace them with
  // zero-height widgets: Enter must leave a visible, stable caret target.
  let afterHeading = false;
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    const trimmed = line.text.trim();
    const heading = line.text.match(HEADING_LINE_RE) || (prettyManuscript && NAMED_SCENE_RE.test(trimmed) ? ['', '##'] : null);
    const structural = /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)
      || /^<!--.*-->$/.test(trimmed);

    if (!trimmed) {
      // Source Markdown conventionally puts blank lines around headings and
      // scene markers. Those lines are separators, not additional writable
      // paragraphs; the structural spacer attached to the neighboring block
      // already supplies the intended rhythm. Keep the line visible while
      // it owns the caret so Enter remains a reliable writing target.
      const previous = previousNonBlankLineText(doc, number);
      const next = nextNonBlankLineText(doc, number);
      const cursorOnLine = state.selection.ranges.some((range) => range.from >= line.from && range.from <= line.to);
      if (!cursorOnLine && (isStructuralText(previous) || isStructuralText(next))) {
        out.push(Decoration.line({ class: 'cm-structural-blank' }).range(line.from));
      }
      continue;
    } else if (heading) {
      afterHeading = true;
      const level = String(heading[1].length);
      out.push(Decoration.line({ class: 'cm-heading cm-heading-' + level }).range(line.from));
      out.push(Decoration.widget({ widget: SPACERS.headingTight, block: true, side: 1 }).range(line.to));
    } else if (structural) {
      continue;
    } else {
      const epigraph = afterHeading && /^\s{0,3}>/.test(line.text);
      if (!epigraph) afterHeading = false;
      out.push(Decoration.line({ class: epigraph ? 'cm-paragraph-line cm-epigraph' : 'cm-paragraph-line' }).range(line.from));
      // Baretext's manuscript convention treats every nonblank prose source
      // line as a paragraph, including single-newline-separated prose. The
      // spacer sits after the logical source line, so browser-wrapped visual
      // lines remain continuous inside that paragraph. A paragraph that's
      // the last thing before a heading gets the large section-break gap
      // instead of the ordinary one — the heading is starting a new section,
      // not continuing this one.
      const next = nextNonBlankLineText(doc, number);
      const nextIsHeading = next !== null && isHeading(next);
      out.push(Decoration.widget({
        widget: nextIsHeading ? SPACERS.paragraphBeforeHeading : SPACERS.paragraph,
        block: true, side: 1,
      }).range(line.to));
    }
  }

  return Decoration.set(out, true);
}

// A StateField is required for block decorations. It also keeps one stable
// height-aware set until the document actually changes.
export const blockSpacingPlugin = StateField.define({
  create: (state) => build(state),
  update: (value, tr) => (tr.docChanged || tr.selectionSet || tr.state.field(editorModeField, false) !== tr.startState.field(editorModeField, false) ? build(tr.state) : value.map(tr.changes)),
  provide: (field) => EditorView.decorations.from(field),
});

export function injectBlockSpacingStyle() {
  injectStyleTag('bt-block-spacing', `
.cm-block-spacer { display: block; width: 1px; pointer-events: none; }
.cm-structural-blank { height: 0 !important; line-height: 0 !important; overflow: hidden; }
.cm-block-spacer-paragraph { height: 1em; }
html[data-mode="editor"] .cm-heading-1 { text-wrap: pretty; letter-spacing: -.01em; }
html[data-mode="editor"] .cm-epigraph { font-size: 14px; line-height: 1.7; font-style: italic; }
html[data-mode="editor"] .cm-kicker { font: 400 10px/1.4 var(--font-mono); text-transform: uppercase; letter-spacing: .14em; }
/* Tight below any heading (~12px, well under one baseline unit) and large
   above one (~57px, roughly 2 baseline units at the 15px/1.9 body rhythm)
   -- see typography-rhythm.md #2. Fixed px, not em, so the gap stays
   consistent regardless of which heading level (or the much larger book/
   chapter title) is involved. */
.cm-block-spacer-heading-tight { height: 12px; }
.cm-block-spacer-paragraph-before-heading { height: 57px; }
`);
}
