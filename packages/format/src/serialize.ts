// Model → file. With parse.ts, the only code that knows the file syntax.
//
// File shape (Markdown that reads cleanly elsewhere):
//
//   ---
//   title: "Book title"
//   baretext: 1
//   ---
//
//   # Chapter title
//
//   ## Named scene
//
//   A paragraph with **bold**, *italic*, and [a link](https://example.com).
//
//   * * *                       ← section break (a pause within a scene)
//
//   ---                         ← boundary before an unnamed scene
//
//   <!-- baretext:cold-storage -->
//   ## A parked scene
//
//   <!-- baretext {"v":1,...} --> ← identities and links (bookkeeping)
//
// Inline marks are strict toggles in Baretext's own files: `*` toggles
// italic, `**` bold, `***` both. Every literal markup character in prose is
// backslash-escaped, so prose can never be read back as structure.

import { canonicalize, type Block, type Manuscript, type Run, type Scene } from './model';

export const FORMAT_VERSION = 1;
export const COLD_STORAGE_MARKER = '<!-- baretext:cold-storage -->';
export const EMPTY_PARAGRAPH = '&nbsp;';
export const SECTION_BREAK = '* * *';
export const SCENE_BREAK = '---';

export interface Bookkeeping {
  v: number;
  chapters: string[];
  /** Manuscript scenes in order, then cold-storage scenes. */
  scenes: string[];
  links: Record<string, string>;
  /** Cold Storage scenes' origins: scene id → [chapter id, index]. Omitted when there are none. */
  origins?: Record<string, [string, number]>;
}

// Characters that are markup anywhere in a line.
const INLINE_SPECIAL = new Set(['\\', '*', '_', '[', ']', '`', '<', '~']);
// Characters that are markup at the start of a line.
const LINE_START_SPECIAL = new Set(['#', '>', '-', '+', '=', '|']);
const ENTITY_LIKE = /^&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;

function entity(ch: string): string {
  return `&#${ch.codePointAt(0)};`;
}

function isEdgeWhitespace(ch: string): boolean {
  return /\s/u.test(ch);
}

function isControl(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (c < 0x20 && c !== 0x09) || c === 0x7f;
}

/**
 * Escape a piece of prose. `atLineStart`/`atLineEnd` mark whether this text
 * begins/ends the physical line, where whitespace and some characters would
 * otherwise be swallowed or reinterpreted.
 */
export function escapeText(text: string, atLineStart: boolean, atLineEnd: boolean): string {
  const chars = Array.from(text);
  let lead = 0;
  if (atLineStart) while (lead < chars.length && isEdgeWhitespace(chars[lead]!)) lead++;
  let trail = chars.length;
  if (atLineEnd) while (trail > lead && isEdgeWhitespace(chars[trail - 1]!)) trail--;

  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (i < lead || i >= trail || isControl(ch)) {
      out += entity(ch);
    } else if (INLINE_SPECIAL.has(ch)) {
      out += '\\' + ch;
    } else if (ch === '&' && ENTITY_LIKE.test(chars.slice(i).join(''))) {
      out += '\\&';
    } else {
      out += ch;
    }
  }

  if (atLineStart && lead === 0 && chars.length > 0) {
    if (LINE_START_SPECIAL.has(chars[0]!)) {
      out = '\\' + out;
    } else {
      // "1. " / "1) " would start an ordered list.
      const m = /^(\d{1,9})([.)])/.exec(out);
      if (m) out = m[1] + '\\' + m[2] + out.slice(m[0].length);
    }
  }
  return out;
}

function escapeHref(href: string): string {
  if (/[\s()<>\\]/.test(href) || href === '') {
    return '<' + href.replace(/[\\<>]/g, (c) => '\\' + c) + '>';
  }
  return href;
}

/** Serialize one paragraph's runs to a single line (never empty). */
export function serializeRuns(runs: readonly Run[]): string {
  if (runs.length === 0) return EMPTY_PARAGRAPH;
  let bold = false;
  let italic = false;
  let link: string | null = null;
  let out = '';

  const toggles = (wantBold: boolean, wantItalic: boolean) => {
    const n = (wantBold !== bold ? 2 : 0) + (wantItalic !== italic ? 1 : 0);
    out += '*'.repeat(n);
    bold = wantBold;
    italic = wantItalic;
  };

  runs.forEach((run, i) => {
    const wantLink = run.link ?? null;
    if (link !== null && wantLink !== link) {
      out += `](${escapeHref(link)})`;
      link = null;
    }
    toggles(!!run.bold, !!run.italic);
    if (wantLink !== null && link === null) {
      out += '[';
      link = wantLink;
    }
    const atStart = i === 0 && out === '';
    out += escapeText(run.text, atStart, i === runs.length - 1);
  });
  // Whitespace at the very end of the line must be encoded even when a
  // closing delimiter follows it; escapeText handled that via atLineEnd.
  if (link !== null) out += `](${escapeHref(link)})`;
  toggles(false, false);
  return out;
}

function serializeTitle(prefix: string, title: string): string {
  if (title === '') return prefix;
  let text = escapeText(title, true, true);
  // A trailing "#" would read as a closing sequence elsewhere.
  if (text.endsWith('#') && !text.endsWith('\\#')) text = text.slice(0, -1) + '\\#';
  return `${prefix} ${text}`;
}

function serializeBlock(b: Block, out: string[]): void {
  switch (b.type) {
    case 'paragraph':
      out.push(serializeRuns(b.content), '');
      return;
    case 'section_break':
      out.push(SECTION_BREAK, '');
      return;
    case 'quote':
      b.paragraphs.forEach((p, i) => {
        if (i > 0) out.push('>');
        out.push('> ' + serializeRuns(p));
      });
      out.push('');
      return;
  }
}

function serializeScenes(scenes: readonly Scene[], out: string[]): void {
  scenes.forEach((s, i) => {
    if (s.name !== null) out.push(serializeTitle('##', s.name), '');
    else if (i > 0) out.push(SCENE_BREAK, '');
    for (const b of s.blocks) serializeBlock(b, out);
  });
}

export function serialize(input: Manuscript): string {
  const m = canonicalize(input);
  const out: string[] = ['---', `title: ${JSON.stringify(m.title)}`, `baretext: ${FORMAT_VERSION}`, '---', ''];

  for (const c of m.chapters) {
    out.push(serializeTitle('#', c.title), '');
    serializeScenes(c.scenes, out);
  }
  if (m.coldStorage.length) {
    out.push(COLD_STORAGE_MARKER, '');
    serializeScenes(m.coldStorage, out);
  }

  const allScenes = [...m.chapters.flatMap((c) => c.scenes), ...m.coldStorage];
  const links: Record<string, string> = {};
  for (const s of allScenes) if (s.link) links[s.id] = s.link;
  const book: Bookkeeping = {
    v: FORMAT_VERSION,
    chapters: m.chapters.map((c) => c.id),
    scenes: allScenes.map((s) => s.id),
    links,
  };
  const origins = Object.fromEntries(m.coldStorage.filter((s) => s.origin).map((s) => [s.id, [s.origin!.chapter, s.origin!.index]]));
  if (Object.keys(origins).length) book.origins = origins as Record<string, [string, number]>;
  out.push(`<!-- baretext ${JSON.stringify(book)} -->`, '');
  return out.join('\n');
}
