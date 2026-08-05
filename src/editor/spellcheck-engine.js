// Pure spellchecking logic — no CodeMirror, no DOM. Takes the dictionary
// text directly rather than importing it, so it can run headless in a
// plain Node test (no esbuild text-loader needed) against the exact same
// vendored en.aff/en.dic the app ships. spellcheck.js (CodeMirror
// integration: decorations, StateField, popups) wraps a single instance
// of this for the running editor.
import nspell from 'nspell';

// Damerau-Levenshtein (optimal string alignment) — an adjacent-letter
// transposition ("wrod"/"teh") costs 1 edit, not 2 like plain Levenshtein.
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const d = [];
  for (let i = 0; i <= m; i++) { d[i] = new Array(n + 1); d[i][0] = i; }
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, d[i - 2][j - 2] + 1);
      }
      d[i][j] = val;
    }
  }
  return d[m][n];
}

// nspell's own suggest() is Hunspell's affix-aware algorithm — much better
// candidate generation than a brute-force dictionary scan — but its ordering
// doesn't rank by "closest to what you typed", so a short word like "teh"
// can bury the obvious "the" a few slots down. Re-sorting nspell's already-
// short candidate list (rarely more than a dozen entries) by edit distance,
// with a common-word tiebreak, is cheap and fixes exactly that.
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

export function createSpellchecker(affText, dicText) {
  const checker = nspell({ aff: affText, dic: dicText });

  // nspell's own .add(word)/.remove(word) mutate checker data directly, so
  // isMisspelled() sees ignores immediately with no extra bookkeeping — the
  // flat array here exists purely so the app layer can persist and replay
  // it next launch.
  let ignoredWords = [];

  function isMisspelled(word) {
    return !checker.correct(word);
  }

  function getSuggestions(word, limit = 6) {
    const raw = checker.suggest(word);
    const ranked = raw
      .map((s) => ({ word: s, dist: editDistance(word.toLowerCase(), s.toLowerCase()) }))
      .sort((a, b) =>
        a.dist - b.dist ||
        (COMMON_WORDS.has(b.word.toLowerCase()) ? 1 : 0) - (COMMON_WORDS.has(a.word.toLowerCase()) ? 1 : 0) ||
        Math.abs(a.word.length - word.length) - Math.abs(b.word.length - word.length)
      );
    return ranked.slice(0, limit).map((c) => c.word);
  }

  function ignoreWord(word) {
    if (!ignoredWords.includes(word)) {
      checker.add(word);
      ignoredWords.push(word);
    }
  }

  // Called once on load to replay a persisted ignore list into a fresh checker.
  function setIgnoredWords(words) {
    const list = Array.isArray(words) ? words : [];
    for (const w of list) checker.add(w);
    ignoredWords = list.slice();
  }

  function getIgnoredWords() {
    return ignoredWords.slice();
  }

  // A word is only ever offered for "ignore" while it's genuinely flagged,
  // so it was never a valid dictionary entry beforehand — .remove() undoing
  // exactly what .add() did is safe, not at risk of deleting a real word.
  function clearIgnoredWords() {
    for (const w of ignoredWords) checker.remove(w);
    ignoredWords = [];
  }

  return { isMisspelled, getSuggestions, ignoreWord, setIgnoredWords, getIgnoredWords, clearIgnoredWords };
}
