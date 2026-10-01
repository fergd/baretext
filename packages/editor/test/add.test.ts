import { describe, expect, it } from 'vitest';
import { undo, undoDepth } from 'prosemirror-history';
import { addChapter, addScene, schema } from '../src';
import { harness } from './helpers';

// sampleManuscript: c1 "One" → s1, s2 "Two"; c2 "Next" → s3; cold storage k1.
const shape = (h: ReturnType<typeof harness>) => h.model().chapters.map((c) => c.scenes.length);
const caretScene = (h: ReturnType<typeof harness>) => {
  const $h = h.state.selection.$head;
  for (let d = $h.depth; d > 0; d--) if ($h.node(d).type === schema.nodes.scene) return $h.node(d).attrs.id as string;
  return null;
};

describe('adding chapters and scenes (outline)', () => {
  it('adds an empty, unnamed scene at the end of a chapter, with the caret on its line', () => {
    const h = harness();
    h.cursor(h.at('Gamma.'));
    expect(h.run(addScene('c1'))).toBe(true);
    expect(shape(h)).toEqual([3, 1]);
    const added = h.model().chapters[0]!.scenes[2]!;
    expect(added.name).toBe(null);
    expect(added.blocks).toEqual([{ type: 'paragraph', content: [] }]);
    expect(new Set(h.model().chapters.flatMap((c) => c.scenes.map((s) => s.id))).size).toBe(4); // a fresh identity
    expect(caretScene(h)).toBe(added.id);
    expect(h.state.selection.$head.parent.type).toBe(schema.nodes.paragraph);
    expect(h.rejected).toBe(0);
  });

  it('adds an untitled chapter (one empty scene) at the end of the book, caret in it', () => {
    const h = harness();
    expect(h.run(addChapter())).toBe(true);
    const m = h.model();
    expect(m.chapters).toHaveLength(3);
    expect(m.chapters[2]!.title).toBe('');
    expect(m.chapters[2]!.scenes).toHaveLength(1);
    expect(caretScene(h)).toBe(m.chapters[2]!.scenes[0]!.id);
    expect(m.coldStorage.map((s) => s.id)).toEqual(['k1']); // cold storage stays last and untouched
  });

  it('can add a chapter after a given one', () => {
    const h = harness();
    h.run(addChapter('c1'));
    expect(h.model().chapters.map((c) => c.title)).toEqual(['One', '', 'Next']);
  });

  it('each add is one undo step that restores the caret', () => {
    const h = harness();
    h.cursor(h.at('Beta'));
    const before = h.state.doc;
    const sel = h.state.selection.head;
    h.run(addScene('c2'));
    h.run(addChapter());
    expect(undoDepth(h.state)).toBe(2);
    h.run(undo);
    expect(h.model().chapters).toHaveLength(2);
    h.run(undo);
    expect(h.state.doc.eq(before)).toBe(true);
    expect(h.state.selection.head).toBe(sel);
  });

  it('refuses unknown chapters', () => {
    const h = harness();
    expect(h.run(addScene('nope'))).toBe(false);
    expect(h.run(addScene('k1'))).toBe(false);
    expect(h.run(addChapter('nope'))).toBe(false);
  });
});
