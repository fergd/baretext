import { describe, expect, it } from 'vitest';
import { undo, undoDepth } from 'prosemirror-history';
import { moveChapter, moveScene, schema } from '../src';
import { harness, sampleManuscript, scene } from './helpers';
import type { Manuscript } from '@baretext/format';

// c1 "One" → s1, s2 "Two"; c2 "Next" → s3; cold storage k1.
const ids = (h: ReturnType<typeof harness>) => h.model().chapters.map((c) => [c.id, ...c.scenes.map((s) => s.id)]);
const caretText = (h: ReturnType<typeof harness>) => h.state.selection.$head.parent.textContent;

function bigger(): Manuscript {
  const m = sampleManuscript();
  m.chapters.push({ id: 'c3', title: 'Last', scenes: [scene('s4', ['Delta.']), scene('s5', ['Epsilon.'])] });
  return m;
}

describe('moving scenes', () => {
  it('within a chapter: to a new index, prose and identity intact', () => {
    const h = harness();
    const before = h.model().chapters[0]!.scenes[0]!;
    expect(h.run(moveScene('s1', 'c1', 1))).toBe(true);
    expect(ids(h)).toEqual([['c1', 's2', 's1'], ['c2', 's3']]);
    expect(h.model().chapters[0]!.scenes[1]).toEqual(before);
    expect(h.rejected).toBe(0);
  });

  it('into another chapter, at the start, middle or end', () => {
    const h = harness(bigger());
    h.run(moveScene('s2', 'c3', 1));
    expect(ids(h)).toEqual([['c1', 's1'], ['c2', 's3'], ['c3', 's4', 's2', 's5']]);
    h.run(moveScene('s5', 'c2', 0));
    expect(ids(h)).toEqual([['c1', 's1'], ['c2', 's5', 's3'], ['c3', 's4', 's2']]);
    h.run(moveScene('s4', 'c1', 1));
    expect(ids(h)).toEqual([['c1', 's1', 's4'], ['c2', 's5', 's3'], ['c3', 's2']]);
  });

  it("never empties a chapter: its only scene can't leave", () => {
    const h = harness();
    expect(h.run(moveScene('s3', 'c1', 0))).toBe(false);
    expect(ids(h)).toEqual([['c1', 's1', 's2'], ['c2', 's3']]);
  });

  it('a move to where it already is changes nothing', () => {
    const h = harness();
    expect(h.run(moveScene('s2', 'c1', 1))).toBe(false);
    expect(undoDepth(h.state)).toBe(0);
  });

  it('the caret travels with its scene, at the same spot', () => {
    const h = harness(bigger());
    h.cursor(h.at('Alpha last.', 3));
    h.run(moveScene('s1', 'c3', 2));
    expect(caretText(h)).toBe('Alpha last.');
    expect(h.state.selection.$head.parentOffset).toBe(3);
    // A caret elsewhere stays in its own text.
    h.cursor(h.at('Gamma.', 2));
    h.run(moveScene('s4', 'c1', 0));
    expect(caretText(h)).toBe('Gamma.');
    expect(h.state.selection.$head.parentOffset).toBe(2);
  });

  it('is one undo step, and undo puts everything back', () => {
    const h = harness(bigger());
    const original = h.state.doc;
    h.run(moveScene('s2', 'c3', 2));
    h.run(moveScene('s4', 'c1', 0));
    expect(undoDepth(h.state)).toBe(2);
    h.run(undo);
    h.run(undo);
    expect(h.state.doc.eq(original)).toBe(true);
  });

  it('refuses unknown or parked scenes and unknown chapters', () => {
    const h = harness();
    expect(h.run(moveScene('k1', 'c1', 0))).toBe(false);
    expect(h.run(moveScene('nope', 'c1', 0))).toBe(false);
    expect(h.run(moveScene('s1', 'nope', 0))).toBe(false);
    expect(h.model().coldStorage.map((s) => s.id)).toEqual(['k1']);
  });

  it('clamps an index past the end to the end', () => {
    const h = harness();
    h.run(moveScene('s1', 'c2', 99));
    expect(ids(h)).toEqual([['c1', 's2'], ['c2', 's3', 's1']]);
  });
});

describe('moving chapters', () => {
  it('moves a whole chapter with its scenes; cold storage stays last', () => {
    const h = harness(bigger());
    h.run(moveChapter('c3', 0));
    expect(ids(h)).toEqual([['c3', 's4', 's5'], ['c1', 's1', 's2'], ['c2', 's3']]);
    h.run(moveChapter('c3', 2));
    expect(ids(h)).toEqual([['c1', 's1', 's2'], ['c2', 's3'], ['c3', 's4', 's5']]);
    expect(h.state.doc.lastChild!.type).toBe(schema.nodes.cold_storage);
    expect(h.model().coldStorage.map((s) => s.id)).toEqual(['k1']);
  });

  it('keeps the caret in its text and refuses no-op or unknown moves', () => {
    const h = harness(bigger());
    h.cursor(h.at('Beta only.', 4));
    h.run(moveChapter('c1', 2));
    expect(caretText(h)).toBe('Beta only.');
    expect(h.state.selection.$head.parentOffset).toBe(4);
    expect(h.run(moveChapter('c1', 2))).toBe(false);
    expect(h.run(moveChapter('nope', 0))).toBe(false);
  });
});
