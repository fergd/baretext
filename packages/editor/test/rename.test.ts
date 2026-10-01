import { describe, expect, it } from 'vitest';
import { undo, undoDepth } from 'prosemirror-history';
import { BOOK_TITLE, rename } from '../src';
import { harness } from './helpers';

// sampleManuscript: c1 "One" → s1 (unnamed), s2 "Two"; c2 "Next" → s3 (unnamed); cold storage k1.
const names = (h: ReturnType<typeof harness>) => h.model().chapters.map((c) => c.scenes.map((s) => s.name));

describe('rename (outline)', () => {
  it('renames a named scene, keeping its prose, caret and identity', () => {
    const h = harness();
    h.cursor(h.at('Gamma.', 2));
    const before = h.model().chapters[0]!.scenes[1]!.blocks;
    expect(h.run(rename('s2', 'Dusk'))).toBe(true);
    expect(names(h)).toEqual([[null, 'Dusk'], [null]]);
    expect(h.model().chapters[0]!.scenes[1]!.blocks).toEqual(before);
    const { head, $head } = h.state.selection;
    expect($head.parent.textContent).toBe('Gamma.'); // caret still in Gamma, same offset
    expect(h.state.doc.textBetween(head - 2, head)).toBe('Ga');
    expect(h.rejected).toBe(0);
  });

  it('names an unnamed scene, and the caret stays on its line', () => {
    const h = harness();
    h.cursor(h.at('Alpha last.', 5));
    expect(h.run(rename('s1', 'Dawn'))).toBe(true);
    expect(names(h)).toEqual([['Dawn', 'Two'], [null]]);
    const { head } = h.state.selection;
    expect(h.state.doc.textBetween(head - 5, head)).toBe('Alpha');
    expect(h.state.selection.$head.parent.textContent).toBe('Alpha last.');
  });

  it('a blank name makes the scene unnamed (never a stray empty name)', () => {
    const h = harness();
    expect(h.run(rename('s2', '   '))).toBe(true);
    expect(names(h)).toEqual([[null, null], [null]]);
    // Blank on an unnamed scene changes nothing.
    expect(h.run(rename('s1', ''))).toBe(false);
  });

  it('renames chapters and the book; a blank chapter title is allowed', () => {
    const h = harness();
    h.run(rename('c2', 'Later'));
    h.run(rename(BOOK_TITLE, 'The Book'));
    expect(h.model().title).toBe('The Book');
    expect(h.model().chapters.map((c) => c.title)).toEqual(['One', 'Later']);
    h.run(rename('c1', ''));
    expect(h.model().chapters[0]!.title).toBe('');
  });

  it('keeps names on one line and trims the ends', () => {
    const h = harness();
    h.run(rename('s2', '  Night\nfalls\tslowly  '));
    expect(names(h)[0]![1]).toBe('Night falls slowly');
  });

  it('an unchanged name is not a change; an unknown or parked scene is refused', () => {
    const h = harness();
    expect(h.run(rename('s2', 'Two'))).toBe(false);
    expect(h.run(rename('nope', 'X'))).toBe(false);
    expect(h.run(rename('k1', 'X'))).toBe(false); // cold storage only changes through its own commands
    expect(undoDepth(h.state)).toBe(0);
  });

  it('each rename is its own undo step, separate from typing just before it', () => {
    const h = harness();
    h.cursor(h.at('Gamma.', 6));
    h.state = h.state.apply(h.state.tr.insertText(' More'));
    h.run(rename('s3', 'Third'));
    h.run(undo);
    expect(names(h)).toEqual([[null, 'Two'], [null]]);
    expect(h.text()).toContain('Gamma. More');
    h.run(rename('s2', 'A'));
    h.run(rename('s2', 'B'));
    h.run(undo);
    expect(names(h)[0]![1]).toBe('A');
  });
});
