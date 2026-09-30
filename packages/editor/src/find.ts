// Find & replace over the prose the writer sees (spec §7.4): every
// textblock (prose, quotes, titles, scene names), never cold storage and
// never markup. Matches may cross formatting; they never cross blocks.

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { schema } from './schema';

export interface FindMatch { from: number; to: number }

export interface FindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** Stop after this many matches (very common queries on a long book). */
  limit?: number;
}

export const FIND_LIMIT = 10000;

/** Straight and curly quotes are the same to a writer; lengths are preserved. */
function normalizeQuotes(s: string): string {
  return s.replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"');
}

/** Lowercase without changing length, so offsets stay valid (e.g. "İ"). */
function lowerSameLength(s: string): string {
  const lower = s.toLowerCase();
  if (lower.length === s.length) return lower;
  let out = '';
  for (const ch of s) {
    const l = ch.toLowerCase();
    out += l.length === ch.length ? l : ch;
  }
  return out;
}

const WORD = /[\p{L}\p{N}_]/u;

interface Block { pos: number; text: string; quotes: string; lower: string }
const blockCache = new WeakMap<PMNode, Block[]>();

/** The searchable textblocks of a document, prepared once per document version. */
function blocksOf(doc: PMNode): Block[] {
  let blocks = blockCache.get(doc);
  if (blocks) return blocks;
  blocks = [];
  const list = blocks;
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.cold_storage) return false;
    if (!node.isTextblock) return true;
    const text = node.textContent; // text only: offsets are positions
    const quotes = normalizeQuotes(text);
    list.push({ pos: pos + 1, text, quotes, lower: lowerSameLength(quotes) });
    return false;
  });
  blockCache.set(doc, blocks);
  return blocks;
}

export function findMatches(doc: PMNode, query: string, options: FindOptions = {}): FindMatch[] {
  if (!query) return [];
  const { caseSensitive = false, wholeWord = false, limit = FIND_LIMIT } = options;
  const q = normalizeQuotes(query);
  const needle = caseSensitive ? q : lowerSameLength(q);
  const out: FindMatch[] = [];
  for (const b of blocksOf(doc)) {
    const hay = caseSensitive ? b.quotes : b.lower;
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
      if (wholeWord && (WORD.test(b.text[i - 1] ?? '') || WORD.test(b.text[i + needle.length] ?? ''))) continue;
      out.push({ from: b.pos + i, to: b.pos + i + needle.length });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Replacement text wears the formatting of the first character it replaces. */
function replaceIn(tr: Transaction, from: number, to: number, text: string) {
  if (!text) { tr.delete(from, to); return; }
  const marks = tr.doc.nodeAt(from)?.marks ?? [];
  tr.replaceWith(from, to, schema.text(text, marks));
}

export function replaceMatch(state: EditorState, match: FindMatch, text: string): Transaction | null {
  if (match.to > state.doc.content.size || match.from >= match.to) return null;
  const tr = state.tr;
  replaceIn(tr, match.from, match.to, text);
  return tr;
}

/** Every match in one transaction: one undo step. */
export function replaceAll(state: EditorState, matches: readonly FindMatch[], text: string): Transaction | null {
  if (!matches.length) return null;
  const tr = state.tr;
  for (const m of matches) replaceIn(tr, tr.mapping.map(m.from), tr.mapping.map(m.to), text);
  return tr;
}

// ── highlights ──
// Only matches near the viewport are decorated, so a query with thousands
// of matches costs no more to draw than one with ten.

export interface FindHighlight {
  matches: FindMatch[];
  current: number;
  /** Document range worth decorating (roughly what is on screen). */
  window: { from: number; to: number };
}

export const findKey = new PluginKey<FindHighlight | null>('find');
const MAX_DECORATED = 600;

export function findHighlights(): Plugin<FindHighlight | null> {
  return new Plugin<FindHighlight | null>({
    key: findKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const meta = tr.getMeta(findKey) as FindHighlight | null | undefined;
        if (meta !== undefined) return meta;
        if (!value || !tr.docChanged) return value;
        // Keep highlights on their text until the finder recomputes.
        const map = (p: number) => tr.mapping.map(p);
        return {
          ...value,
          matches: value.matches.map((m) => ({ from: map(m.from), to: map(m.to) })),
          window: { from: map(value.window.from), to: map(value.window.to) },
        };
      },
    },
    props: {
      decorations(state) {
        const f = findKey.getState(state);
        if (!f || !f.matches.length) return null;
        let lo = 0;
        let hi = f.matches.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (f.matches[mid]!.to < f.window.from) lo = mid + 1; else hi = mid; }
        const decos: Decoration[] = [];
        for (let i = lo; i < f.matches.length && decos.length < MAX_DECORATED; i++) {
          const m = f.matches[i]!;
          if (m.from > f.window.to) break;
          if (m.from < m.to) decos.push(Decoration.inline(m.from, m.to, { class: i === f.current ? 'bt-find-match bt-find-current' : 'bt-find-match' }));
        }
        const cur = f.matches[f.current];
        if (cur && (f.current < lo || cur.from > f.window.to) && cur.from < cur.to) {
          decos.push(Decoration.inline(cur.from, cur.to, { class: 'bt-find-match bt-find-current' }));
        }
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}
