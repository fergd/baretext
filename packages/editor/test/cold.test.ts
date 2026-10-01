import { describe, expect, it } from 'vitest';
import { undo, undoDepth } from 'prosemirror-history';
import { AllSelection, TextSelection } from 'prosemirror-state';
import { closeParked, deleteChapter, deleteScene, moveToColdStorage, openParked, parkedKey, rename, restoreFromColdStorage } from '../src';
import { harness } from './helpers';

// c1 "One" → s1 (Alpha first./Alpha last.), s2 "Two" (Beta only.); c2 "Next" → s3 (Gamma.); cold storage k1 (Cut.).
const ids = (h: ReturnType<typeof harness>) => h.model().chapters.map((c) => [c.id, ...c.scenes.map((s) => s.id)]);
const cold = (h: ReturnType<typeof harness>) => h.model().coldStorage.map((s) => s.id);
const caretText = (h: ReturnType<typeof harness>) => h.state.selection.$head.parent.textContent;

describe('moving to Cold Storage', () => {
  it('moves the scene whole (newest first), remembering where it came from', () => {
    const h = harness();
    const before = h.model().chapters[0]!.scenes[1]!;
    expect(h.run(moveToColdStorage('s2'))).toBe(true);
    expect(ids(h)).toEqual([['c1', 's1'], ['c2', 's3']]);
    expect(cold(h)).toEqual(['s2', 'k1']);
    expect(h.model().coldStorage[0]).toEqual({ ...before, origin: { chapter: 'c1', index: 1 } });
    expect(h.rejected).toBe(0);
  });

  it("a chapter's only scene leaves an empty scene; the caret moves to the nearest prose", () => {
    const h = harness();
    h.cursor(h.at('Gamma.', 2));
    h.run(moveToColdStorage('s3'));
    expect(h.model().chapters[1]!.scenes).toHaveLength(1);
    expect(h.model().chapters[1]!.scenes[0]!.id).not.toBe('s3');
    expect(h.state.selection.$head.parent.type.name).toBe('paragraph');
    expect(h.state.selection.from).toBeLessThan(h.state.doc.content.size - h.state.doc.lastChild!.nodeSize);
  });

  it('is one undo step; parked and unknown scenes are refused', () => {
    const h = harness();
    const original = h.state.doc;
    h.run(moveToColdStorage('s1'));
    expect(undoDepth(h.state)).toBe(1);
    h.run(undo);
    expect(h.state.doc.eq(original)).toBe(true);
    expect(h.run(moveToColdStorage('k1'))).toBe(false);
    expect(h.run(moveToColdStorage('nope'))).toBe(false);
  });
});

describe('restoring from Cold Storage', () => {
  it('puts the scene back where it came from, and forgets the origin', () => {
    const h = harness();
    h.run(moveToColdStorage('s2'));
    expect(h.run(restoreFromColdStorage('s2'))).toBe(true);
    expect(ids(h)).toEqual([['c1', 's1', 's2'], ['c2', 's3']]);
    expect(cold(h)).toEqual(['k1']);
    expect(h.model().chapters[0]!.scenes[1]!.origin).toBeUndefined();
  });

  it('if its chapter is gone, it goes to the end of the last chapter; without an origin, too', () => {
    const h = harness();
    h.run(moveToColdStorage('s3'));
    h.run(deleteChapter('c2'));
    h.run(restoreFromColdStorage('s3'));
    expect(ids(h)).toEqual([['c1', 's1', 's2', 's3']]);
    h.run(restoreFromColdStorage('k1')); // never had an origin
    expect(ids(h)[0]!.at(-1)).toBe('k1');
  });

  it('can restore to a chosen place (dragging into the outline)', () => {
    const h = harness();
    h.run(restoreFromColdStorage('k1', 'c2', 0));
    expect(ids(h)).toEqual([['c1', 's1', 's2'], ['c2', 'k1', 's3']]);
  });

  it('an index past the end clamps; one undo step', () => {
    const h = harness();
    const original = h.state.doc;
    h.run(restoreFromColdStorage('k1', 'c1', 99));
    expect(ids(h)[0]!.at(-1)).toBe('k1');
    h.run(undo);
    expect(h.state.doc.eq(original)).toBe(true);
  });
});

describe('opening a parked scene', () => {
  it('puts the caret in it, lets the writer edit it, and keeps the caret inside it', () => {
    const h = harness();
    expect(h.run(openParked('k1'))).toBe(true);
    expect(parkedKey.getState(h.state)).toBe('k1');
    expect(caretText(h)).toBe('Cut.');
    h.state = h.state.apply(h.state.tr.insertText('Not ', h.state.selection.from));
    expect(h.rejected).toBe(0);
    expect(h.model().coldStorage[0]!.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Not Cut.' }] }]);
    // The caret can't leave the open scene.
    h.cursor(h.at('Beta'));
    expect(caretText(h)).toBe('Not Cut.');
    // Select All stays inside it.
    h.state = h.state.apply(h.state.tr.setSelection(new AllSelection(h.state.doc)));
    expect(h.state.doc.textBetween(h.state.selection.from, h.state.selection.to)).toBe('Not Cut.');
  });

  it('closed, parked text can only change through commands (typing into it is refused)', () => {
    const h = harness();
    const coldPos = h.state.doc.content.size - 3; // inside k1's paragraph
    h.state = h.state.apply(h.state.tr.insertText('x', coldPos));
    expect(h.rejected).toBe(1);
    expect(h.model().coldStorage[0]!.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Cut.' }] }]);
  });

  it('while one parked scene is open, the manuscript and other parked scenes stay protected', () => {
    const h = harness();
    h.run(moveToColdStorage('s2'));
    h.run(openParked('k1'));
    const rejected = h.rejected;
    const s2Text = h.state.doc.lastChild!.firstChild!; // s2, first in cold storage
    h.state = h.state.apply(h.state.tr.insertText('x', h.state.doc.content.size - h.state.doc.lastChild!.nodeSize + 3 + s2Text.firstChild!.nodeSize));
    expect(h.rejected).toBe(rejected + 1);
  });

  it('closing returns the caret to the manuscript; restoring or deleting the open scene closes it', () => {
    const h = harness();
    const at = h.at('Beta', 2);
    h.run(openParked('k1'));
    h.run(closeParked(at));
    expect(parkedKey.getState(h.state)).toBe(null);
    expect(caretText(h)).toBe('Beta only.');
    h.run(openParked('k1'));
    h.run(restoreFromColdStorage('k1'));
    expect(parkedKey.getState(h.state)).toBe(null);
    h.run(moveToColdStorage('s1'));
    h.run(openParked('s1'));
    h.run(deleteScene('s1'));
    expect(parkedKey.getState(h.state)).toBe(null);
    expect(h.state.selection).toBeInstanceOf(TextSelection);
  });

  it('parked scenes can be renamed and deleted like any scene', () => {
    const h = harness();
    expect(h.run(rename('k1', 'The cut'))).toBe(true);
    expect(h.model().coldStorage[0]!.name).toBe('The cut');
    expect(h.run(deleteScene('k1'))).toBe(true);
    expect(cold(h)).toEqual([]);
    expect(h.rejected).toBe(0);
  });
});

describe('opening a named parked scene', () => {
  it('puts the caret on its first line of prose, not in its name', () => {
    const h = harness();
    h.run(moveToColdStorage('s2')); // "Two": named
    h.run(openParked('s2'));
    expect(h.state.selection.$head.parent.type.name).toBe('paragraph');
    expect(caretText(h)).toBe('Beta only.');
    expect(h.state.selection.$head.parentOffset).toBe(0);
  });
});
