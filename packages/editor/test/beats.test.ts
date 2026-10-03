import { describe, expect, it } from 'vitest';
import { undo, undoDepth } from 'prosemirror-history';
import { docToModel, modelToDoc, moveScene, moveToColdStorage, setBeat, splitScene } from '../src';
import { harness, sampleManuscript } from './helpers';

// sampleManuscript: c1 "One" → s1 (unnamed), s2 "Two"; c2 "Next" → s3 (unnamed); cold storage k1.
const beats = (h: ReturnType<typeof harness>) => Object.fromEntries(
  [...h.model().chapters.flatMap((c) => c.scenes), ...h.model().coldStorage].filter((s) => s.beat).map((s) => [s.id, s.beat]),
);

describe('story beats, by scene (DECISIONS §27)', () => {
  it('travel between the model and the document', () => {
    const m = sampleManuscript();
    m.chapters[0]!.scenes[1]!.beat = 'midpoint';
    expect(docToModel(modelToDoc(m)).chapters[0]!.scenes[1]!.beat).toBe('midpoint');
  });

  it('marks a scene, its text and the caret untouched; one undo step', () => {
    const h = harness();
    h.cursor(h.at('Gamma.', 2));
    const text = h.text();
    const depth = undoDepth(h.state);
    expect(h.run(setBeat('s2', 'midpoint'))).toBe(true);
    expect(beats(h)).toEqual({ s2: 'midpoint' });
    expect(h.text()).toBe(text);
    expect(h.state.doc.textBetween(h.state.selection.head - 2, h.state.selection.head)).toBe('Ga');
    expect(undoDepth(h.state)).toBe(depth + 1);
    h.run(undo);
    expect(beats(h)).toEqual({});
  });

  it('a beat belongs to one scene: marking another moves it (in the same step)', () => {
    const h = harness();
    h.run(setBeat('s1', 'midpoint'));
    h.run(setBeat('s3', 'midpoint'));
    expect(beats(h)).toEqual({ s3: 'midpoint' });
    h.run(undo);
    expect(beats(h)).toEqual({ s1: 'midpoint' });
  });

  it('a scene has one beat; null clears it; marking it again changes nothing', () => {
    const h = harness();
    h.run(setBeat('s1', 'midpoint'));
    h.run(setBeat('s1', 'climax'));
    expect(beats(h)).toEqual({ s1: 'climax' });
    expect(h.run(setBeat('s1', 'climax'))).toBe(false);
    expect(h.run(setBeat('s1', null))).toBe(true);
    expect(beats(h)).toEqual({});
    expect(h.run(setBeat('nope', 'climax'))).toBe(false);
    expect(h.run(setBeat('s1', 'Not An Id'))).toBe(false);
    expect(h.rejected).toBe(0);
  });

  it('travels with its scene (moved, or into Cold Storage); a split leaves it on the first half', () => {
    const h = harness();
    h.run(setBeat('s1', 'midpoint'));
    h.run(moveScene('s1', 'c2', 1));
    expect(beats(h)).toEqual({ s1: 'midpoint' });
    h.cursor(h.at('Alpha last.'));
    expect(h.run(splitScene)).toBe(true);
    expect(h.model().chapters[1]!.scenes).toHaveLength(3); // (it did split)
    expect(beats(h)).toEqual({ s1: 'midpoint' });
    h.run(moveToColdStorage('s1'));
    expect(h.model().coldStorage.find((s) => s.id === 's1')?.beat).toBe('midpoint');
  });
});
