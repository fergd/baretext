import { isLinkMetadata } from '../features/scene-nav/links.js';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { EditorSelection, EditorState, StateField } from '@codemirror/state';
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

const NAME_COMMENT_RE = /^(?!<!-- SCENE (?:LINK|GROUP: [a-zA-Z0-9-]+) -->$)<!--\s*(.*?)\s*-->$/;
const BOOK_TITLE_RE = /^<!--\s*BOOK TITLE:\s*.*?\s*-->$/;
const MARKER_RE = /^(-{3,}|\*{3,}|_{3,})$/;

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
    if (isLinkMetadata(trimmed)) continue;
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
    // build() scans the whole document. Its result cannot change merely
    // because a different part of that document entered the viewport.
    if (update.docChanged) this.decorations = build(update.view);
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
    if (isLinkMetadata(trimmed)) continue;
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

// Confirmed live: atomicRanges (above) governs keyboard cursor MOTION over
// the marker/comment chrome, but a mouse click's own position resolution
// still snaps into the atomic range's NEAR edge -- i.e. the marker line's
// own start -- rather than jumping past it the way arrowing through does.
// Every click anywhere along a "---" line (confirmed across its full
// width) landed the caret on the marker itself, one keystroke away from
// deleting it. Scene/chapter dividers are never meant to be directly
// editable at all (see scene-boundary-guard.js's Backspace protection for
// the deletion half of this) -- clicking one should behave exactly like
// tapping that scene in the rail: land on its first real content line, or
// just past the marker/comment if it's still an empty draft with nothing
// typed into it yet. Mirrors scene-nav/model.js's firstProsePos, redone
// locally against view.state.doc rather than importing across the editor/
// features boundary (same duplication precedent as scene-boundary-guard.js's
// contentStartFor).
export function safeCaretLine(doc, clickedLineNum) {
  // The click may have landed on the marker line itself or, if named, its
  // adjacent comment line right after -- normalize to the marker's own
  // line number either way so the scan below always starts from the same
  // place.
  let markerLineNum = clickedLineNum;
  if (!MARKER_RE.test(doc.line(clickedLineNum).text.trim()) && clickedLineNum > 1) {
    const prev = doc.line(clickedLineNum - 1);
    if (MARKER_RE.test(prev.text.trim())) markerLineNum = clickedLineNum - 1;
  }
  let n = markerLineNum + 1;
  if (n <= doc.lines && NAME_COMMENT_RE.test(doc.line(n).text.trim())) n++;
  const preambleEndLine = Math.min(n, doc.lines);
  for (let i = n; i <= doc.lines; i++) {
    const text = doc.line(i).text;
    const trimmed = text.trim();
    if (trimmed === '' || isLinkMetadata(trimmed)) continue;
    if (/^#{1,3}(?:[ \t]|$)/.test(text) || MARKER_RE.test(trimmed) || trimmed === '<!-- COLD STORAGE -->') break;
    return i; // real content found
  }
  return preambleEndLine; // still empty -- land right after the preamble
}

// The atomic range above still leaves its own START -- the marker line's
// first position -- as a legal caret stop, and that spot is invisible
// chrome: the caret draws alone in the gap before the next scene (centered,
// since the marker line is text-align:center) and anything typed there lands
// on the "---" line itself, breaking the scene boundary. Confirmed reachable
// by arrowing down out of a scene's last paragraph and by clicking the
// spacing above a named scene's heading (the click resolves inside the
// atomic comment line and snaps to that near edge). No empty cursor may
// rest there: moving backward (up/left) lands at the end of the line before
// the marker; anything else (moving forward, clicks, programmatic jumps)
// lands where clicking the break would, the next scene's first real line.
export function relocateMarkerStartCursor(state, previousHead) {
  const sel = state.selection;
  let changed = false;
  const ranges = sel.ranges.map((range) => {
    if (!range.empty) return range;
    const line = state.doc.lineAt(range.head);
    if (range.head !== line.from || !MARKER_RE.test(line.text.trim())) return range;
    changed = true;
    const movingBack = previousHead != null && previousHead > range.head && line.from > 0;
    const target = movingBack ? line.from - 1 : state.doc.line(safeCaretLine(state.doc, line.number)).from;
    return EditorSelection.cursor(target);
  });
  return changed ? EditorSelection.create(ranges, sel.mainIndex) : null;
}

export const sceneBreakCursorGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection && !tr.docChanged) return tr;
  const relocated = relocateMarkerStartCursor(tr.state, tr.startState.selection.main.head);
  if (!relocated) return tr;
  return [tr, { selection: relocated, sequential: true }];
});

export function sceneBreakClickGuard() {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      const lineEl = event.target.closest && event.target.closest('.cm-line');
      if (!lineEl || !(lineEl.classList.contains('cm-scene-break') || lineEl.classList.contains('cm-scene-name-comment'))) {
        return false;
      }
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const doc = view.state.doc;
      const targetLine = doc.line(safeCaretLine(doc, doc.lineAt(pos).number));
      event.preventDefault();
      view.dispatch({ selection: { anchor: targetLine.from } });
      view.focus();
      return true;
    },
  });
}

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
   marker shows the accent line-and-circle ornament, every name is a small
   italic caption.
   A within-scene break (unnamed marker) instead reads as a centered, widely
   tracked "· · ·" in --text-dimmer, not a rule or an icon (typography-
   rhythm.md #4) -- ::before is repurposed to render the dots as generated
   content (resetting every geometry property the shared rule above set for
   the line ornament) and ::after's circle is dropped entirely. */
html[data-mode="editor"] .cm-scene-break:not(.cm-scene-break-named)::before {
  content: '· · ·'; width: auto; height: auto; background: none;
  color: var(--text-dimmer); font-family: var(--font-mono); font-size: 15px;
  letter-spacing: .6em;
}
html[data-mode="editor"] .cm-scene-break:not(.cm-scene-break-named)::after {
  display: none;
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

  let changeFrom = from;
  let changeTo = to;
  let insert = '';
  if (atLineStart) {
    // The newline(s) before a line already provide the line break leading
    // into it. Replacing that whole run avoids creating two blank paragraphs
    // before a marker. Empty lines also own a trailing newline; consume the
    // contiguous run so it cannot survive as extra space after the marker.
    while (changeFrom > 0 && view.state.doc.sliceString(changeFrom - 1, changeFrom) === '\n') changeFrom--;
    if (lineIsEmpty) {
      changeTo = Math.max(changeTo, line.to);
      if (changeTo < view.state.doc.length) changeTo++;
      while (changeTo < view.state.doc.length && view.state.doc.sliceString(changeTo, changeTo + 1) === '\n') changeTo++;
    }
    insert = (changeFrom > 0 ? '\n\n' : '') + '---\n\n';
  } else {
    insert = '\n\n---\n\n';
  }

  view.dispatch({
    changes: { from: changeFrom, to: changeTo, insert },
    // Keep the document's trailing blank line, but place the caret at its
    // start.  That is the first writable line of the new scene; placing it
    // after the final newline made Cmd+Enter appear to skip a line.
    selection: { anchor: changeFrom + insert.length - 1 },
  });
  view.focus();
  return true;
}
