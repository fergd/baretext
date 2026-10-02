// Word export in standard manuscript format (DECISIONS §18): what agents and
// editors expect. Letter pages, 1" margins, Times New Roman 12pt, double
// spaced, first lines indented ½"; a title page (name and word count at the
// top, title and byline centred); a running head "Surname / TITLE / page";
// each chapter on a new page a third of the way down; "#" for breaks; "END".
// Notes become Word comments on their passages.

import {
  AlignmentType, CommentRangeEnd, CommentRangeStart, CommentReference, Document, ExternalHyperlink, Header,
  Packer, PageNumber, Paragraph, TextRun, type ParagraphChild,
} from 'docx';
import {
  approximateWords, bookTitle, chapterHeading, coldSceneLabel, isNoteMark, runningHead,
  type ExportBlock, type ExportBook, type ExportItem, type ExportScene,
} from '@baretext/format';

const INCH = 1440; // twips
const BODY = { font: 'Times New Roman', size: 24 }; // half-points: 12pt
const DOUBLE = { line: 480 };
const SINGLE = { line: 240 };

function runs(items: readonly ExportItem[], notes: ReadonlySet<number>): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const item of items) {
    if (isNoteMark(item)) {
      if (!notes.has(item.note)) continue;
      if (item.edge === 'start') out.push(new CommentRangeStart(item.note));
      else out.push(new CommentRangeEnd(item.note), new TextRun({ children: [new CommentReference(item.note)] }));
      continue;
    }
    const run = new TextRun({ text: item.text, bold: item.bold, italics: item.italic, style: item.link ? 'Hyperlink' : undefined });
    out.push(item.link ? new ExternalHyperlink({ link: item.link, children: [run] }) : run);
  }
  return out;
}

const hasText = (items: readonly ExportItem[]) => items.some((i) => isNoteMark(i) || i.text.trim() !== '');
const centred = (text: string, opts: { pageBreakBefore?: boolean; before?: number; after?: number } = {}) =>
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { ...DOUBLE, before: opts.before, after: opts.after }, pageBreakBefore: opts.pageBreakBefore, children: [new TextRun(text)] });
const sceneBreak = () => centred('#');

function blocks(list: readonly ExportBlock[], notes: ReadonlySet<number>, out: Paragraph[]): void {
  for (const b of list) {
    if (b.type === 'pause') out.push(sceneBreak());
    else if (b.type === 'paragraph') {
      if (hasText(b.content)) out.push(new Paragraph({ spacing: DOUBLE, indent: { firstLine: INCH / 2 }, children: runs(b.content, notes) }));
    } else {
      for (const p of b.paragraphs) {
        if (hasText(p)) out.push(new Paragraph({ spacing: DOUBLE, indent: { left: INCH / 2, right: INCH / 2 }, children: runs(p, notes) }));
      }
    }
  }
}

function scenes(list: readonly ExportScene[], notes: ReadonlySet<number>, out: Paragraph[]): void {
  list.forEach((s, i) => { if (i > 0) out.push(sceneBreak()); blocks(s.blocks, notes, out); });
}

export async function buildDocx(book: ExportBook, author: string): Promise<Buffer> {
  const title = bookTitle(book);
  const name = author.trim();
  const anchored = book.notes.filter((n) => n.quote !== null);
  const general = book.notes.filter((n) => n.quote === null);
  const notes = new Set(anchored.map((n) => n.n));
  // General notes hang on the title (Word comments need a place in the text).
  const onTitle = general.map((n) => n.n);

  const body: Paragraph[] = [
    // Title page: name (left) and word count (right) at the top…
    new Paragraph({ spacing: SINGLE, tabStops: [{ type: 'right', position: 9360 }], children: [new TextRun(name), new TextRun({ text: `\t${approximateWords(book.words)}` })] }),
    // …the title and byline centred halfway down.
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { ...DOUBLE, before: 3.5 * INCH },
      children: [
        ...onTitle.map((n) => new CommentRangeStart(n)),
        new TextRun(title.toUpperCase()),
        ...onTitle.flatMap((n) => [new CommentRangeEnd(n), new TextRun({ children: [new CommentReference(n)] })]),
      ],
    }),
    ...(name ? [centred(`by ${name}`)] : []),
  ];
  book.chapters.forEach((c, i) => {
    body.push(centred(chapterHeading(c, i), { pageBreakBefore: true, before: 2 * INCH, after: INCH / 2 }));
    scenes(c.scenes, notes, body);
  });
  body.push(centred('END', { before: INCH / 2 }));
  if (book.coldStorage.length) {
    body.push(centred('Cold Storage', { pageBreakBefore: true, before: 2 * INCH, after: INCH / 2 }));
    for (const s of book.coldStorage) {
      body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { ...DOUBLE, before: INCH / 2 }, children: [new TextRun({ text: coldSceneLabel(s), bold: true })] }));
      blocks(s.blocks, notes, body);
    }
  }

  const head = runningHead(title, name);
  const doc = new Document({
    title, creator: name || 'Baretext',
    styles: { default: { document: { run: BODY, paragraph: { spacing: DOUBLE } } } },
    comments: {
      children: book.notes.map((n) => ({
        id: n.n, author: name || 'Baretext', date: new Date(),
        children: n.body.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] })),
      })),
    },
    sections: [{
      properties: { titlePage: true, page: { size: { width: 8.5 * INCH, height: 11 * INCH }, margin: { top: INCH, right: INCH, bottom: INCH, left: INCH, header: INCH / 2 } } },
      headers: {
        first: new Header({ children: [] }),
        default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: SINGLE, children: [new TextRun(`${head} / `), new TextRun({ children: [PageNumber.CURRENT] })] })] }),
      },
      children: body,
    }],
  });
  return Packer.toBuffer(doc);
}
