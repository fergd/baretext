import { Decoration, ViewPlugin } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import affText from './dictionary/en.aff';
import dicText from './dictionary/en.dic';
import { createSpellchecker } from './spellcheck-engine.js';
import { collectSkipRanges, inSkipRange } from './skip-ranges.js';
import { injectStyle as injectStyleTag } from '../dom.js';

// The actual dictionary logic (Hunspell via nspell, ignore list) lives in
// spellcheck-engine.js, which is plain and DOM/CodeMirror-free so it can be
// unit tested headless. This file is just the CodeMirror wiring: decorating
// misspelled words as the doc changes, and reacting to the ignore-list
// changing by re-running that decoration pass.
let engine = null;
function getEngine() {
  if (!engine) engine = createSpellchecker(affText, dicText);
  return engine;
}

export const setSpellcheckEffect = StateEffect.define();
const ignoredWordsChangedEffect = StateEffect.define();

export const spellcheckField = StateField.define({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSpellcheckEffect)) return effect.value;
    }
    return value;
  },
});

export function ignoreWord(view, word) {
  getEngine().ignoreWord(word);
  view.dispatch({ effects: ignoredWordsChangedEffect.of(null) });
}

export function setIgnoredWords(view, words) {
  getEngine().setIgnoredWords(words);
  view.dispatch({ effects: ignoredWordsChangedEffect.of(null) });
}

export function getIgnoredWords() {
  return getEngine().getIgnoredWords();
}

export function clearIgnoredWords(view) {
  getEngine().clearIgnoredWords();
  view.dispatch({ effects: ignoredWordsChangedEffect.of(null) });
}

// Letters plus internal apostrophes (don't, it's, O'Brien) — not aiming for
// perfect tokenization, just reasonable coverage of common word shapes.
const WORD_RE = /[a-zA-Z]+(?:'[a-zA-Z]+)*/g;

function isMisspelled(word) {
  return getEngine().isMisspelled(word);
}

function build(view) {
  const state = view.state;
  if (!state.field(spellcheckField)) return Decoration.none;

  const text = state.doc.toString();
  const skipRanges = collectSkipRanges(state);

  // Standard spell-checker behavior (macOS, Google Docs, MS Word, VS Code):
  // don't flag the word the caret is still inside — a word isn't "wrong"
  // until you've stopped typing it. Same "don't disturb what's under the
  // caret" precedent as live-preview.js's raw-markdown-on-the-caret-line
  // behavior. Only a collapsed cursor suppresses a word; an active
  // selection doesn't.
  const cursor = state.selection.main;
  const activeWordAt = cursor.empty ? cursor.head : -1;

  const decos = [];
  WORD_RE.lastIndex = 0;
  let match;
  while ((match = WORD_RE.exec(text))) {
    const word = match[0];
    const from = match.index;
    const to = from + word.length;
    if (inSkipRange(skipRanges, from)) continue;
    if (activeWordAt >= from && activeWordAt <= to) continue;
    if (isMisspelled(word)) {
      decos.push(Decoration.mark({ class: 'cm-spellError' }).range(from, to));
    }
  }
  return Decoration.set(decos, true);
}

export const spellcheckPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(update) {
    const changed = update.transactions.some(tr =>
      tr.effects.some(e => e.is(setSpellcheckEffect) || e.is(ignoredWordsChangedEffect))
    );
    if (update.docChanged || update.selectionSet || changed) {
      this.decorations = build(update.view);
    }
  }
}, { decorations: v => v.decorations });

export function setSpellcheck(view, enabled) {
  view.dispatch({ effects: setSpellcheckEffect.of(enabled) });
}

// Finds the word (if any) at a document position, only returning it if
// currently flagged as misspelled — used to decide whether a right-click/
// ctrl-click should show a suggestion popup.
export function wordAt(view, pos) {
  const text = view.state.doc.toString();
  WORD_RE.lastIndex = 0;
  let match;
  while ((match = WORD_RE.exec(text))) {
    const from = match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) {
      return isMisspelled(match[0]) ? { word: match[0], from, to } : null;
    }
    if (from > pos) break;
  }
  return null;
}

export function getSuggestions(word, limit = 6) {
  return getEngine().getSuggestions(word, limit);
}

export function injectSpellcheckStyle() {
  injectStyleTag('bt-spellcheck', `
.cm-spellError { text-decoration: underline wavy #ff5555; text-underline-offset: 3px; }
`);
}
