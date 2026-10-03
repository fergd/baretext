import { describe, expect, it } from 'vitest';
import { undo, undoDepth } from 'prosemirror-history';
import { docToModel, modelToDoc, setBookSetup, type BookSetup } from '../src';
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
});
