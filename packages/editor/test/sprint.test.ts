import { describe, expect, it } from 'vitest';
import { undo } from 'prosemirror-history';
import type { Block } from '@baretext/format';
import { createSprintState, placeSprint, schema, sprintBlocks, sprintDoc, sprintSchema, sprintWords } from '../src';
import { harness } from './helpers';

const writing: Block[] = [
  { type: 'paragraph', content: [{ text: 'She ran ' }, { text: 'fast', italic: true }, { text: '.' }] },
  { type: 'section_break' },
  { type: 'paragraph', content: [{ text: 'Later.' }] },
];

describe('the sprint page', () => {
  it('starts blank: one empty paragraph, caret in it, nothing structural in its schema', () => {
    const state = createSprintState();
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.firstChild!.type.name).toBe('paragraph');
    expect(state.selection.empty).toBe(true);
    for (const name of ['book_title', 'chapter', 'scene', 'scene_heading', 'cold_storage']) expect(sprintSchema.nodes[name]).toBeUndefined();
    expect(sprintSchema.marks.note).toBeUndefined();
  });

  it('round-trips its writing as manuscript blocks, trimming blank lines at the ends', () => {
    expect(sprintBlocks(sprintDoc(writing))).toEqual(writing);
    const padded = sprintDoc([{ type: 'paragraph', content: [] }, ...writing, { type: 'paragraph', content: [{ text: '  ' }] }]);
    expect(sprintBlocks(padded)).toEqual(writing);
    expect(sprintBlocks(sprintDoc())).toEqual([]);
    expect(sprintWords(sprintDoc(writing))).toBe(4);
  });
});

describe('placing a sprint in the book', () => {
  const sceneTexts = (h: ReturnType<typeof harness>) => h.model().chapters.map((c) => c.scenes.map((s) => s.blocks.map((b) => (b.type === 'paragraph' ? b.content.map((r) => r.text).join('') : '·')).join('|')));

  it('adds one unnamed scene at the end of a chosen chapter, caret at its end, one undo step', () => {
    const h = harness();
    const before = h.model();
    expect(h.run(placeSprint(writing, { to: 'chapter', chapterId: 'c1' }))).toBe(true);
    const added = h.model().chapters[0]!.scenes[2]!;
    expect(added.name).toBeNull();
    expect(added.blocks).toEqual(writing);
    expect(sceneTexts(h)[1]).toEqual(sceneTexts(harness())[1]); // other chapters untouched
    expect(h.state.selection.$head.parent.textContent).toBe('Later.');
    expect(h.state.selection.$head.parentOffset).toBe('Later.'.length);
    h.run(undo);
    expect(h.model()).toEqual(before);
  });

  it('adds it at the end of the book (the last chapter)', () => {
    const h = harness();
    h.run(placeSprint(writing, { to: 'end' }));
    expect(h.model().chapters[1]!.scenes).toHaveLength(2);
    expect(h.model().chapters[1]!.scenes[1]!.blocks).toEqual(writing);
  });

  it('parks it in Cold Storage, leaving the story and the caret alone', () => {
    const h = harness();
    h.cursor(h.at('Gamma.'));
    const caret = h.state.selection.head;
    const chapters = h.model().chapters;
    h.run(placeSprint(writing, { to: 'cold' }));
    expect(h.model().chapters).toEqual(chapters);
    expect(h.model().coldStorage.map((s) => s.blocks)).toEqual([[{ type: 'paragraph', content: [{ text: 'Cut.' }] }], writing]);
    expect(h.state.selection.head).toBe(caret);
  });

  it('can name the new scene (a parked sprint is named for what it was)', () => {
    const h = harness();
    h.run(placeSprint(writing, { to: 'cold' }, 'Sprint · 15 min · Oct 2, 7:58 AM'));
    expect(h.model().coldStorage.at(-1)!.name).toBe('Sprint · 15 min · Oct 2, 7:58 AM');
    expect(h.model().coldStorage.at(-1)!.blocks).toEqual(writing);
  });

  it('does nothing with nothing to place, or a chapter that is gone', () => {
    const h = harness();
    const doc = h.state.doc;
    expect(h.run(placeSprint([], { to: 'end' }))).toBe(false);
    expect(h.run(placeSprint(writing, { to: 'chapter', chapterId: 'gone' }))).toBe(false);
    expect(h.state.doc.eq(doc)).toBe(true);
  });

  it('produces a valid manuscript every time', () => {
    for (const where of [{ to: 'chapter', chapterId: 'c2' }, { to: 'end' }, { to: 'cold' }] as const) {
      const h = harness();
      h.run(placeSprint(writing, where));
      h.state.doc.check();
      expect(h.state.doc.type).toBe(schema.nodes.doc);
    }
  });
});
