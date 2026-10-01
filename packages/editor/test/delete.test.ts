import { describe, expect, it } from 'vitest';
import { undo, undoDepth } from 'prosemirror-history';
import { deleteChapter, deleteScene, schema } from '../src';
import { harness } from './helpers';

// c1 "One" → s1 (Alpha first./Alpha last.), s2 "Two" (Beta only.); c2 "Next" → s3 (Gamma.); cold storage k1.
const ids = (h: ReturnType<typeof harness>) => h.model().chapters.map((c) => [c.id, ...c.scenes.map((s) => s.id)]);
const caretText = (h: ReturnType<typeof harness>) => h.state.selection.$head.parent.textContent;

describe('deleting scenes', () => {
  it('removes the scene and all its text, keeping everything else', () => {
    const h = harness();
    expect(h.run(deleteScene('s1'))).toBe(true);
    expect(ids(h)).toEqual([['c1', 's2'], ['c2', 's3']]);
    expect(h.text()).not.toContain('Alpha');
    expect(h.text()).toContain('Beta only.');
    expect(h.model().coldStorage.map((s) => s.id)).toEqual(['k1']);
    expect(h.rejected).toBe(0);
  });

  it("a chapter's only scene leaves an empty scene behind (a chapter always has one)", () => {
    const h = harness();
    h.run(deleteScene('s3'));
    const c2 = h.model().chapters[1]!;
    expect(c2.title).toBe('Next');
    expect(c2.scenes).toHaveLength(1);
    expect(c2.scenes[0]!.id).not.toBe('s3'); // a fresh, empty scene
    expect(c2.scenes[0]!.blocks).toEqual([{ type: 'paragraph', content: [] }]);
    expect(h.text()).not.toContain('Gamma');
  });

  it('the caret inside a deleted scene moves to the nearest line; elsewhere it stays put', () => {
    const h = harness();
    h.cursor(h.at('Alpha last.', 3));
    h.run(deleteScene('s1'));
    expect(['Beta only.', 'One']).toContain(caretText(h));
    expect(h.state.selection.$head.parent.type.isTextblock).toBe(true);
    h.cursor(h.at('Gamma.', 2));
    h.run(deleteScene('s2'));
    expect(caretText(h)).toBe('Gamma.');
    expect(h.state.selection.$head.parentOffset).toBe(2);
  });

  it('is one undo step that brings back the scene exactly', () => {
    const h = harness();
    const original = h.state.doc;
    h.run(deleteScene('s2'));
    expect(undoDepth(h.state)).toBe(1);
    h.run(undo);
    expect(h.state.doc.eq(original)).toBe(true);
  });

  it('refuses unknown scenes', () => {
    const h = harness();
    expect(h.run(deleteScene('nope'))).toBe(false);
  });
});

describe('deleting chapters', () => {
  it('removes the chapter with all its scenes', () => {
    const h = harness();
    expect(h.run(deleteChapter('c1'))).toBe(true);
    expect(ids(h)).toEqual([['c2', 's3']]);
    expect(h.text()).not.toMatch(/Alpha|Beta|One/);
    expect(h.state.doc.lastChild!.type).toBe(schema.nodes.cold_storage);
  });

  it("the book's only chapter leaves an empty chapter behind (a book always has one)", () => {
    const h = harness();
    h.run(deleteChapter('c2'));
    h.run(deleteChapter('c1'));
    const m = h.model();
    expect(m.chapters).toHaveLength(1);
    expect(m.chapters[0]!.title).toBe('');
    expect(m.chapters[0]!.scenes[0]!.blocks).toEqual([{ type: 'paragraph', content: [] }]);
    expect(m.title).toBe('Book');
    expect(m.coldStorage.map((s) => s.id)).toEqual(['k1']);
  });

  it('one undo step; refuses unknown chapters', () => {
    const h = harness();
    const original = h.state.doc;
    h.cursor(h.at('Beta'));
    h.run(deleteChapter('c1'));
    expect(caretText(h)).toMatch(/Next|Gamma\.|Book/);
    h.run(undo);
    expect(h.state.doc.eq(original)).toBe(true);
    expect(h.run(deleteChapter('nope'))).toBe(false);
  });
});
