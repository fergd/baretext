import { describe, expect, it } from 'vitest';
import { undo } from 'prosemirror-history';
import { addNoteAnchor, anchorsIn, applyAnchors, deleteScene, docToModel, flattenPastedSlice, locateAnchor, moveToColdStorage, removeNoteAnchor, describeAnchor } from '../src';
import { harness } from './helpers';

// c1 "One" → s1 (Alpha first./Alpha last.), s2 "Two" (Beta only.); c2 "Next" → s3 (Gamma.); cold k1 (Cut.).
const select = (h: ReturnType<typeof harness>, text: string) => h.select(h.at(text), h.at(text) + text.length);
const anchored = (h: ReturnType<typeof harness>, id: string) => {
  const a = anchorsIn(h.state.doc).get(id);
  return a ? h.state.doc.textBetween(a.from, a.to, '\n') : null;
};

describe('note anchors', () => {
  it('anchor a passage without touching the prose (the saved manuscript is unchanged)', () => {
    const h = harness();
    const before = h.model();
    select(h, 'first');
    expect(h.run(addNoteAnchor('n1'))).toBe(true);
    expect(anchored(h, 'n1')).toBe('first');
    expect(docToModel(h.state.doc)).toEqual(before);
    expect(h.rejected).toBe(0);
  });

  it('follow the text through edits around and inside them', () => {
    const h = harness();
    select(h, 'Alpha first');
    h.run(addNoteAnchor('n1'));
    h.state = h.state.apply(h.state.tr.insertText('Well. ', h.at('Alpha first')));
    h.state = h.state.apply(h.state.tr.insertText(' very', h.at('Alpha first') + 'Alpha'.length));
    expect(anchored(h, 'n1')).toBe('Alpha very first');
    // Typing at its edges doesn't stretch it.
    h.state = h.state.apply(h.state.tr.insertText('!', h.at('Alpha very first') + 'Alpha very first'.length));
    expect(anchored(h, 'n1')).toBe('Alpha very first');
  });

  it('may overlap, and only attach within one scene', () => {
    const h = harness();
    select(h, 'Alpha first');
    h.run(addNoteAnchor('n1'));
    select(h, 'first');
    h.run(addNoteAnchor('n2'));
    expect([anchored(h, 'n1'), anchored(h, 'n2')]).toEqual(['Alpha first', 'first']);
    h.select(h.at('Alpha last'), h.at('Beta') + 2); // across two scenes
    expect(h.run(addNoteAnchor('n3'))).toBe(false);
  });

  it('are not undo steps; undoing a deletion brings the anchor back with the text', () => {
    const h = harness();
    h.cursor(h.at('Gamma.'));
    h.state = h.state.apply(h.state.tr.insertText('x'));
    select(h, 'Beta');
    h.run(addNoteAnchor('n1'));
    h.run(undo); // undoes the typing, not the anchor
    expect(anchored(h, 'n1')).toBe('Beta');
    const from = h.at('Beta');
    h.state = h.state.apply(h.state.tr.delete(from, from + 'Beta only.'.length));
    expect(anchorsIn(h.state.doc).has('n1')).toBe(false);
    h.run(undo);
    expect(anchored(h, 'n1')).toBe('Beta');
  });

  it('travel with their scene to Cold Storage; are lost when their scene is deleted', () => {
    const h = harness();
    select(h, 'Beta');
    h.run(addNoteAnchor('n1'));
    h.run(moveToColdStorage('s2'));
    expect(anchored(h, 'n1')).toBe('Beta');
    expect(anchorsIn(h.state.doc).get('n1')!.scene).toBe('s2');
    h.run(deleteScene('s2'));
    expect(anchorsIn(h.state.doc).has('n1')).toBe(false);
  });

  it('can be removed', () => {
    const h = harness();
    select(h, 'Gamma');
    h.run(addNoteAnchor('n1'));
    expect(h.run(removeNoteAnchor('n1'))).toBe(true);
    expect(anchorsIn(h.state.doc).has('n1')).toBe(false);
  });

  it('describe themselves for saving, and are found again from that on reopening', () => {
    const h = harness();
    select(h, 'last');
    h.run(addNoteAnchor('n1'));
    const saved = describeAnchor(h.state.doc, anchorsIn(h.state.doc).get('n1')!);
    expect(saved).toEqual({ scene: 's1', quote: 'last', offset: 'Alpha first.\nAlpha '.length });

    // A fresh document (as after reopening the file) has no anchors; locate and apply them.
    const fresh = harness();
    const range = locateAnchor(fresh.state.doc, saved);
    expect(range).not.toBeNull();
    fresh.state = fresh.state.apply(applyAnchors(fresh.state, [{ id: 'n1', ...range! }]));
    expect(fresh.state.doc.textBetween(anchorsIn(fresh.state.doc).get('n1')!.from, anchorsIn(fresh.state.doc).get('n1')!.to)).toBe('last');
    expect(fresh.rejected).toBe(0);
  });

  it('a quote edited outside the app is found nearest its old place, or not at all', () => {
    const h = harness();
    const r = locateAnchor(h.state.doc, { scene: 's1', quote: 'Alpha', offset: 13 })!; // the second "Alpha"
    expect(h.state.doc.textBetween(r.from, r.to)).toBe('Alpha');
    expect(r.from).toBe(h.at('Alpha last'));
    expect(locateAnchor(h.state.doc, { scene: 's1', quote: 'Not there', offset: 0 })).toBeNull();
    // Its scene gone, the quote is looked for in the whole book.
    expect(locateAnchor(h.state.doc, { scene: 'gone', quote: 'Gamma', offset: 0 })).not.toBeNull();
  });

  it('a copy-paste never duplicates an anchor; a cut-paste keeps it (the passage moved)', () => {
    const h = harness();
    select(h, 'Beta');
    h.run(addNoteAnchor('n1'));
    const slice = h.state.doc.slice(h.at('Beta'), h.at('Beta') + 4);
    const copied = flattenPastedSlice(slice, h.state);
    let kept = false;
    copied.content.descendants((n) => { if (n.marks.some((m) => m.type.name === 'note')) kept = true; });
    expect(kept).toBe(false);
    const from = h.at('Beta');
    h.state = h.state.apply(h.state.tr.delete(from, from + 4)); // cut
    const pasted = flattenPastedSlice(slice, h.state);
    pasted.content.descendants((n) => { if (n.marks.some((m) => m.type.name === 'note')) kept = true; });
    expect(kept).toBe(true);
  });
});
