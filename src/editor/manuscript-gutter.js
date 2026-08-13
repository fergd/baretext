import { Decoration, EditorView, WidgetType, ViewPlugin } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import { injectStyle as injectStyleTag } from '../dom.js';

// Right-aligned chapter/scene number, hung in the left margin next to
// wherever that chapter/scene's own heading (or heading-equivalent) lands —
// see MANUSCRIPT_SURFACE.md. Hidden entirely in Sprinter mode and under
// 900px via CSS only (index.html), so nothing here needs to know the app's
// current mode.
//
// Two earlier approaches to positioning this were tried and both failed on
// real documents, not just synthetic tests:
//  1. Pure CSS (`position: absolute; top: 0`, matching font-size/line-height
//     between the number and its target): fails because a CodeMirror line's
//     own line box is governed by the block's *inherited* line-height
//     (--lh-body, sized for 15px body text), and a much larger heading-sized
//     inline span sitting inside it produces a top-of-line-box-to-top-of-
//     glyph gap that isn't a fixed, reproducible constant — measured at
//     three different values in three different directions across three
//     cases that all used matching CSS.
//  2. JS-measured top (getBoundingClientRect()/Range on the target, then
//     setting the number's own top to match): fixed the three cases above,
//     but is still wrong whenever the target text's tallest glyph (an
//     ascender like "t"/"l", or a cap letter) is a different height than
//     the number's own digit glyphs — matching *bounding-box tops* doesn't
//     guarantee matching *baselines* unless every character involved has
//     identical ascent, which digits and mixed-case heading text don't.
//     "It Begins", "January 22, 2026" etc. still came out visibly
//     misaligned despite the measured top matching to a sub-pixel delta —
//     the test that delta was checked against was tautological (it only
//     proved the code did what it meant to, not that "matching tops" was
//     the right thing to match).
//
// The only thing that actually gets a baseline right in every case,
// because it's the browser's own text-layout engine doing it (not a
// reimplementation of font-metric math): make the number genuinely INLINE
// content sharing the same line box as its target text, and let normal CSS
// baseline alignment do the rest. The catch is that a real inline DOM node
// would show up in .cm-line's own textContent, which several things
// (E2E `.cm-line`-text-matching assertions chief among them) assume is
// exactly the document's own text. Solved the same way scene-breaks.js
// already solves an analogous problem for the scene-name caption: give the
// widget span NO real text content, and render the digits via a
// `content: attr(data-gutter-num)` ::before — CSS-generated content is
// never part of .textContent, so the span can be a real inline sibling of
// the heading text (correct baseline, for free) while staying textContent-
// invisible. Pulled out into the left margin with a negative left margin,
// not absolute positioning, specifically so it stays part of normal inline
// flow instead of being pulled out of the baseline computation.
//
// This only applies to the two "heading-like" kinds (chapter, scene) —
// baseline alignment is the goal there. An unnamed scene's number sits next
// to an *ornament*, not text, where the actual goal is vertical centering
// in a fixed-height line; that keeps the older block-widget +
// measured-center approach (never reported broken, and centering only
// needs matching midpoints, not glyph baselines, so the earlier method's
// failure mode doesn't apply to it).
class InlineGutterNumberWidget extends WidgetType {
  constructor(text, kind) { super(); this.text = text; this.kind = kind; }
  eq(other) { return other.text === this.text && other.kind === this.kind; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-gutter-num-inline cm-gutter-num-' + this.kind;
    span.setAttribute('aria-hidden', 'true');
    span.setAttribute('data-gutter-num', this.text);
    return span;
  }
  ignoreEvent() { return true; }
}

class OrnamentGutterNumberWidget extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(other) { return other.text === this.text; }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-gutter-num-wrap';
    const span = document.createElement('span');
    span.className = 'cm-gutter-num cm-gutter-num-ornament';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = this.text;
    wrap.appendChild(span);
    return wrap;
  }
  ignoreEvent() { return true; }
}

// side: -2, one below scene-breaks.js's SceneNameWidget (-1) — on a named
// scene's line, both widgets sit at the same position (line.from); CodeMirror
// orders same-position widgets by side ascending, so this guarantees the
// number renders first regardless of which plugin's decorations happen to
// merge first.
function inlineGutterWidget(text, kind) {
  return Decoration.widget({ widget: new InlineGutterNumberWidget(text, kind), side: -2 });
}
function ornamentGutterWidget(text) {
  return Decoration.widget({ widget: new OrnamentGutterNumberWidget(text), side: -1, block: true });
}

const NAME_COMMENT_RE = /^<!--\s*(.*?)\s*-->$/;
const HEADING_RE = /^(#{1,3})(?:[ \t]+.*)?$/;
const MARKER_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const COLD_STORAGE_MARKER = '<!-- COLD STORAGE -->';

// Mirrors outline.js's numbering exactly (chapter count resets scene count;
// ##/### headings and --- markers both increment it; the implicit first
// scene counts as 1) so the gutter always agrees with the rail/corkboard.
// Kept as its own local scan for the same reason scene-breaks.js is: this
// only needs line numbers to hang a widget from, not the full outline model.
function build(state) {
  const doc = state.doc;
  const decos = [];
  let chapterNum = 0;
  let sceneNum = 0;
  let awaitingFirstContent = false;
  let pendingNameLine = null;

  const addInline = (line, text, kind) => decos.push(inlineGutterWidget(text, kind).range(line.from));
  const addOrnament = (line, text) => decos.push(ornamentGutterWidget(text).range(line.from));

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const trimmed = line.text.trim();

    // Cold Storage (scene-nav/model.js) isn't part of the manuscript's own
    // chapter/scene numbering — word count and the rail's "N ch" count
    // already exclude it, and this scan (which doesn't know about the
    // coldStorage flag, only raw doc text) needs the same cutoff: without
    // it, numbering silently continued as if Cold Storage's scenes
    // belonged to whatever chapter happened to precede the marker.
    if (trimmed === COLD_STORAGE_MARKER) break;

    const h = line.text.match(HEADING_RE);

    if (h) {
      const level = h[1].length;
      pendingNameLine = null;
      if (level === 1) {
        chapterNum++; sceneNum = 0; awaitingFirstContent = true;
        addInline(line, String(chapterNum), 'chapter');
      } else {
        sceneNum++; awaitingFirstContent = false;
        addInline(line, chapterNum + '.' + sceneNum, 'scene');
      }
      continue;
    }
    if (MARKER_RE.test(trimmed)) {
      sceneNum++;
      awaitingFirstContent = false;
      const next = i + 1 <= doc.lines ? doc.line(i + 1) : null;
      const m = next && next.text.trim().match(NAME_COMMENT_RE);
      if (m) addInline(next, chapterNum + '.' + sceneNum, 'scene');
      else addOrnament(line, chapterNum + '.' + sceneNum);
      continue;
    }
    if (awaitingFirstContent) {
      const m = trimmed.match(NAME_COMMENT_RE);
      if (m) { pendingNameLine = line; continue; }
      if (trimmed !== '') {
        sceneNum = 1;
        if (pendingNameLine) addInline(pendingNameLine, chapterNum + '.' + sceneNum, 'scene');
        awaitingFirstContent = false;
        pendingNameLine = null;
      }
    }
  }
  return Decoration.set(decos, true);
}

// A StateField, not a ViewPlugin, because the ornament widget's block
// decoration is only allowed from a field; CodeMirror throws "Block
// decorations may not be specified via plugins" otherwise (the inline
// chapter/scene widgets don't strictly need this, but both kinds are
// produced by the same scan, so both come from the same field). build()
// scans the whole document unconditionally (never viewport-limited), so a
// doc-change is the only thing that can ever change the result.
export const manuscriptGutterPlugin = StateField.define({
  create: (state) => build(state),
  update: (value, tr) => (tr.docChanged ? build(tr.state) : value.map(tr.changes)),
  provide: (f) => EditorView.decorations.from(f),
});

// Only the ornament case still needs runtime positioning — it's centered
// in a fixed-height (2.6em) line rather than baseline-aligned with text,
// which a bounding-box measurement gets right (matching a midpoint doesn't
// have the ascender/descender failure mode matching a baseline does).
function alignOrnamentNumbers(view) {
  const wraps = view.dom.querySelectorAll('.cm-gutter-num-wrap');
  for (const wrap of wraps) {
    const num = wrap.querySelector('.cm-gutter-num');
    const line = wrap.nextElementSibling;
    if (!num || !line) continue;
    const lineRect = line.getBoundingClientRect();
    const wrapTop = wrap.getBoundingClientRect().top;
    num.style.top = (lineRect.top + lineRect.height / 2 - wrapTop) + 'px';
    num.style.transform = 'translateY(-50%)';
  }
}

export const manuscriptGutterAlignPlugin = ViewPlugin.fromClass(class {
  constructor(view) { alignOrnamentNumbers(view); }
  update(update) {
    if (update.docChanged || update.geometryChanged || update.viewportChanged) {
      alignOrnamentNumbers(update.view);
    }
  }
});

export function injectManuscriptGutterStyle() {
  injectStyleTag('bt-manuscript-gutter', `
/* Chapter/scene numbers: real inline siblings of their heading text (see
   the file-level comment above for why) — genuinely in the line's normal
   flow, pulled into the left margin with a negative margin rather than
   absolute positioning so the browser's own baseline alignment still
   applies. No text content of their own (content: attr(...) on ::before
   only), so .cm-line.textContent is never affected by these existing. */
.cm-gutter-num-inline { display: none; }
html[data-mode="editor"] .cm-gutter-num-inline {
  display: inline-block; vertical-align: baseline;
  width: var(--gutter, 88px);
  /* margin-left pulls the whole box (gutter + gap) into the margin;
     margin-right gives back the gap so the box's own width doesn't also
     shift whatever inline content follows it on the line — net horizontal
     footprint is zero, so the heading text starts exactly where it would
     if this element didn't exist. */
  margin-left: calc(-1 * (var(--gutter, 88px) + var(--gap, 40px)));
  margin-right: var(--gap, 40px);
  /* color: ... !important — on a named scene's line this widget is a real
     DOM child of .cm-scene-name-comment, and scene-breaks.js hides that
     line's own (real, invisible) text with a ".cm-scene-name-comment *
     { color: transparent !important }" wildcard that catches this too. */
  text-align: right; color: var(--text-dimmer) !important; font-variant-numeric: lining-nums;
  pointer-events: none; user-select: none;
}
html[data-mode="editor"] .cm-gutter-num-inline::before { content: attr(data-gutter-num); }
html[data-mode="editor"] .cm-gutter-num-inline.cm-gutter-num-chapter { font-size: 56px; font-weight: 400; line-height: 1.05; }
html[data-mode="editor"] .cm-gutter-num-inline.cm-gutter-num-scene   { font-size: 28px; font-weight: 400; line-height: 1.1; }

/* Unnamed-scene ornament number: a block widget, centered at runtime by
   manuscriptGutterAlignPlugin (see above) against the ornament's own
   fixed-height line rather than any text baseline. */
.cm-gutter-num-wrap { position: relative; height: 0; }
.cm-gutter-num {
  display: none; position: absolute; right: calc(100% + var(--gap, 40px)); top: 0;
  width: var(--gutter, 88px); text-align: right; color: var(--text-dimmer);
  font-variant-numeric: lining-nums; pointer-events: none; user-select: none;
}
html[data-mode="editor"] .cm-gutter-num { display: block; }
html[data-mode="editor"] .cm-gutter-num-ornament { font-size: 28px; font-weight: 400; line-height: 1.1; }

/* Not enough left margin to hang the numbers below this width — must be
   the last rules in this stylesheet (same specificity as the display:block/
   inline-block rules above; later wins) to correctly override them inside
   the narrow range. */
@media (max-width: 900px) {
  html[data-mode="editor"] .cm-gutter-num-inline { display: none; }
  html[data-mode="editor"] .cm-gutter-num { display: none; }
}
`);
}
