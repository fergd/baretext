import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { ExportBook } from '@baretext/format';
import { buildDocx } from '../export-docx';

const book: ExportBook = {
  title: 'The Garden',
  chapters: [
    { title: 'Spring', scenes: [
      { name: 'label', blocks: [{ type: 'paragraph', content: [{ text: 'Plant ' }, { note: 1, edge: 'start' }, { text: 'basil', italic: true }, { note: 1, edge: 'end' }, { text: ' & thyme <now>.' }] }] },
      { name: null, blocks: [{ type: 'paragraph', content: [{ text: 'Later.' }] }, { type: 'pause' }, { type: 'paragraph', content: [{ text: 'Much later.' }] }] },
    ] },
    { title: '', scenes: [{ name: null, blocks: [{ type: 'paragraph', content: [{ text: 'Two.' }] }] }] },
  ],
  coldStorage: [],
  notes: [{ n: 1, body: 'Right for\nthis climate?', quote: 'basil' }, { n: 2, body: 'The middle sags.', quote: null }],
  words: 120_404,
};

async function open(b: ExportBook, author = 'Ada Q. Lovelace') {
  const zip = await JSZip.loadAsync(await buildDocx(b, author));
  const read = async (name: string) => (await zip.file(name)?.async('string')) ?? '';
  const headers = await Promise.all(Object.keys(zip.files).filter((f) => /^word\/header\d*\.xml$/.test(f)).map(read));
  return { document: await read('word/document.xml'), comments: await read('word/comments.xml'), headers: headers.join('\n'), styles: await read('word/styles.xml') };
}
const texts = (xml: string) => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]);

describe('Word export (standard manuscript format)', () => {
  it('has a title page, chapters (numbered when untitled), "#" breaks, END — and no scene names', async () => {
    const { document } = await open(book);
    const t = texts(document);
    expect(t).toEqual(expect.arrayContaining(['Ada Q. Lovelace', '\tabout 120,000 words', 'THE GARDEN', 'by Ada Q. Lovelace', 'Spring', 'Chapter 2', '#', 'END']));
    expect(t.filter((x) => x === '#')).toHaveLength(2); // between scenes, and the pause
    expect(t).not.toContain('label');
    expect(document).toContain('Plant ');
    expect(document).toContain('&amp; thyme &lt;now&gt;.'); // escaped, never broken XML
    expect((document.match(/<w:pageBreakBefore\/>/g) ?? []).length).toBe(2); // each chapter on a new page
  });

  it('is Times New Roman 12pt, double-spaced, first lines indented ½"', async () => {
    const { document, styles } = await open(book);
    expect(styles).toContain('Times New Roman');
    expect(styles).toMatch(/<w:sz w:val="24"\/>/);
    expect(styles).toMatch(/<w:spacing w:line="480"\/>/);
    expect(document).toMatch(/<w:ind w:firstLine="720"\/>/);
  });

  it('runs "Surname / TITLE / page" on every page but the first', async () => {
    const { headers, document } = await open(book);
    expect(headers).toContain('Lovelace / THE GARDEN / ');
    expect(headers).toContain('PAGE');
    expect(document).toContain('<w:titlePg/>');
  });

  it('turns notes into comments on their passages (general notes on the title)', async () => {
    const { document, comments } = await open(book);
    expect(texts(comments)).toEqual(['Right for', 'this climate?', 'The middle sags.']);
    expect(document).toMatch(/<w:commentRangeStart w:id="1"\/>.*basil.*<w:commentRangeEnd w:id="1"\/>/s);
    expect(document).toMatch(/<w:commentRangeStart w:id="2"\/>.*THE GARDEN.*<w:commentRangeEnd w:id="2"\/>/s);
  });

  it('without an author: no byline, and the running head is just the title', async () => {
    const { document, headers } = await open(book, '  ');
    expect(texts(document).some((x) => x?.startsWith('by '))).toBe(false);
    expect(headers).toContain('THE GARDEN / ');
  });
});
