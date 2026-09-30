// Palette search: small, predictable, fast. Every query word must match the
// item's label or keywords. Ranking: label before keywords; prefix, then a
// word start, then anywhere, then letters in order (initials like "tw").
// Ties keep the item's own order.

export interface Searchable {
  label: string;
  keywords?: string;
}

/** Lowercased haystacks, computed once per palette opening. */
export interface Prepared {
  label: string;
  keywords: string;
}

export function prepare(items: readonly Searchable[]): Prepared[] {
  return items.map((i) => ({ label: i.label.toLowerCase(), keywords: (i.keywords ?? '').toLowerCase() }));
}

const isWordStart = (s: string, i: number) => i === 0 || /[\s.\-_/:·(]/.test(s[i - 1]!);

function wordScore(word: string, text: string): number {
  if (!text) return 0;
  if (text.startsWith(word)) return 100;
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    if (isWordStart(text, i)) return 80;
  }
  if (text.includes(word)) return 60;
  // Numbers are exact: "4.2" must not match 4.12 letter by letter.
  if (/\d/.test(word)) return 0;
  // Letters in order, favoring word starts: "tw" → Type Writer, "gts" → Go To Scene.
  let at = 0;
  let starts = 0;
  for (const ch of word) {
    const i = text.indexOf(ch, at);
    if (i < 0) return 0;
    if (isWordStart(text, i)) starts++;
    at = i + 1;
  }
  return 20 + Math.round((20 * starts) / word.length);
}

/** Indices of matching items, best first. An empty query returns every item in order. */
export function search(query: string, prepared: readonly Prepared[]): number[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return prepared.map((_, i) => i);
  const scored: { i: number; score: number }[] = [];
  prepared.forEach((p, i) => {
    let total = 0;
    for (const w of words) {
      const s = Math.max(wordScore(w, p.label), wordScore(w, p.keywords) * 0.8);
      if (!s) return;
      total += s;
    }
    scored.push({ i, score: total });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.i);
}
