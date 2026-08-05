import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpellchecker } from '../../src/editor/spellcheck-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dictDir = path.join(__dirname, '../../src/editor/dictionary');
const affText = fs.readFileSync(path.join(dictDir, 'en.aff'), 'utf8');
const dicText = fs.readFileSync(path.join(dictDir, 'en.dic'), 'utf8');

function checker() { return createSpellchecker(affText, dicText); }

// Regression set: every one of these was a false positive under the old
// hand-rolled root-word-list + suffix-stripper (the bug that motivated
// switching to a real Hunspell engine).
const CONTRACTIONS = [
  "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
  "haven't", "hasn't", "hadn't", "won't", "wouldn't", "can't", "couldn't",
  "shouldn't", "mustn't", "ain't",
  "it's", "that's", "there's", "here's", "what's", "who's", "he's", "she's", "let's",
  "you're", "we're", "they're",
  "I've", "you've", "we've", "they've",
  "I'll", "you'll", "he'll", "she'll", "we'll", "they'll",
  "I'd", "you'd", "we'd", "they'd",
  "I'm",
];

test('every common contraction is recognized as correctly spelled', () => {
  const spell = checker();
  for (const word of CONTRACTIONS) {
    assert.equal(spell.isMisspelled(word), false, `"${word}" should not be flagged`);
  }
});

test('genuine typos are still flagged', () => {
  const spell = checker();
  for (const word of ['teh', 'recieve', 'wrods', 'definately', 'mispelled', 'shuld', 'stil']) {
    assert.equal(spell.isMisspelled(word), true, `"${word}" should be flagged`);
  }
});

// The old suffix-stripper validated "flaged" by stripping "-ed" and finding
// "flag" in the dictionary — missing that "flag" doubles its consonant
// before -ed (the correct spelling is "flagged"). Hunspell's affix rules
// encode that correctly; this pins the fix.
test('catches missed double-consonant inflections a naive suffix-stripper would miss', () => {
  const spell = checker();
  assert.equal(spell.isMisspelled('flaged'), true);
  assert.equal(spell.isMisspelled('flagged'), false);
});

test('invented words are flagged regardless of capitalization', () => {
  const spell = checker();
  for (const word of ['blargusnorp', 'Blargusnorp', 'BLARGUSNORP']) {
    assert.equal(spell.isMisspelled(word), true, `"${word}" should be flagged`);
  }
});

test('suggestions rank the closest real word first for a short transposition typo', () => {
  const spell = checker();
  assert.equal(spell.getSuggestions('teh')[0], 'the');
});

test('suggestions surface the correct word for a common real-world typo', () => {
  const spell = checker();
  assert.ok(spell.getSuggestions('recieve').includes('receive'));
  assert.equal(spell.getSuggestions('definately')[0], 'definitely');
});

test('getSuggestions respects the limit parameter', () => {
  const spell = checker();
  assert.ok(spell.getSuggestions('teh', 3).length <= 3);
});

test('ignoreWord silences a word immediately', () => {
  const spell = checker();
  assert.equal(spell.isMisspelled('Blargusnorp'), true);
  spell.ignoreWord('Blargusnorp');
  assert.equal(spell.isMisspelled('Blargusnorp'), false);
});

test('clearIgnoredWords re-flags everything that was ignored', () => {
  const spell = checker();
  spell.ignoreWord('Blargusnorp');
  spell.ignoreWord('Xyzzyplex');
  assert.equal(spell.isMisspelled('Blargusnorp'), false);
  spell.clearIgnoredWords();
  assert.equal(spell.isMisspelled('Blargusnorp'), true);
  assert.equal(spell.isMisspelled('Xyzzyplex'), true);
});

test('clearIgnoredWords does not break a genuinely valid dictionary word', () => {
  // Only words that were actually offered for "ignore" (i.e. were flagged)
  // ever get added, so clearing should never be able to un-recognize a
  // word that was already valid — this pins that safety property directly.
  const spell = checker();
  assert.equal(spell.isMisspelled('house'), false);
  spell.clearIgnoredWords(); // 'house' was never ignored
  assert.equal(spell.isMisspelled('house'), false);
});

test('ignoreWord is idempotent in the persisted list', () => {
  const spell = checker();
  spell.ignoreWord('Blargusnorp');
  spell.ignoreWord('Blargusnorp');
  assert.deepEqual(spell.getIgnoredWords(), ['Blargusnorp']);
});

test('setIgnoredWords replays a persisted ignore list into a fresh checker', () => {
  const first = checker();
  first.ignoreWord('Blargusnorp');
  const persisted = first.getIgnoredWords();

  const second = checker(); // simulates a fresh app launch
  assert.equal(second.isMisspelled('Blargusnorp'), true);
  second.setIgnoredWords(persisted);
  assert.equal(second.isMisspelled('Blargusnorp'), false);
});

test('real dictionary words and common inflections are recognized', () => {
  const spell = checker();
  for (const word of ['walking', 'walked', 'runs', 'cats', 'happier', 'biggest', 'has', 'went', 'aphids', 'marigolds']) {
    assert.equal(spell.isMisspelled(word), false, `"${word}" should not be flagged`);
  }
});
