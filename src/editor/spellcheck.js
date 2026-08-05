import { Decoration, ViewPlugin } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { WORDS } from './wordlist.js';

let wordSet = null;
function getWordSet() {
  if (!wordSet) wordSet = new Set(WORDS.split('\n'));
  return wordSet;
}

export const setSpellcheckEffect = StateEffect.define();

export const spellcheckField = StateField.define({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSpellcheckEffect)) return effect.value;
    }
    return value;
  },
});

// Letters plus internal apostrophes (don't, it's, O'Brien) — not aiming for
// perfect tokenization, just reasonable coverage of common word shapes.
const WORD_RE = /[a-zA-Z]+(?:'[a-zA-Z]+)*/g;

// The base dictionary is a root-word list (Webster's), not an inflected-forms
// list — "has", "words", "walking" etc. aren't in it verbatim. Rather than
// pre-generating every plural/tense/comparative into the wordlist (which
// balloons it many times over), strip common suffixes at lookup time and
// recheck the root. Not exhaustive English morphology, just the common
// regular patterns — irregular forms (has, went, ...) are patched directly
// into the wordlist itself since they can't be derived by stripping a suffix.
function isMisspelled(word) {
  const w = word.toLowerCase();
  if (w.length < 2) return false;
  const set = getWordSet();
  if (set.has(w)) return false;

  if (w.length > 4 && w.endsWith('ies') && set.has(w.slice(0, -3) + 'y')) return false;
  if (w.length > 3 && w.endsWith('es') && set.has(w.slice(0, -2))) return false;
  if (w.length > 2 && w.endsWith('s') && set.has(w.slice(0, -1))) return false;

  if (w.length > 4 && w.endsWith('ied') && set.has(w.slice(0, -3) + 'y')) return false;
  if (w.length > 3 && w.endsWith('ed')) {
    if (set.has(w.slice(0, -2))) return false;      // walked -> walk
    if (set.has(w.slice(0, -1))) return false;      // hoped -> hope
  }

  if (w.length > 4 && w.endsWith('ing')) {
    const stem = w.slice(0, -3);
    if (set.has(stem)) return false;                 // walking -> walk
    if (set.has(stem + 'e')) return false;            // hoping -> hope
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2] && set.has(stem.slice(0, -1))) return false; // running -> run
  }

  if (w.length > 4 && (w.endsWith('er') || w.endsWith('est'))) {
    const stem = w.slice(0, w.endsWith('est') ? -3 : -2);
    if (set.has(stem)) return false;                  // faster -> fast
    if (set.has(stem + 'e')) return false;             // nicer -> nice
  }

  return true;
}

// Skip inline/fenced code and link URLs — those aren't prose, no reason to
// flag identifiers or URLs as misspellings.
function collectSkipRanges(state) {
  const ranges = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'URL') {
        ranges.push({ from: node.from, to: node.to });
      }
    },
  });
  return ranges;
}

function build(view) {
  const state = view.state;
  if (!state.field(spellcheckField)) return Decoration.none;

  const text = state.doc.toString();
  const skipRanges = collectSkipRanges(state);
  const inSkipRange = (pos) => skipRanges.some((r) => pos >= r.from && pos < r.to);

  const decos = [];
  WORD_RE.lastIndex = 0;
  let match;
  while ((match = WORD_RE.exec(text))) {
    const word = match[0];
    const from = match.index;
    if (inSkipRange(from)) continue;
    if (isMisspelled(word)) {
      decos.push(Decoration.mark({ class: 'cm-spellError' }).range(from, from + word.length));
    }
  }
  return Decoration.set(decos, true);
}

export const spellcheckPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(update) {
    const toggled = update.transactions.some(tr => tr.effects.some(e => e.is(setSpellcheckEffect)));
    if (update.docChanged || toggled) {
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

// Damerau-Levenshtein (optimal string alignment) — an adjacent-letter
// transposition ("wrod"/"teh") costs 1 edit, not 2 like plain Levenshtein.
// Transpositions are one of the most common real typo patterns, so treating
// them as a double-substitution buries the obvious correction under
// single-deletion noise (e.g. "teh" ranking "eh"/"te" above "the"). Early
// exit once a row's minimum already exceeds maxDist keeps a full wordlist
// scan per click cheap enough not to need a separate suggestion index.
function editDistance(a, b, maxDist) {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const m = a.length, n = b.length;
  const d = [];
  for (let i = 0; i <= m; i++) { d[i] = new Array(n + 1); d[i][0] = i; }
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    let rowMin = d[i][0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, d[i - 2][j - 2] + 1);
      }
      d[i][j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return d[m][n];
}

function scanCandidates(target, maxDist, mapWord) {
  const out = [];
  for (const candidate of getWordSet()) {
    if (Math.abs(candidate.length - target.length) > maxDist) continue;
    const dist = editDistance(target, candidate, maxDist);
    if (dist <= maxDist) out.push({ word: mapWord ? mapWord(candidate) : candidate, dist });
  }
  return out;
}

// No word-frequency data is bundled, so equal-distance candidates otherwise
// tie-break alphabetically — fine for longer words (few real neighbors at
// distance ≤2), but short words like "teh" have dozens of equally-valid
// single-substitution 3-letter neighbors, and the actually-intended common
// word ("the") can lose the alphabetical tiebreak and fall off a short list.
// A small boost for genuinely common words targets exactly that case without
// needing a real frequency corpus.
const COMMON_WORDS = new Set(`
the of and a to in is was he for it with as his on be at by i this had not
are but from or have an they which one you were her all she there would
their we him been has when who will more no if out so what up its about
into than them can only other new some could time these two may then do
first any my now such like our over man me even most made after also did
many before must through back years where much your way well down should
because each just those people how too little state good very make world
still see own men work long get here between both life being under never
day same another know while last might us great old year off come since
against go came right used take three states himself few house use during
without again place around however small found thought went say part once
general high upon school every does got united left number course war
until always away something fact though water less public put think
almost hand enough far took head yet government system better set told
nothing night end why called eyes find going look asked later knew point
next city hundred begin early want love need help home mind keep together
give area
`.split(/\s+/).filter(Boolean));

// Words within edit distance 2 of the target. Also tries the same suffix-
// stripping isMisspelled() uses for detection, matching the STEM against
// dictionary roots and re-attaching the suffix — otherwise a real typo on
// an inflected word (e.g. "mispelled", missing an 's' from "misspelled")
// never surfaces its correction, since "misspelled" itself often isn't a
// literal dictionary entry even though its root "misspell" is a close match.
export function getSuggestions(word, limit = 6) {
  const w = word.toLowerCase();
  const maxDist = 2;

  let candidates = scanCandidates(w, maxDist);

  const suffixAttempts = [];
  if (w.length > 4 && w.endsWith('ed')) suffixAttempts.push([w.slice(0, -2), (r) => r + 'ed']);
  if (w.length > 5 && w.endsWith('ing')) suffixAttempts.push([w.slice(0, -3), (r) => r + 'ing']);
  if (w.length > 3 && w.endsWith('s')) suffixAttempts.push([w.slice(0, -1), (r) => r + 's']);
  for (const [stem, reattach] of suffixAttempts) {
    if (stem.length < 2) continue;
    candidates = candidates.concat(scanCandidates(stem, maxDist, reattach));
  }

  const bestByWord = new Map();
  for (const c of candidates) {
    const prev = bestByWord.get(c.word);
    if (prev === undefined || c.dist < prev) bestByWord.set(c.word, c.dist);
  }
  const deduped = [...bestByWord.entries()].map(([cw, dist]) => ({ word: cw, dist }));
  deduped.sort((a, b) =>
    a.dist - b.dist ||
    (COMMON_WORDS.has(b.word.toLowerCase()) ? 1 : 0) - (COMMON_WORDS.has(a.word.toLowerCase()) ? 1 : 0) ||
    Math.abs(a.word.length - w.length) - Math.abs(b.word.length - w.length) ||
    (a.word < b.word ? -1 : 1)
  );

  const top = deduped.slice(0, limit).map((c) => c.word);
  const capitalized = word[0] && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase();
  return capitalized ? top.map((s) => s[0].toUpperCase() + s.slice(1)) : top;
}

export function injectSpellcheckStyle() {
  if (document.getElementById('bt-spellcheck')) return;
  const style = document.createElement('style');
  style.id = 'bt-spellcheck';
  style.textContent = `
.cm-spellError { text-decoration: underline wavy #ff5555; text-underline-offset: 3px; }
`;
  document.head.appendChild(style);
}
