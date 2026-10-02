import { describe, expect, it } from 'vitest';
import { exportMarkdown } from '@baretext/format';
import { addNoteAnchor, docToExport, openParked } from '../src';
import { harness } from './helpers';

// Book: c1 "One" [s1: Alpha first. / Alpha last.] [s2 "Two": Beta only.]; c2 "Next" [s3: Gamma.]; cold [k1: Cut.]
function noted(...anchors: Array<[string, string]>) {
  const h = harness();
  for (const [id, text] of anchors) {
    if (text === 'Cut.') h.run(openParked('k1'));
    h.select(h.at(text), h.at(text, text.length));
    expect(h.run(addNoteAnchor(id))).toBe(true);
  }
  return h;
}

describe('docToExport', () => {
  it('is the book: chapters and prose, no scene names, no Cold Storage unless asked; words counted', () => {
    const h = harness();
    const book = docToExport(h.state.doc, { coldStorage: false, notes: null });
    expect(book.title).toBe('Book');
    expect(book.chapters.map((c) => c.title)).toEqual(['One', 'Next']);
    expect(book.coldStorage).toEqual([]);
    expect(book.notes).toEqual([]);
    expect(book.words).toBe(7);
    expect(docToExport(h.state.doc, { coldStorage: true, notes: null }).coldStorage).toHaveLength(1);
    expect(docToExport(h.state.doc, { coldStorage: true, notes: null }).words).toBe(8);
  });

  it('marks where each note’s passage starts and ends, numbered in reading order; general and orphaned notes after', () => {
    const h = noted(['b', 'Gamma.'], ['a', 'first.']);
    const notes = [
      { id: 'b', body: 'Second?', anchored: true },
      { id: 'g', body: 'The middle sags.', anchored: false },
      { id: 'a', body: 'First!', anchored: true },
      { id: 'lost', body: 'Its passage was deleted.', anchored: true },
    ];
    const book = docToExport(h.state.doc, { coldStorage: false, notes });
    expect(book.notes).toEqual([
      { n: 1, body: 'First!', quote: 'first.' },
      { n: 2, body: 'Second?', quote: 'Gamma.' },
      { n: 3, body: 'The middle sags.', quote: null },
      { n: 4, body: 'Its passage was deleted.', quote: null },
    ]);
    const first = book.chapters[0]!.scenes[0]!.blocks[0]!;
    expect(first).toEqual({ type: 'paragraph', content: [{ text: 'Alpha ' }, { note: 1, edge: 'start' }, { text: 'first.' }, { note: 1, edge: 'end' }] });
    expect(exportMarkdown(book)).toContain('Alpha first.[^1]');
  });

  it('a note about a parked scene goes only with Cold Storage', () => {
    const h = noted(['c', 'Cut.']);
    const notes = [{ id: 'c', body: 'Keep?', anchored: true }];
    expect(docToExport(h.state.doc, { coldStorage: false, notes }).notes).toEqual([]);
    expect(docToExport(h.state.doc, { coldStorage: true, notes }).notes).toEqual([{ n: 1, body: 'Keep?', quote: 'Cut.' }]);
  });
});
