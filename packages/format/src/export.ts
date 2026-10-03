// Export (spec §13, DECISIONS §18): the book as others will read it. Prose,
// chapter titles and breaks — never Baretext's bookkeeping (identities,
// links, scene names, which are working labels). Cold Storage and notes only
// when the writer asks. The editor builds an ExportBook from the document;
// this module turns it into Markdown or plain text (Word is built in the main
// process from the same book).

import type { Block, Run } from './model';
import { escapeText, serializeInline } from './serialize';

export const EXPORT_FORMATS = ['docx', 'markdown', 'text'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = { docx: 'docx', markdown: 'md', text: 'txt' };

/** Where a note's passage starts or ends, between runs. */
export interface NoteMark { note: number; edge: 'start' | 'end' }
export type ExportItem = Run | NoteMark;
export const isNoteMark = (i: ExportItem): i is NoteMark => 'note' in i;

export type ExportBlock =
  | { type: 'paragraph'; content: ExportItem[] }
  | { type: 'pause' }
  | { type: 'quote'; paragraphs: ExportItem[][] };

export interface ExportScene {
  /** Shown only for Cold Storage scenes (in the book, scene names are working labels). */
  name: string | null;
  blocks: ExportBlock[];
}

export interface ExportChapter { title: string; scenes: ExportScene[] }

export interface ExportNote {
  /** Its number in reading order. */
  n: number;
  body: string;
  /** The passage it's about; null for a general note. */
  quote: string | null;
}

export interface ExportBook {
  title: string;
  chapters: ExportChapter[];
  /** Parked scenes, when the writer chose to include them (else empty). */
  coldStorage: ExportScene[];
  /** Open notes, when included: about passages in reading order, then general ones. */
  notes: ExportNote[];
  /** Words of prose exported. */
  words: number;
}

/** The shape of a book from an untrusted side (the window): enough that the renderers can't trip on it. */
export function isExportBook(v: unknown): v is ExportBook {
  const b = v as ExportBook;
  const scenes = (list: unknown) => Array.isArray(list) && list.every((s) => s && Array.isArray((s as ExportScene).blocks));
  return !!b && typeof b === 'object' && typeof b.title === 'string' && Number.isFinite(b.words)
    && Array.isArray(b.chapters) && b.chapters.every((c) => c && typeof c.title === 'string' && scenes(c.scenes))
    && scenes(b.coldStorage)
    && Array.isArray(b.notes) && b.notes.every((n) => n && Number.isInteger(n.n) && typeof n.body === 'string');
}

/** A chapter's heading: its title, or "Chapter 3" when it has none. */
export function chapterHeading(c: ExportChapter, index: number): string {
  return c.title.trim() || `Chapter ${index + 1}`;
}

export function bookTitle(book: ExportBook): string {
  return book.title.trim() || 'Untitled';
}

/** A parked scene's label in an export. */
export function coldSceneLabel(s: ExportScene): string {
  return s.name?.trim() || 'Untitled scene';
}

/** "about 120,000 words": to the nearest thousand for a book, hundred for something short. */
export function approximateWords(words: number): string {
  const step = words >= 10_000 ? 1000 : 100;
  const n = Math.max(step, Math.round(words / step) * step);
  return `about ${n.toLocaleString('en-US')} words`;
}

const runsOf = (items: readonly ExportItem[]): Run[] => items.filter((i): i is Run => !isNoteMark(i));
const isEmpty = (items: readonly ExportItem[]) => runsOf(items).every((r) => r.text.trim() === '') && !items.some(isNoteMark);

// ── Markdown ──

const BREAK = '* * *';

/** One line of inline Markdown; a note's footnote marker where its passage ends (before trailing spaces). */
function mdInline(items: readonly ExportItem[], notes: ReadonlySet<number>): string {
  let out = '';
  let piece: Run[] = [];
  const flush = (lineEnd: boolean) => {
    if (piece.length) out += serializeInline(piece, out === '', lineEnd);
    piece = [];
  };
  for (const item of items) {
    if (!isNoteMark(item)) { piece.push(item); continue; }
    if (item.edge !== 'end' || !notes.has(item.note)) continue;
    // "basil [^1]" reads wrong: the marker goes before trailing spaces.
    const last = piece.at(-1);
    const space = last ? /\s+$/u.exec(last.text)?.[0] ?? '' : '';
    if (last && space) piece[piece.length - 1] = { ...last, text: last.text.slice(0, -space.length) };
    flush(false);
    out += `[^${item.note}]`;
    if (space) piece.push({ text: space });
  }
  flush(true);
  return out;
}

/** A note's text as Markdown lines (hard breaks between its lines). */
function mdNoteLines(body: string): string[] {
  const lines = body.split('\n').map((l) => escapeText(l, true, true));
  return lines.map((l, i) => (i < lines.length - 1 ? `${l}\\` : l));
}

function mdBlocks(blocks: readonly ExportBlock[], out: string[], notes: ReadonlySet<number>): void {
  for (const b of blocks) {
    if (b.type === 'pause') out.push(BREAK, '');
    else if (b.type === 'paragraph') { if (!isEmpty(b.content)) out.push(mdInline(b.content, notes), ''); }
    else {
      const ps = b.paragraphs.filter((p) => !isEmpty(p));
      ps.forEach((p, i) => { if (i > 0) out.push('>'); out.push(`> ${mdInline(p, notes)}`); });
      if (ps.length) out.push('');
    }
  }
}

/** The numbers of the notes being exported (markers for any others are left out). */
const noteNumbers = (book: ExportBook) => new Set(book.notes.filter((n) => n.quote !== null).map((n) => n.n));

export function exportMarkdown(book: ExportBook): string {
  const notes = noteNumbers(book);
  const out: string[] = [`# ${escapeText(bookTitle(book), true, true)}`, ''];
  book.chapters.forEach((c, i) => {
    out.push(`## ${escapeText(chapterHeading(c, i), true, true)}`, '');
    c.scenes.forEach((s, j) => { if (j > 0) out.push(BREAK, ''); mdBlocks(s.blocks, out, notes); });
  });
  if (book.coldStorage.length) {
    out.push('## Cold Storage', '');
    for (const s of book.coldStorage) { out.push(`### ${escapeText(coldSceneLabel(s), true, true)}`, ''); mdBlocks(s.blocks, out, notes); }
  }
  const general = book.notes.filter((n) => n.quote === null);
  if (general.length) {
    out.push('## Notes', '');
    for (const n of general) out.push(...mdNoteLines(n.body), '');
  }
  for (const n of book.notes) {
    if (n.quote === null) continue;
    const [first, ...rest] = mdNoteLines(n.body);
    out.push(`[^${n.n}]: ${first}`, ...rest.map((l) => `    ${l}`), '');
  }
  return out.join('\n').replace(/\n+$/, '') + '\n';
}

// ── Plain text ──

function textInline(items: readonly ExportItem[], notes: ReadonlySet<number>): string {
  let out = '';
  for (const item of items) {
    if (isNoteMark(item)) {
      if (item.edge === 'end' && notes.has(item.note)) {
        const space = /\s+$/u.exec(out)?.[0] ?? '';
        out = out.slice(0, out.length - space.length) + `[${item.note}]` + space;
      }
    } else {
      out += item.text;
      if (item.link && item.link !== item.text) out += ` (${item.link})`;
    }
  }
  return out.trim();
}

function textBlocks(blocks: readonly ExportBlock[], out: string[], notes: ReadonlySet<number>): void {
  for (const b of blocks) {
    if (b.type === 'pause') out.push(BREAK, '');
    else if (b.type === 'paragraph') { if (!isEmpty(b.content)) out.push(textInline(b.content, notes), ''); }
    else for (const p of b.paragraphs) if (!isEmpty(p)) out.push(`    ${textInline(p, notes)}`, '');
  }
}

export function exportText(book: ExportBook): string {
  const notes = noteNumbers(book);
  const out: string[] = [bookTitle(book), '', ''];
  book.chapters.forEach((c, i) => {
    out.push(chapterHeading(c, i), '');
    c.scenes.forEach((s, j) => { if (j > 0) out.push(BREAK, ''); textBlocks(s.blocks, out, notes); });
    out.push('');
  });
  if (book.coldStorage.length) {
    out.push('Cold Storage', '');
    for (const s of book.coldStorage) { out.push(coldSceneLabel(s), ''); textBlocks(s.blocks, out, notes); }
    out.push('');
  }
  if (book.notes.length) {
    out.push('Notes', '');
    for (const n of book.notes) {
      const [first, ...rest] = n.body.split('\n');
      if (n.quote === null) out.push(first!, ...rest, '');
      else out.push(`[${n.n}] “${n.quote}”`, `    ${first}`, ...rest.map((l) => `    ${l}`), '');
    }
  }
  return out.join('\n').replace(/\n+$/, '') + '\n';
}

// ── Print: standard manuscript format, laid out as the Word export (DECISIONS §18) ──

/** The running head: "Surname / TITLE" (the title alone without a name). */
export function runningHead(title: string, author: string): string {
  const surname = author.trim().split(/\s+/).at(-1) ?? '';
  return [surname, (title.trim() || 'Untitled').toUpperCase()].filter(Boolean).join(' / ');
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const html = (text: string) => text.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]!);
const cssString = (text: string) => `"${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

/** Prose as HTML: italic and bold kept, links as their words, notes left out. */
function htmlInline(items: readonly ExportItem[]): string {
  return runsOf(items).map((r) => {
    let t = html(r.text);
    if (r.italic) t = `<em>${t}</em>`;
    if (r.bold) t = `<strong>${t}</strong>`;
    return t;
  }).join('');
}

const blank = (items: readonly ExportItem[]) => runsOf(items).every((r) => r.text.trim() === '');

function htmlBlocks(blocks: readonly ExportBlock[], out: string[]): void {
  for (const b of blocks) {
    if (b.type === 'pause') out.push('<p class="break">#</p>');
    else if (b.type === 'paragraph') { if (!blank(b.content)) out.push(`<p>${htmlInline(b.content)}</p>`); }
    else for (const p of b.paragraphs) if (!blank(p)) out.push(`<p class="quote">${htmlInline(p)}</p>`);
  }
}

/**
 * The manuscript as a printable page (Letter, 1" margins, Times New Roman
 * 12pt, double spaced, first lines indented ½"): a title page (name and word
 * count at the top, title and byline centred), "Surname / TITLE / page"
 * atop every later page, each chapter on a new page a third of the way down,
 * "#" for breaks, "END". The manuscript alone: no notes, no Cold Storage.
 */
export function printManuscript(book: ExportBook, author: string): string {
  const title = bookTitle(book);
  const name = author.trim();
  const out: string[] = [
    '<div class="title-page">',
    `<p class="contact"><span>${html(name)}</span><span>${html(approximateWords(book.words))}</span></p>`,
    `<p class="title">${html(title.toUpperCase())}</p>`,
    ...(name ? [`<p class="byline">by ${html(name)}</p>`] : []),
    '</div>',
  ];
  book.chapters.forEach((c, i) => {
    out.push(`<h2 class="chapter">${html(chapterHeading(c, i))}</h2>`);
    c.scenes.forEach((s, j) => { if (j > 0) out.push('<p class="break">#</p>'); htmlBlocks(s.blocks, out); });
  });
  out.push('<p class="end">END</p>');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${html(title)}</title>
<style>
@page { size: letter; margin: 1in; @top-right { content: ${cssString(`${runningHead(title, name)} / `)} counter(page); font: 12pt 'Times New Roman', Times, serif; } }
@page :first { @top-right { content: none; } }
html { font: 12pt/2 'Times New Roman', Times, serif; color: #000; background: #fff; }
body { margin: 0; }
p { margin: 0; text-indent: 0.5in; orphans: 2; widows: 2; }
.contact { display: flex; justify-content: space-between; text-indent: 0; line-height: 1; }
.title { margin-top: 3.5in; text-align: center; text-indent: 0; }
.byline, .break, .end { text-align: center; text-indent: 0; }
.chapter { break-before: page; margin: 0 0 0.5in; padding-top: 2in; font: inherit; text-align: center; }
.quote { margin: 0 0.5in; text-indent: 0; }
.end { margin-top: 0.5in; }
</style>
</head>
<body>
${out.join('\n')}
</body>
</html>
`;
}

// ── Copy: a scene for the clipboard (spec §8.6) ──

/** Runs as HTML for pasting elsewhere: formatting and links kept. */
function clipboardInline(runs: readonly Run[]): string {
  return runs.map((r) => {
    let t = html(r.text);
    if (r.italic) t = `<em>${t}</em>`;
    if (r.bold) t = `<strong>${t}</strong>`;
    if (r.link) t = `<a href="${html(r.link)}">${t}</a>`;
    return t;
  }).join('');
}

const plain = (runs: readonly Run[]) => runs.map((r) => r.text).join('');
const blankRuns = (runs: readonly Run[]) => runs.every((r) => r.text.trim() === '');

/**
 * A scene with its title, for pasting into a word processor or an email:
 * rich text (formatting, breaks and quotes kept) and a plain-text fallback.
 */
export function sceneClipboard(title: string, blocks: readonly Block[]): { html: string; text: string } {
  const htmlParts = [`<h3>${html(title)}</h3>`];
  const textParts = [title];
  for (const b of blocks) {
    if (b.type === 'section_break') {
      htmlParts.push('<p style="text-align:center">* * *</p>');
      textParts.push('* * *');
    } else if (b.type === 'paragraph') {
      if (blankRuns(b.content)) continue;
      htmlParts.push(`<p>${clipboardInline(b.content)}</p>`);
      textParts.push(plain(b.content));
    } else {
      const ps = b.paragraphs.filter((p) => !blankRuns(p));
      if (!ps.length) continue;
      htmlParts.push(`<blockquote>${ps.map((p) => `<p>${clipboardInline(p)}</p>`).join('')}</blockquote>`);
      textParts.push(ps.map((p) => `    ${plain(p)}`).join('\n'));
    }
  }
  return { html: htmlParts.join(''), text: textParts.join('\n\n') };
}
