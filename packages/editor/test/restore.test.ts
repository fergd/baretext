import { describe, expect, it } from 'vitest';
import { undo, redo } from 'prosemirror-history';
import { canonicalize } from '@baretext/format';
import { docToModel, restoreManuscript } from '../src';
import { harness, sampleManuscript, scene } from './helpers';

describe('restore a version', () => {
  it('replaces the whole manuscript in one step, and undo brings the current one back exactly', () => {
    const h = harness();
    h.cursor(h.at('Alpha'));
    h.state = h.state.apply(h.state.tr.insertText('Typed now. '));
    const current = h.state.doc;

    const older = sampleManuscript();
    older.title = 'Older title';
    older.chapters[0]!.scenes[0] = scene('s1', ['An older opening.']);
    older.chapters.push({ id: 'c9', title: 'Gone later', scenes: [scene('s9', ['Cut chapter.'])] });

    h.state = h.state.apply(restoreManuscript(h.state, older));
    expect(docToModel(h.state.doc)).toEqual(canonicalize(older));
    expect(h.state.selection.$head.parent.textContent).toBe('An older opening.'); // caret on the first line of prose
    expect(h.rejected).toBe(0);

    h.run(undo);
    expect(h.state.doc.eq(current)).toBe(true); // one step, exact
    h.run(redo);
    expect(docToModel(h.state.doc)).toEqual(canonicalize(older));
  });

  it('is its own undo step even right after typing', () => {
    const h = harness();
    h.cursor(h.at('Alpha'));
    h.state = h.state.apply(h.state.tr.insertText('x'));
    const afterTyping = h.state.doc;
    h.state = h.state.apply(restoreManuscript(h.state, sampleManuscript()));
    h.run(undo);
    expect(h.state.doc.eq(afterTyping)).toBe(true); // the typing is still there
  });
});
