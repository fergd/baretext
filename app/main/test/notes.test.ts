import { describe, expect, it } from 'vitest';
import { notesPathFor, validNotes } from '../../shared/notes';

const note = { id: 'n1', body: 'Check the dates.', anchor: { scene: 's1', quote: 'In 1987', offset: 4 }, resolved: false, created: 1, updated: 2 };

describe('notes file', () => {
  it('sits beside the manuscript', () => {
    expect(notesPathFor('/books/Novel.md')).toBe('/books/Novel.notes.json');
    expect(notesPathFor('/books/My Book.markdown')).toBe('/books/My Book.notes.json');
  });

  it('keeps well-formed notes, general and anchored', () => {
    const general = { ...note, id: 'n2', anchor: null };
    expect(validNotes({ v: 1, notes: [note, general] })).toEqual([note, general]);
  });

  it('drops anything malformed or duplicated, never trusting it', () => {
    expect(validNotes(null)).toEqual([]);
    expect(validNotes({ notes: 'nope' })).toEqual([]);
    const bad = [
      { ...note, id: 'BAD ID' },
      { ...note, id: 'n3', body: 42 },
      { ...note, id: 'n4', anchor: { scene: 's1', quote: '', offset: 0 } },
      { ...note, id: 'n5', anchor: { scene: 's1', quote: 'x', offset: -1 } },
      note, note, // a duplicate id keeps the first
    ];
    expect(validNotes({ v: 1, notes: bad }).map((n) => n.id)).toEqual(['n1']);
    expect(validNotes({ v: 1, notes: [{ ...note, resolved: 'yes', created: 'then' }] })[0]).toMatchObject({ resolved: false, created: 0 });
  });
});
