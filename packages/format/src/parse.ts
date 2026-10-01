// File → model. With serialize.ts, the only code that knows the file syntax.
//
// Two modes:
// - "own": files Baretext wrote (front matter has `baretext: N`). Strict
//   grammar, exact round-trip.
// - "import": any other Markdown or plain text. Lenient: headings become
//   chapters/scenes, horizontal rules become scene breaks, unknown
//   constructs are kept as plain paragraphs. Never drops text.

import {
  ID_PATTERN,
  emptyParagraph,
  isOrigin,
  newId,
  normalizeRuns,
  repair,
  type Block,
  type Chapter,
  type Manuscript,
  type Run,
  type Scene,
} from './model';
import { COLD_STORAGE_MARKER, EMPTY_PARAGRAPH, SCENE_BREAK, SECTION_BREAK, type Bookkeeping } from './serialize';

type Mode = 'own' | 'import';

export interface ParseResult {
  manuscript: Manuscript;
  /** Which kind of file this was. */
  source: 'baretext' | 'legacy-baretext' | 'markdown';
  /** True when the file was written by Baretext (strict mode). */
  native: boolean;
  /** Scene/chapter identities could not be restored from the file. */
  identitiesReset: boolean;
}

// ───────────────────────────── inline ─────────────────────────────

const ASCII_PUNCT = /[!-\/:-@\[-`{-~]/;
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©',
};

function decodeEntity(src: string, i: number): { text: string; end: number } | null {
  const m = /^&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]*));/.exec(src.slice(i, i + 40));
  if (!m) return null;
  let text: string | undefined;
  if (m[1] !== undefined || m[2] !== undefined) {
    const cp = m[1] !== undefined ? parseInt(m[1], 10) : parseInt(m[2]!, 16);
    text = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '�';
  } else {
    text = NAMED_ENTITIES[m[3]!];
  }
  if (text === undefined) return null;
  return { text, end: i + m[0].length };
}

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'delim'; ch: '*' | '_'; len: number; canOpen: boolean; canClose: boolean; raw: string }
  | { kind: 'linkOpen'; href: string }
  | { kind: 'linkClose' }
  | { kind: 'toggle'; bold: boolean; italic: boolean };

const isWs = (c: string | undefined) => c === undefined || /\s/u.test(c);
const isPunct = (c: string | undefined) => c !== undefined && /[\p{P}\p{S}]/u.test(c);
const isAlnum = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Find `](href)` closing a link opened at `open`. Returns positions or null. */
function findLinkClose(src: string, open: number): { closeAt: number; href: string; end: number } | null {
  let i = open + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '[') return null;
    if (c === ']') break;
    i++;
  }
  if (src[i] !== ']' || src[i + 1] !== '(') return null;
  const closeAt = i;
  i += 2;
  let href = '';
  if (src[i] === '<') {
    i++;
    while (i < src.length && src[i] !== '>') {
      if (src[i] === '\\' && i + 1 < src.length) { href += src[i + 1]; i += 2; continue; }
      href += src[i++];
    }
    if (src[i] !== '>') return null;
    i++;
  } else {
    while (i < src.length && src[i] !== ')' && !/\s/.test(src[i]!)) {
      if (src[i] === '\\' && i + 1 < src.length && ASCII_PUNCT.test(src[i + 1]!)) { href += src[i + 1]; i += 2; continue; }
      href += src[i++];
    }
  }
  // Import mode tolerates a link title: [a](url "title")
  const rest = /^\s+(?:"[^"]*"|'[^']*')\s*/.exec(src.slice(i));
  if (rest) i += rest[0].length;
  if (src[i] !== ')') return null;
  return { closeAt, href, end: i + 1 };
}

function tokenize(src: string, mode: Mode): Token[] {
  const tokens: Token[] = [];
  let text = '';
  const flush = () => { if (text) { tokens.push({ kind: 'text', text }); text = ''; } };
  const linkEnds = new Map<number, number>(); // closeAt → end index
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (linkEnds.has(i)) {
      flush();
      tokens.push({ kind: 'linkClose' });
      const end = linkEnds.get(i)!;
      linkEnds.delete(i);
      i = end;
      continue;
    }
    if (c === '\\' && i + 1 < src.length && ASCII_PUNCT.test(src[i + 1]!)) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '&') {
      const e = decodeEntity(src, i);
      if (e) { text += e.text; i = e.end; continue; }
    }
    if (c === '*' || (c === '_' && mode === 'import')) {
      let j = i;
      while (src[j] === c) j++;
      const raw = src.slice(i, j);
      const len = j - i;
      const prev = i > 0 ? Array.from(src.slice(0, i)).pop() : undefined;
      const next = j < src.length ? Array.from(src.slice(j))[0] : undefined;
      const left = !isWs(next) && (!isPunct(next) || isWs(prev) || isPunct(prev));
      const right = !isWs(prev) && (!isPunct(prev) || isWs(next) || isPunct(next));
      const canOpen = c === '*' ? left : left && (!right || isPunct(prev)) && !isAlnum(prev);
      const canClose = c === '*' ? right : right && (!left || isPunct(next)) && !isAlnum(next);
      flush();
      tokens.push({ kind: 'delim', ch: c, len, canOpen, canClose, raw });
      i = j;
      continue;
    }
    if (c === '[' && linkEnds.size === 0) {
      const close = findLinkClose(src, i);
      if (close) {
        flush();
        tokens.push({ kind: 'linkOpen', href: close.href });
        linkEnds.set(close.closeAt, close.end);
        i++;
        continue;
      }
    }
    text += c;
    i++;
  }
  flush();
  return tokens;
}

/** Own files: every unescaped `*` run toggles marks (1 italic, 2 bold, 3 both). */
function resolveStrict(tokens: Token[]): Token[] {
  return tokens.map((t): Token => {
    if (t.kind !== 'delim') return t;
    if (t.len > 3) return { kind: 'text', text: t.raw };
    return { kind: 'toggle', bold: t.len >= 2, italic: t.len !== 2 };
  });
}

/** Imports: CommonMark-like pairing; unmatched delimiters stay literal text. */
function resolveLenient(tokens: Token[]): Token[] {
  const out = tokens.slice();
  const stack: number[] = [];
  for (let i = 0; i < out.length; i++) {
    const t = out[i]!;
    if (t.kind === 'linkOpen' || t.kind === 'linkClose') { stack.length = 0; continue; }
    if (t.kind !== 'delim') continue;
    if (t.len <= 3 && t.canClose) {
      let matched = -1;
      for (let s = stack.length - 1; s >= 0; s--) {
        const o = out[stack[s]!]!;
        if (o.kind === 'delim' && o.ch === t.ch && o.len === t.len) { matched = s; break; }
      }
      if (matched >= 0) {
        const openIdx = stack[matched]!;
        const toggle: Token = { kind: 'toggle', bold: t.len >= 2, italic: t.len !== 2 };
        out[openIdx] = toggle;
        out[i] = { ...toggle };
        stack.length = matched;
        continue;
      }
    }
    if (t.len <= 3 && t.canOpen) stack.push(i);
  }
  return out.map((t): Token => (t.kind === 'delim' ? { kind: 'text', text: t.raw } : t));
}

export function parseInline(src: string, mode: Mode): Run[] {
  const tokens = tokenize(src, mode);
  const resolved = mode === 'own' ? resolveStrict(tokens) : resolveLenient(tokens);
  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  let link: string | null = null;
  for (const t of resolved) {
    switch (t.kind) {
      case 'text': {
        const run: Run = { text: t.text };
        if (bold) run.bold = true;
        if (italic) run.italic = true;
        if (link !== null) run.link = link;
        runs.push(run);
        break;
      }
      case 'toggle':
        if (t.bold) bold = !bold;
        if (t.italic) italic = !italic;
        break;
      case 'linkOpen':
        link = t.href;
        break;
      case 'linkClose':
        link = null;
        break;
      case 'delim':
        break;
    }
  }
  return normalizeRuns(runs);
}

function parseParagraphLine(line: string, mode: Mode): Run[] {
  if (line === EMPTY_PARAGRAPH) return [];
  return parseInline(line, mode);
}

function plainText(src: string, mode: Mode): string {
  return parseInline(src, mode).map((r) => r.text).join('');
}

// ───────────────────────────── blocks ─────────────────────────────

interface FrontMatter { title: string | null; version: number | null; bodyStart: number }

function parseFrontMatter(lines: string[]): FrontMatter {
  const none = { title: null, version: null, bodyStart: 0 };
  if (lines[0] !== '---') return none;
  const end = lines.indexOf('---', 1);
  if (end < 0 || end > 100) return none;
  const body = lines.slice(1, end);
  if (!body.every((l) => l.trim() === '' || /^[A-Za-z_][\w-]*\s*:/.test(l) || /^\s/.test(l))) return none;
  let title: string | null = null;
  let version: number | null = null;
  for (const l of body) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(l);
    if (!m) continue;
    const [, key, raw] = m;
    if (key === 'title') {
      const v = raw!.trim();
      if (v.startsWith('"')) {
        try { title = JSON.parse(v); } catch { title = v.replace(/^"|"$/g, ''); }
      } else {
        title = v.replace(/^'(.*)'$/, '$1');
      }
    } else if (key === 'baretext') {
      const n = parseInt(raw!, 10);
      if (Number.isFinite(n)) version = n;
    }
  }
  return { title, version, bodyStart: end + 1 };
}

const isBlank = (l: string) => /^[ \t]*$/.test(l);
const IMPORT_HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const BOOKKEEPING = /^<!-- baretext (\{.*\}) -->$/;

class Builder {
  chapters: Array<Omit<Chapter, 'id'> & { id?: string }> = [];
  cold: Scene[] = [];
  inCold = false;
  scene: Scene | null = null;

  private target(): Scene[] {
    if (this.inCold) return this.cold;
    if (this.chapters.length === 0) this.chapters.push({ title: '', scenes: [] });
    return this.chapters[this.chapters.length - 1]!.scenes;
  }
  chapter(title: string) {
    this.inCold = false;
    this.chapters.push({ title, scenes: [] });
    this.scene = null;
  }
  startScene(name: string | null) {
    this.scene = { id: '', name, link: null, blocks: [] };
    this.target().push(this.scene);
  }
  block(b: Block) {
    if (!this.scene) this.startScene(null);
    this.scene!.blocks.push(b);
  }
  enterCold() {
    this.inCold = true;
    this.scene = null;
  }
}

function parseBody(lines: string[], mode: Mode, b: Builder): Bookkeeping | null {
  let book: Bookkeeping | null = null;
  let i = 0;
  let inFence: string | null = null;

  while (i < lines.length) {
    const line = lines[i]!;

    if (inFence) {
      if (line.trimStart().startsWith(inFence)) inFence = null;
      else if (!isBlank(line)) b.block({ type: 'paragraph', content: [{ text: line }] });
      i++;
      continue;
    }
    if (isBlank(line)) { i++; continue; }

    const bk = BOOKKEEPING.exec(line);
    if (bk) {
      try { book = JSON.parse(bk[1]!); } catch { /* ignore corrupt bookkeeping */ }
      i++;
      continue;
    }
    if (line === COLD_STORAGE_MARKER) { b.enterCold(); i++; continue; }

    if (mode === 'own') {
      if (line === '#' || line.startsWith('# ')) { b.chapter(plainText(line.slice(2), mode)); i++; continue; }
      if (line === '##' || line.startsWith('## ')) { b.startScene(plainText(line.slice(3), mode)); i++; continue; }
      if (line === SCENE_BREAK) { b.startScene(null); i++; continue; }
      if (line === SECTION_BREAK) { b.block({ type: 'section_break' }); i++; continue; }
    } else {
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        inFence = fence[1]![0]!.repeat(3);
        b.block({ type: 'paragraph', content: [{ text: line.trim() }] });
        i++;
        continue;
      }
      const atx = ATX.exec(line);
      if (atx) {
        const title = plainText((atx[2] ?? '').trim(), mode);
        if (atx[1]!.length === 1) b.chapter(title);
        else b.startScene(title);
        i++;
        continue;
      }
      // `* * *` is a pause within the scene; `---` and `___` start a new one.
      if (IMPORT_HR.test(line)) {
        if (line.trim().startsWith('*')) b.block({ type: 'section_break' });
        else b.startScene(null);
        i++;
        continue;
      }
    }

    if (/^ {0,3}>/.test(line)) {
      const paragraphs: Run[][] = [];
      let current: string[] = [];
      const push = () => {
        if (current.length) paragraphs.push(parseParagraphLine(current.join(' '), mode));
        current = [];
      };
      while (i < lines.length && /^ {0,3}>/.test(lines[i]!)) {
        const inner = lines[i]!.replace(/^ {0,3}> ?/, '');
        if (isBlank(inner)) push();
        else current.push(mode === 'own' ? inner : inner.trim());
        i++;
      }
      push();
      b.block({ type: 'quote', paragraphs: paragraphs.length ? paragraphs : [[]] });
      continue;
    }

    // Paragraph. Imports follow the manuscript convention: one line is one
    // paragraph (a line underlined with === or --- is a setext heading).
    if (mode === 'import') {
      const next = lines[i + 1] ?? '';
      if (/^ {0,3}=+[ \t]*$/.test(next)) { b.chapter(plainText(line.trim(), mode)); i += 2; continue; }
      if (/^ {0,3}-+[ \t]*$/.test(next)) { b.startScene(plainText(line.trim(), mode)); i += 2; continue; }
      b.block({ type: 'paragraph', content: parseParagraphLine(line.trim(), mode) });
      i++;
      continue;
    }
    // Own files write one line per paragraph; hand edits may wrap.
    const parts: string[] = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]!)) {
      const next = lines[i]!;
      if (next === COLD_STORAGE_MARKER || BOOKKEEPING.test(next) || next === '#' || /^#{1,2} /.test(next) ||
        next === '##' || next === SCENE_BREAK || next === SECTION_BREAK || next.startsWith('>')) {
        break;
      }
      parts.push(next);
      i++;
    }
    if (parts.length) b.block({ type: 'paragraph', content: parseParagraphLine(parts.join(' '), mode) });
  }
  return book;
}


// ─────────────────── legacy Baretext files (the previous app) ───────────────────
//
// The earlier app stored the manuscript as raw editor text: one line per
// paragraph, a private first-line title record, "#" chapters, "##"/"###"
// named scenes, "---" scene breaks optionally followed by a "<!-- name -->"
// waypoint line, "<!-- COLD STORAGE -->", and "<!-- SCENE GROUP: id -->" /
// "<!-- SCENE LINK -->" link records.

const LEGACY_TITLE = /^<!--\s*BOOK TITLE:\s*(.*?)\s*-->$/;
const LEGACY_COLD = /^<!--\s*COLD STORAGE\s*-->$/;
const LEGACY_GROUP = /^<!--\s*SCENE GROUP:\s*([A-Za-z0-9-]+)\s*-->$/;
const LEGACY_LINK = /^<!--\s*SCENE LINK\s*-->$/;
const LEGACY_NAME = /^<!--\s*(.*?)\s*-->$/;
const LEGACY_BREAK = /^(?:-{3,}|\*{3,}|_{3,})$/;

export function isLegacyBaretext(lines: string[]): boolean {
  const first = lines.find((l) => l.trim() !== '')?.trim() ?? '';
  if (LEGACY_TITLE.test(first)) return true;
  return lines.some((l, i) => {
    const t = l.trim();
    return LEGACY_COLD.test(t) || LEGACY_GROUP.test(t) || LEGACY_LINK.test(t) ||
      (LEGACY_BREAK.test(t) && LEGACY_NAME.test(lines[i + 1]?.trim() ?? ''));
  });
}

function legacyGroupId(raw: string): string {
  const id = 'g' + raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return id.slice(0, 32);
}

function parseLegacy(lines: string[], b: Builder): string {
  let title = '';
  let pendingLink: string | null = null;
  const start = (name: string | null) => {
    b.startScene(name);
    if (pendingLink) { b.scene!.link = pendingLink; pendingLink = null; }
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === '') continue; // blank lines were spacing between lines, not text
    let m: RegExpExecArray | null;
    if (i === 0 || (!title && !b.chapters.length && !b.scene)) {
      if ((m = LEGACY_TITLE.exec(t))) { title = m[1]!; continue; }
    }
    if (LEGACY_COLD.test(t)) { b.enterCold(); continue; }
    if ((m = LEGACY_GROUP.exec(t))) {
      if (!b.scene) start(null);
      b.scene!.link = legacyGroupId(m[1]!);
      continue;
    }
    if (LEGACY_LINK.test(t)) {
      if (!b.scene) start(null);
      b.scene!.link ??= 'l' + newId();
      pendingLink = b.scene!.link;
      continue;
    }
    if ((m = /^#(?!#)\s*(.*)$/.exec(t))) { b.chapter(plainText(m[1]!.trim(), 'import')); continue; }
    if ((m = /^#{2,6}\s+(.*)$/.exec(t)) || /^#{2,6}$/.test(t)) { start(plainText((m?.[1] ?? '').trim(), 'import')); continue; }
    if (LEGACY_BREAK.test(t)) {
      const next = lines[i + 1]?.trim() ?? '';
      const name = LEGACY_NAME.exec(next);
      if (name && !LEGACY_COLD.test(next) && !LEGACY_GROUP.test(next) && !LEGACY_LINK.test(next)) {
        start(name[1]!);
        i++;
      } else {
        start(null);
      }
      continue;
    }
    if ((m = LEGACY_NAME.exec(t)) && (!b.scene || (b.scene.blocks.length === 0 && b.scene.name === null))) {
      // A waypoint name directly before a scene's first line.
      if (b.scene) b.scene.name = m[1]!;
      else start(m[1]!);
      continue;
    }
    b.block({ type: 'paragraph', content: parseParagraphLine(t, 'import') });
  }
  return title;
}

function validBookkeeping(book: Bookkeeping | null): book is Bookkeeping {
  return !!book && Array.isArray(book.chapters) && Array.isArray(book.scenes) &&
    book.chapters.every((id) => typeof id === 'string' && ID_PATTERN.test(id)) &&
    book.scenes.every((id) => typeof id === 'string' && ID_PATTERN.test(id)) &&
    new Set([...book.chapters, ...book.scenes]).size === book.chapters.length + book.scenes.length;
}

export function parse(source: string, fallbackTitle = ''): ParseResult {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const fm = parseFrontMatter(lines);
  const mode: Mode = fm.version !== null ? 'own' : 'import';
  const legacy = mode === 'import' && isLegacyBaretext(lines);
  const b = new Builder();
  let book: Bookkeeping | null = null;
  let legacyTitle = '';
  if (legacy) legacyTitle = parseLegacy(lines, b);
  else book = parseBody(lines.slice(fm.bodyStart), mode, b);

  const draft = repair({
    title: fm.title ?? (legacyTitle || fallbackTitle),
    chapters: b.chapters.map((c) => ({ id: '', title: c.title, scenes: c.scenes })),
    coldStorage: b.cold,
  });

  const scenes = [...draft.chapters.flatMap((c) => c.scenes), ...draft.coldStorage];
  const restorable = mode === 'own' && validBookkeeping(book) &&
    book.chapters.length === draft.chapters.length && book.scenes.length === scenes.length;

  draft.chapters.forEach((c, i) => { c.id = restorable ? book!.chapters[i]! : newId(); });
  scenes.forEach((s, i) => {
    s.id = restorable ? book!.scenes[i]! : newId();
    if (!legacy) {
      const link = restorable ? book!.links?.[s.id] : undefined;
      s.link = typeof link === 'string' && ID_PATTERN.test(link) ? link : null;
    }
    if (s.blocks.length === 0) s.blocks.push(emptyParagraph());
  });
  // Where parked scenes came from (only trusted when well formed).
  if (restorable && book!.origins && typeof book!.origins === 'object') {
    for (const s of draft.coldStorage) {
      const o = (book!.origins as Record<string, unknown>)[s.id];
      const origin = Array.isArray(o) ? { chapter: o[0], index: o[1] } : null;
      if (isOrigin(origin)) s.origin = origin;
    }
  }

  if (legacy) {
    // A link group needs at least two members (as in the previous app).
    const counts = new Map<string, number>();
    for (const s of scenes) if (s.link) counts.set(s.link, (counts.get(s.link) ?? 0) + 1);
    for (const s of scenes) if (s.link && (counts.get(s.link) ?? 0) < 2) s.link = null;
  }
  return {
    manuscript: draft,
    source: mode === 'own' ? 'baretext' : legacy ? 'legacy-baretext' : 'markdown',
    native: mode === 'own',
    identitiesReset: mode === 'own' && !restorable,
  };
}
