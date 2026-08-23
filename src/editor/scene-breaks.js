import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import { injectStyle as injectStyleTag } from '../dom.js';

const sceneBreakLine = Decoration.line({ class: 'cm-scene-break' });
// A marker immediately followed by a name comment gets this extra class so
// Editor-mode CSS can suppress its ornament (the name renders as a heading
// instead — see MANUSCRIPT_SURFACE.md's "named vs unnamed" scene
// treatment). Sprinter mode ignores the extra class and keeps showing the
// ornament for every marker, named or not, same as before this feature.
const sceneBreakNamedLine = Decoration.line({ class: 'cm-scene-break cm-scene-break-named' });
const nameCommentLine = Decoration.line({ class: 'cm-scene-name-comment' });

// The visible name itself — a WIDGET, not a line-level `content: attr(...)`
// pseudo-element as this used to be. Reason: a `::before` pseudo is always
// the structurally-first box in its host, ahead of any real DOM child no
// matter where that child is inserted — which made it impossible for
// manuscript-gutter.js's gutter-number widget (also inserted on this same
// line, needs to render visually first) to reliably come "before" it. As a
// widget, ordering between the two is just their `side` values (see
// manuscript-gutter.js: -2 for the number, -1 here) instead of an
// unwindable CSS structural constant. Uses the exact same "empty real text,
// content: attr(...) on its own ::before" trick as the number widget, for
// the same reason: a real DOM node with real text would show up in
// .cm-line.textContent, which the E2E suite's exact line-text assertions
// depend on staying exactly the document's own text.
class SceneNameWidget extends WidgetType {
  constructor(name) { super(); this.name = name; }
  eq(other) { return other.name === this.name; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-scene-name-label';
    span.setAttribute('aria-hidden', 'true');
    span.setAttribute('data-scene-name', this.name);
    return span;
  }
  ignoreEvent() { return true; }
}
function nameWidget(name) {
  return Decoration.widget({ widget: new SceneNameWidget(name), side: -1 });
}

const NAME_COMMENT_RE = /^<!--\s*(.*?)\s*-->$/;
const BOOK_TITLE_RE = /^<!--\s*BOOK TITLE:\s*.*?\s*-->$/;

// Kept independent of outline.js on purpose — this only ever needs to know
// "hide this line, show that instead," not the full chapter/scene model
// outline.js builds for scene-nav, so a light local scan (heading / marker /
// first-content-after-a-chapter-heading) is enough, mirroring outline.js's
// own scan closely enough to land on the same lines.
function build(view) {
  const doc = view.state.doc;
  const decos = [];
  let awaitingFirstContent = false;

  const addName = (line, name) => {
    decos.push(nameCommentLine.range(line.from));
    decos.push(nameWidget(name).range(line.from));
  };

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const trimmed = line.text.trim();
    if (i === 1 && BOOK_TITLE_RE.test(trimmed)) continue;
    const headingMatch = line.text.match(/^(#{1,3})(?:[ \t]+.*)?$/);

    if (headingMatch) {
      awaitingFirstContent = headingMatch[1].length === 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      awaitingFirstContent = false;
      let named = false;
      if (i + 1 <= doc.lines) {
        const next = doc.line(i + 1);
        const m = next.text.trim().match(NAME_COMMENT_RE);
        if (m) { addName(next, m[1]); named = true; }
      }
      decos.push((named ? sceneBreakNamedLine : sceneBreakLine).range(line.from));
      continue;
    }
    if (awaitingFirstContent) {
      const m = trimmed.match(NAME_COMMENT_RE);
      if (m) { addName(line, m[1]); continue; }
      if (trimmed !== '') awaitingFirstContent = false;
    }
  }
  return Decoration.set(decos, true);
}

// Tags any line that's just ---/***/___ (3+) with .cm-scene-break; the raw
// dashes are visually hidden by CSS in favor of a centered rule + dot
// ornament, while staying selectable/editable (caret still shows).
export const sceneBreakDecorator = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
  }
}, { decorations: v => v.decorations });

// Marker lines ("---") and their name-comment line ("<!-- Name -->", when
// present) are pure chrome — real, editable document text kept invisible
// behind the ornament/heading widgets above (see SceneNameWidget's own
// comment for why the raw text has to stay real rather than being replaced
// outright: E2E's exact .cm-line-text assertions depend on it). Because
// that invisible text is still really there, the caret could rest partway
// through it — confirmed bug: arrowing down from the previous scene, or
// clicking near a scene heading, could land the caret mid-comment (visually
// well past where the rendered heading text ends, since "Doc Interrogation"
// the widget and "<!-- Doc Interrogation -->" the real text aren't the same
// length). Marking each marker(+name-comment) pair as one atomic range for
// cursor motion means arrowing/clicking always jumps clean over the whole
// unit, landing on the real content before or after it instead. The range's
// end is pushed one further, onto the very first position of the following
// line (not the chrome's own last line) — ending it AT the chrome's own
// last character left that position itself as a legal (non-atomic)
// boundary, which is still real invisible text and stops the caret exactly
// as visually adrift as the original bug, just at the far edge instead of
// the middle of it. Landing on real content's own first line is the only
// boundary that isn't itself part of the invisible span.
function buildAtomicRanges(state) {
  const doc = state.doc;
  const docLength = doc.length;
  const ranges = [];
  let awaitingFirstContent = false;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const trimmed = line.text.trim();
    if (i === 1 && BOOK_TITLE_RE.test(trimmed)) continue;
    const headingMatch = line.text.match(/^(#{1,3})(?:[ \t]+.*)?$/);

    if (headingMatch) {
      awaitingFirstContent = headingMatch[1].length === 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      awaitingFirstContent = false;
      let chromeEnd = line.to;
      if (i + 1 <= doc.lines) {
        const next = doc.line(i + 1);
        if (NAME_COMMENT_RE.test(next.text.trim())) chromeEnd = next.to;
      }
      ranges.push(Decoration.mark({}).range(line.from, Math.min(chromeEnd + 1, docLength)));
      continue;
    }
    if (awaitingFirstContent) {
      if (NAME_COMMENT_RE.test(trimmed)) {
        ranges.push(Decoration.mark({}).range(line.from, Math.min(line.to + 1, docLength)));
        continue;
      }
      if (trimmed !== '') awaitingFirstContent = false;
    }
  }
  return Decoration.set(ranges, true);
}

export const sceneBreakAtomicRanges = StateField.define({
  create: (state) => buildAtomicRanges(state),
  update: (value, tr) => (tr.docChanged ? buildAtomicRanges(tr.state) : value.map(tr.changes)),
  provide: (f) => EditorView.atomicRanges.from(f, (ranges) => () => ranges),
});

export function injectSceneBreakStyle() {
  injectStyleTag('bt-scene-break', `
.cm-scene-break {
  position: relative; color: transparent !important; caret-color: var(--cursor) !important;
  text-align: center; height: 2.6em;
}
.cm-scene-break * { color: transparent !important; }
.cm-scene-break::before {
  content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 64px; height: 1.5px; background: var(--accent); opacity: 0.6; pointer-events: none;
}
.cm-scene-break::after {
  content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 9px; height: 9px; border-radius: 50%;
  border: 1.5px solid var(--accent); background: var(--bg); pointer-events: none;
}
.cm-scene-name-comment {
  position: relative; color: transparent !important; caret-color: var(--cursor) !important;
  text-align: center; height: 1.7em;
}
.cm-scene-name-comment * { color: transparent !important; }
/* Sprinter's look (default): a small italic caption, absolutely centered —
   the widget mimics exactly what the line-level ::before it replaced used
   to do, so Sprinter mode is unaffected by moving this to a widget.
   color: ... !important — this widget is a real DOM child of
   .cm-scene-name-comment, and the ".cm-scene-name-comment *
   { color: transparent !important }" rule above (there to hide the line's
   own real, invisible <!-- --> text) would otherwise catch it too. */
.cm-scene-name-label {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  color: var(--text-dimmer) !important; font-size: 11px; font-style: italic; white-space: nowrap;
  pointer-events: none;
}
.cm-scene-name-label::before { content: attr(data-scene-name); }

/* Manuscript surface — Editor mode only (MANUSCRIPT_SURFACE.md "named vs
   unnamed" scenes). Sprinter mode keeps the rules above unchanged: every
   marker shows the accent ornament, every name is a small italic caption. */
html[data-mode="editor"] .cm-scene-break:not(.cm-scene-break-named)::before {
  background: var(--scene);
}
html[data-mode="editor"] .cm-scene-break:not(.cm-scene-break-named)::after {
  border-color: var(--scene);
}
/* Named scenes render as a heading below (via .cm-scene-name-label) — no
   ornament on the marker line itself, just enough space to read as a break. */
html[data-mode="editor"] .cm-scene-break-named {
  height: 0.8em;
}
html[data-mode="editor"] .cm-scene-break-named::before,
html[data-mode="editor"] .cm-scene-break-named::after {
  display: none;
}
/* The name becomes a real left-aligned scene heading instead of a small
   centered caption — matches the H2 treatment given to actual ## headings.
   position:static (not the Sprinter default's absolute+centered) puts it
   back in normal inline flow, genuinely sharing a line box with
   manuscript-gutter.js's gutter-number widget on this same line — that's
   what lets the browser's own text layout baseline-align the two.
   Matching top/height numerically (an earlier version of this rule tried,
   with explicit height + JS-measured positions) doesn't guarantee matching
   baselines when the compared glyphs have different ascent/descent (a
   digit vs. a name with descenders like "y", ascenders like "t"/"l", etc.)
   — only genuine shared inline flow does, reliably, in every case. */
html[data-mode="editor"] .cm-scene-name-comment {
  text-align: left; height: auto;
}
html[data-mode="editor"] .cm-scene-name-label {
  position: static; transform: none;
  color: var(--text-dim) !important; font-size: var(--ms-h2-size, 28px); font-weight: var(--ms-h2-weight, 400);
  line-height: var(--ms-h2-lh, 1.1); font-style: normal; white-space: normal;
}
`);
}

// Inserts a blank-padded scene break at the caret, adding leading blank
// lines only when needed (not already at the start of an empty line).
export function insertSceneBreak(view) {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const atLineStart = from === line.from;
  const lineIsEmpty = line.text.trim() === '';

  let insert = '';
  if (!lineIsEmpty || !atLineStart) insert += '\n\n';
  insert += '---\n\n';

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  });
  view.focus();
  return true;
}
