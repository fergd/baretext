import { describe, expect, it } from 'vitest';
import { undo, undoDepth } from 'prosemirror-history';
import { docToModel, modelToDoc, setBeat, setBookSetup, type BookSetup } from '../src';
import { harness, sampleManuscript } from './helpers';

const setup = (over: Partial<BookSetup> = {}): BookSetup => ({ title: 'Sample', author: '', structure: null, target: null, ...over });

describe('book setup (DECISIONS §26)', () => {
  it('travels between the model and the document; unset stays unset', () => {
    const m = { ...sampleManuscript(), author: 'Ann Lee', structure: 'three-act', target: 90000 };
    expect(docToModel(modelToDoc(m))).toMatchObject({ author: 'Ann Lee', structure: 'three-act', target: 90000 });
    const plain = docToModel(modelToDoc(sampleManuscript()));
    expect('author' in plain || 'structure' in plain || 'target' in plain).toBe(false);
  });

  it('sets the title, author, structure and target in one step, the caret where it was; one undo puts it all back', () => {
    const h = harness();
    h.cursor(h.at('Gamma.', 2));
    const caret = h.state.selection.head;
    const before = h.model();
    const depth = undoDepth(h.state);
    expect(h.run(setBookSetup(setup({ title: 'The Keeper', author: '  Ann Lee ', structure: 'three-act', target: 90000 })))).toBe(true);
    expect(h.model()).toMatchObject({ title: 'The Keeper', author: 'Ann Lee', structure: 'three-act', target: 90000 });
    expect(h.state.doc.textBetween(h.state.selection.head - 2, h.state.selection.head)).toBe('Ga');
    expect(h.state.selection.head - caret).toBe('The Keeper'.length - before.title.length); // (only the title above it changed)
    expect(undoDepth(h.state)).toBe(depth + 1);
    expect(h.rejected).toBe(0);
    h.run(undo);
    expect(h.model()).toEqual(before);
  });

  it('clearing a field unsets it', () => {
    const h = harness({ ...sampleManuscript(), author: 'Ann Lee', structure: 'three-act', target: 90000 });
    expect(h.run(setBookSetup(setup({ title: h.model().title })))).toBe(true);
    const m = h.model();
    expect('author' in m || 'structure' in m || 'target' in m).toBe(false);
  });

  it('nothing different: nothing happens (no undo step)', () => {
    const h = harness({ ...sampleManuscript(), author: 'Ann Lee' });
    const depth = undoDepth(h.state);
    expect(h.run(setBookSetup(setup({ title: h.model().title, author: 'Ann Lee ' })))).toBe(false);
    expect(undoDepth(h.state)).toBe(depth);
  });

  it('refuses what could not be saved: a target that isn’t a whole number of words, a structure that isn’t an id', () => {
    const h = harness();
    for (const target of [0, 2.5, -1]) expect(h.run(setBookSetup(setup({ target })))).toBe(false);
    expect(h.run(setBookSetup(setup({ structure: 'Three Acts' })))).toBe(false);
    expect(h.model().target).toBeUndefined();
  });

  describe('choosing another structure (DECISIONS §27)', () => {
    // sampleManuscript: s1, s2 (c1), s3 (c2); k1 parked. The new structure has "midpoint" and "climax".
    const keep = (beat: string) => beat === 'midpoint' || beat === 'climax';
    const beatsOf = (h: ReturnType<typeof harness>) => Object.fromEntries([...h.model().chapters.flatMap((c) => c.scenes), ...h.model().coldStorage].filter((s) => s.beat).map((s) => [s.id, s.beat]));
    const marked = () => {
      const h = harness({ ...sampleManuscript(), structure: 'save-the-cat' });
      h.run(setBeat('s1', 'catalyst'));
      h.run(setBeat('s2', 'midpoint'));
      h.run(setBeat('k1', 'finale'));
      return h;
    };

    it('clears the beats the new structure doesn’t have, keeps the shared ones, in the same single undo step', () => {
      const h = marked();
      const depth = undoDepth(h.state);
      expect(h.run(setBookSetup(setup({ title: 'Book', structure: 'three-act' }), keep))).toBe(true);
      expect(beatsOf(h)).toEqual({ s2: 'midpoint' }); // (Cold Storage's too)
      expect(undoDepth(h.state)).toBe(depth + 1);
      h.run(undo);
      expect(beatsOf(h)).toEqual({ s1: 'catalyst', s2: 'midpoint', k1: 'finale' });
      expect(h.model().structure).toBe('save-the-cat');
    });

    it('leaves every beat alone when the structure doesn’t change (or when told to keep what it can’t judge)', () => {
      const h = marked();
      expect(h.run(setBookSetup(setup({ title: 'Book', structure: 'save-the-cat', target: 80000 }), () => false))).toBe(true);
      expect(Object.keys(beatsOf(h))).toHaveLength(3);
      expect(h.run(setBookSetup(setup({ title: 'Book', structure: 'a-newer-structure', target: 80000 })))).toBe(true); // (no judge: all kept)
      expect(Object.keys(beatsOf(h))).toHaveLength(3);
    });

    it('with no structure, no beat is kept', () => {
      const h = marked();
      expect(h.run(setBookSetup(setup({ title: 'Book' }), () => false))).toBe(true);
      expect(beatsOf(h)).toEqual({});
    });
  });
});
