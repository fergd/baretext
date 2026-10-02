import { describe, expect, it } from 'vitest';
import { approximateWords, exportMarkdown, exportText, isExportBook, type ExportBook } from '../src';

const book = (over: Partial<ExportBook> = {}): ExportBook => ({
  title: 'The Garden',
  chapters: [
    {
      title: 'Spring',
      scenes: [
        { name: 'working label', blocks: [
          { type: 'paragraph', content: [{ text: 'Plant ' }, { note: 1, edge: 'start' }, { text: 'basil', italic: true }, { text: ' ' }, { note: 1, edge: 'end' }, { text: 'and *thyme*.' }] },
          { type: 'paragraph', content: [] },
          { type: 'pause' },
          { type: 'paragraph', content: [{ text: '# not a heading', bold: true }] },
        ] },
        { name: null, blocks: [{ type: 'quote', paragraphs: [[{ text: 'A quote.' }], [{ text: 'Its second line.' }]] }] },
      ],
    },
    { title: '  ', scenes: [{ name: null, blocks: [{ type: 'paragraph', content: [{ text: 'See ' }, { text: 'here', link: 'https://example.com' }, { text: '.' }] }] }] },
  ],
  coldStorage: [],
  notes: [],
  words: 20,
  ...over,
});

describe('Markdown export', () => {
  it('is clean Markdown: title, chapters (numbered when untitled), breaks, escapes; no scene names or empty lines', () => {
    expect(exportMarkdown(book())).toBe([
      '# The Garden', '',
      '## Spring', '',
      'Plant *basil* and \\*thyme\\*.', '',
      '* * *', '',
      '**# not a heading**', '', // starts with "**": never a heading
      '* * *', '',
      '> A quote.', '>', '> Its second line.', '',
      '## Chapter 2', '',
      'See [here](https://example.com).',
    ].join('\n') + '\n');
  });

  it('notes become footnotes at the end of their passage (before its trailing space); general notes a Notes section', () => {
    const md = exportMarkdown(book({ notes: [{ n: 1, body: 'Right for\nthis climate?', quote: 'basil ' }, { n: 2, body: 'The middle sags.', quote: null }] }));
    expect(md).toContain('Plant *basil*[^1] and');
    expect(md).toContain('## Notes\n\nThe middle sags.\n');
    expect(md.endsWith('[^1]: Right for\\\n    this climate?\n')).toBe(true);
  });

  it('Cold Storage, when included, comes after the book with its scenes labelled', () => {
    const md = exportMarkdown(book({ coldStorage: [{ name: 'Cut', blocks: [{ type: 'paragraph', content: [{ text: 'Gone.' }] }] }, { name: null, blocks: [] }] }));
    expect(md).toContain('## Cold Storage\n\n### Cut\n\nGone.\n\n### Untitled scene');
  });
});

describe('plain text export', () => {
  it('has no markup: marks dropped, links spelled out, quotes indented, note markers as [n]', () => {
    const txt = exportText(book({ notes: [{ n: 1, body: 'Right?', quote: 'basil' }, { n: 2, body: 'Sags.', quote: null }] }));
    expect(txt).toBe([
      'The Garden', '', '',
      'Spring', '',
      'Plant basil[1] and *thyme*.', '',
      '* * *', '',
      '# not a heading', '',
      '* * *', '',
      '    A quote.', '',
      '    Its second line.', '', '',
      'Chapter 2', '',
      'See here (https://example.com).', '', '',
      'Notes', '',
      '[1] “basil”', '    Right?', '',
      'Sags.',
    ].join('\n') + '\n');
  });
});

describe('word count line', () => {
  it('rounds a book to thousands and a short piece to hundreds', () => {
    expect(approximateWords(120_404)).toBe('about 120,000 words');
    expect(approximateWords(2_349)).toBe('about 2,300 words');
    expect(approximateWords(12)).toBe('about 100 words');
  });
});

describe('a book from the window', () => {
  it('is checked before anything is built from it', () => {
    expect(isExportBook(book())).toBe(true);
    for (const bad of [null, 'book', {}, { ...book(), title: 1 }, { ...book(), chapters: [{ title: 'x' }] }, { ...book(), notes: [{ n: 'one', body: '' }] }, { ...book(), coldStorage: [{}] }, { ...book(), words: NaN }]) {
      expect(isExportBook(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
