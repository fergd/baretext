import { isLinkMetadata } from '../features/scene-nav/links.js';
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
// sceneIndex (scene-kind widgets only) is this widget's position in
// document order among ALL scene numerals — stamped as a data attribute so
// the active-scene highlighter below (see manuscriptGutterActivePlugin) can
// find and mark the right rendered node without assuming every scene's
// widget is currently in the DOM. CodeMirror only renders decorations
// inside (plus a small margin around) the current viewport, so an index
// match against a live querySelectorAll would silently misalign against a
// virtualized-out widget; matching by an embedded id sidesteps that
// entirely, the same way alignOrnamentNumbers below matches ornaments to
// their own next sibling rather than by array position.
class InlineGutterNumberWidget extends WidgetType {
  constructor(text, kind, sceneIndex) { super(); this.text = text; this.kind = kind; this.sceneIndex = sceneIndex; }
  eq(other) { return other.text === this.text && other.kind === this.kind && other.sceneIndex === this.sceneIndex; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-gutter-num-inline cm-gutter-num-' + this.kind;
    span.setAttribute('aria-hidden', 'true');
    span.setAttribute('data-gutter-num', this.text);
    if (this.kind === 'scene') span.dataset.sceneIndex = String(this.sceneIndex);
    return span;
  }
  ignoreEvent() { return true; }
}

class OrnamentGutterNumberWidget extends WidgetType {
  constructor(text, sceneIndex) { super(); this.text = text; this.sceneIndex = sceneIndex; }
  eq(other) { return other.text === this.text && other.sceneIndex === this.sceneIndex; }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-gutter-num-wrap';
    const span = document.createElement('span');
    span.className = 'cm-gutter-num cm-gutter-num-ornament';
    span.setAttribute('aria-hidden', 'true');
    span.dataset.sceneIndex = String(this.sceneIndex);
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
function inlineGutterWidget(text, kind, sceneIndex) {
  return Decoration.widget({ widget: new InlineGutterNumberWidget(text, kind, sceneIndex), side: -2 });
}
function ornamentGutterWidget(text, sceneIndex) {
  return Decoration.widget({ widget: new OrnamentGutterNumberWidget(text, sceneIndex), side: -1, block: true });
}

const NAME_COMMENT_RE = /^(?!<!-- SCENE (?:LINK|GROUP: [a-zA-Z0-9-]+) -->$)<!--\s*(.*?)\s*-->$/;
const HEADING_RE = /^(#{1,3})(?:[ \t]+.*)?$/;
const MARKER_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const COLD_STORAGE_MARKER = '<!-- COLD STORAGE -->';

// Mirrors outline.js's numbering exactly (chapter count resets scene count;
// ##/### headings and --- markers both increment it; the implicit first
// scene counts as 1) so the gutter always agrees with the rail/corkboard.
// Kept as its own local scan for the same reason scene-breaks.js is: this
// only needs line numbers to hang a widget from, not the full outline model.
//
// Alongside the decorations, this also collects every chapter/scene
// boundary's own position in document order (`boundaries`) so scene ranges
// (start of one scene numeral to the start of the next boundary of any
// kind) can be derived afterward — used only by manuscriptGutterActivePlugin
// below to tint the current scene's numeral at full strength (typography-
// rhythm.md #3). Boundaries the scan already tracks internally are enough;
// this doesn't need outline.js's fuller model.
function build(state) {
  const doc = state.doc;
  const decos = [];
  const boundaries = []; // { from, scene: boolean } in document order
  let chapterNum = 0;
  let sceneNum = 0;
  let awaitingFirstContent = false;
  let pendingNameLine = null;
  let sceneCounter = 0;

  const addInline = (line, text, kind, sceneIndex) => {
    decos.push(inlineGutterWidget(text, kind, sceneIndex).range(line.from));
    boundaries.push({ from: line.from, scene: kind === 'scene' });
  };
  const addOrnament = (line, text, sceneIndex) => {
    decos.push(ornamentGutterWidget(text, sceneIndex).range(line.from));
    boundaries.push({ from: line.from, scene: true });
  };

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const trimmed = line.text.trim();
    if (isLinkMetadata(trimmed)) continue;

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
        addInline(line, chapterNum + '.' + sceneNum, 'scene', sceneCounter++);
      }
      continue;
    }
    if (MARKER_RE.test(trimmed)) {
      sceneNum++;
      awaitingFirstContent = false;
      const next = i + 1 <= doc.lines ? doc.line(i + 1) : null;
      const m = next && next.text.trim().match(NAME_COMMENT_RE);
      if (m) addInline(next, chapterNum + '.' + sceneNum, 'scene', sceneCounter++);
      else addOrnament(line, chapterNum + '.' + sceneNum, sceneCounter++);
      continue;
    }
    if (awaitingFirstContent) {
      const m = trimmed.match(NAME_COMMENT_RE);
      if (m) { pendingNameLine = line; continue; }
      if (trimmed !== '') {
        sceneNum = 1;
        if (pendingNameLine) addInline(pendingNameLine, chapterNum + '.' + sceneNum, 'scene', sceneCounter++);
        awaitingFirstContent = false;
        pendingNameLine = null;
      }
    }
  }

  const sceneRanges = [];
  for (let i = 0; i < boundaries.length; i++) {
    if (!boundaries[i].scene) continue;
    const to = i + 1 < boundaries.length ? boundaries[i + 1].from : doc.length;
    sceneRanges.push({ from: boundaries[i].from, to });
  }

  return { decos: Decoration.set(decos, true), sceneRanges };
}

// A StateField, not a ViewPlugin, because the ornament widget's block
// decoration is only allowed from a field; CodeMirror throws "Block
// decorations may not be specified via plugins" otherwise (the inline
// chapter/scene widgets don't strictly need this, but both kinds are
// produced by the same scan, so both come from the same field). build()
// scans the whole document unconditionally (never viewport-limited), so a
// doc-change is the only thing that can ever change the result — when it
// hasn't, tr.changes is an empty/identity changeset, so mapping through it
// is free and sceneRanges (plain from/to numbers, not a RangeSet) needs no
// separate handling.
export const manuscriptGutterPlugin = StateField.define({
  create: (state) => build(state),
  update: (value, tr) => (tr.docChanged ? build(tr.state) : { decos: value.decos.map(tr.changes), sceneRanges: value.sceneRanges }),
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

// Tints the scene numeral containing the cursor at full strength, the rest
// at the idle tint set in CSS (typography-rhythm.md #3) — a post-render DOM
// tweak in the same style as alignOrnamentNumbers below, not a decoration,
// since it only ever toggles one class and doesn't affect layout. Matches
// nodes by their own embedded data-scene-index (see the widget classes
// above) rather than array position against sceneRanges, since CodeMirror
// only renders decorations near the current viewport — an index match
// against whatever's currently in the DOM would silently misalign once any
// scene numeral scrolls out of range.
function updateActiveSceneNumber(view) {
  const { sceneRanges } = view.state.field(manuscriptGutterPlugin);
  const pos = view.state.selection.main.head;
  let activeIndex = -1;
  for (let i = 0; i < sceneRanges.length; i++) {
    if (pos >= sceneRanges[i].from && (pos < sceneRanges[i].to || pos === view.state.doc.length && sceneRanges[i].to === pos)) { activeIndex = i; break; }
  }
  view.dom.querySelectorAll('[data-scene-index]').forEach((node) => {
    node.classList.toggle('cm-gutter-num-active', Number(node.dataset.sceneIndex) === activeIndex);
  });
}

export const manuscriptGutterActivePlugin = ViewPlugin.fromClass(class {
  constructor(view) { updateActiveSceneNumber(view); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      updateActiveSceneNumber(update.view);
    }
  }
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
  text-align: right; font-variant-numeric: lining-nums;
  pointer-events: none; user-select: none;
}
html[data-mode="editor"] .cm-gutter-num-inline::before { content: attr(data-gutter-num); }
html[data-mode="editor"] .cm-gutter-num-inline.cm-gutter-num-chapter { font-size: 56px; font-weight: 400; line-height: 1.05; }
html[data-mode="editor"] .cm-gutter-num-inline.cm-gutter-num-scene   { font-size: 28px; font-weight: 400; line-height: 1.1; }
/* Numerals are a translucent tint of their section's color, not a flat
   --text-dimmer gray (typography-rhythm.md #3) -- the current scene's own
   numeral (manuscriptGutterActivePlugin above) comes up to full strength.
   !important for the same reason the base color rule above needed it: a
   named scene's numeral is a real child of scene-breaks.js's
   .cm-scene-name-comment line, whose own wildcard would otherwise win. */
html[data-mode="editor"] .cm-gutter-num-inline.cm-gutter-num-chapter { color: color-mix(in srgb, var(--accent) 55%, transparent) !important; }
html[data-mode="editor"] .cm-gutter-num-inline.cm-gutter-num-scene   { color: color-mix(in srgb, var(--scene) 55%, transparent) !important; }
html[data-mode="editor"] .cm-gutter-num-inline.cm-gutter-num-scene.cm-gutter-num-active { color: var(--scene) !important; }

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
/* Ornament numbers are always scene numerals -- same tint rule as the
   inline scene numeral above. */
html[data-mode="editor"] .cm-gutter-num-ornament { color: color-mix(in srgb, var(--scene) 55%, transparent); }
html[data-mode="editor"] .cm-gutter-num-ornament.cm-gutter-num-active { color: var(--scene); }

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
