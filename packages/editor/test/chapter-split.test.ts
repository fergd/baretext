import { describe, expect, it } from 'vitest';
import { redo, undo } from 'prosemirror-history';
import { openParked, parkedKey, schema, splitChapter } from '../src';
import { harness } from './helpers';

// Book: c1 "One" [s1: Alpha first. / Alpha last.] [s2 "Two": Beta only.]; c2 "Next" [s3: Gamma.]
type H = ReturnType<typeof harness>;
const shape = (h: H) => h.model().chapters.map((c) => ({
  title: c.title,
  scenes: c.scenes.map((s) => (s.name ? `${s.name}: ` : '') + s.blocks.map((b) => (b.type === 'paragraph' ? b.content.map((r) => r.text).join('') : `[${b.type}]`)).join(' / ')),
}));
const inNewChapterTitle = (h: H) => {
  const $c = h.state.selection.$from;
  return $c.parent.type === schema.nodes.chapter_title && $c.parent.content.size === 0;
};

describe('split chapter (⌥⌘↵)', () => {
  it('mid-line: the rest of the scene and the chapter’s later scenes become a new chapter; the caret is in its name; one undo step', () => {
    const h = harness();
    const before = h.state.doc;
    const text = h.text().replace(/\s+/g, '');
    h.cursor(h.at('first.'));
    h.run(splitChapter);
    expect(shape(h)).toEqual([
      { title: 'One', scenes: ['Alpha '] },
      { title: '', scenes: ['first. / Alpha last.', 'Two: Beta only.'] },
      { title: 'Next', scenes: ['Gamma.'] },
    ]);
    const m = h.model();
    expect(new Set(m.chapters.map((c) => c.id)).size).toBe(3); // a fresh identity
    expect(m.chapters[1]!.scenes[1]!.id).toBe('s2'); // moved scenes keep theirs
    expect(h.text().replace(/\s+/g, '')).toBe(text); // nothing lost, nothing reordered
    expect(inNewChapterTitle(h)).toBe(true);
    expect(h.rejected).toBe(0);
    h.run(undo);
    expect(h.state.doc.eq(before)).toBe(true);
    h.run(redo);
    expect(shape(h)).toHaveLength(3);
  });

  it('at the start of a line mid-scene: splits between lines, no empty line left behind', () => {
    const h = harness();
    h.cursor(h.at('Alpha last.'));
    h.run(splitChapter);
    expect(shape(h).slice(0, 2)).toEqual([
      { title: 'One', scenes: ['Alpha first.'] },
      { title: '', scenes: ['Alpha last.', 'Two: Beta only.'] },
    ]);
  });

  it('at the start of a later scene: the chapter splits before it, the scene moves whole (name and identity)', () => {
    const h = harness();
    h.cursor(h.at('Beta only.'));
    h.run(splitChapter);
    expect(shape(h).slice(0, 2)).toEqual([
      { title: 'One', scenes: ['Alpha first. / Alpha last.'] },
      { title: '', scenes: ['Two: Beta only.'] },
    ]);
    expect(h.model().chapters[1]!.scenes[0]!.id).toBe('s2');
    expect(inNewChapterTitle(h)).toBe(true);
  });

  it('at the end of a scene with scenes after it: splits between scenes, no empty scene', () => {
    const h = harness();
    h.cursor(h.at('Alpha last.', 'Alpha last.'.length));
    h.run(splitChapter);
    expect(shape(h).slice(0, 2)).toEqual([
      { title: 'One', scenes: ['Alpha first. / Alpha last.'] },
      { title: '', scenes: ['Two: Beta only.'] },
    ]);
  });

  it('at the end of the chapter: a new chapter with one empty scene, before the next chapter', () => {
    const h = harness();
    h.cursor(h.at('Beta only.', 'Beta only.'.length));
    h.run(splitChapter);
    expect(shape(h)).toEqual([
      { title: 'One', scenes: ['Alpha first. / Alpha last.', 'Two: Beta only.'] },
      { title: '', scenes: [''] },
      { title: 'Next', scenes: ['Gamma.'] },
    ]);
    expect(inNewChapterTitle(h)).toBe(true);
  });

  it('does nothing at the very start of a chapter, in a title, or in Cold Storage', () => {
    for (const [needle, offset] of [['Alpha first.', 0], ['One', 1], ['Two', 1]] as const) {
      const h = harness();
      const before = h.state.doc;
      h.cursor(h.at(needle, offset));
      h.run(splitChapter);
      expect(h.state.doc.eq(before), needle).toBe(true);
    }
    // A parked scene open on the page.
    const h = harness();
    h.run(openParked('k1'));
    expect(parkedKey.getState(h.state)).toBe('k1');
    h.cursor(h.at('Cut.', 2));
    expect(h.state.selection.$from.parent.textContent).toBe('Cut.');
    const before = h.state.doc;
    h.run(splitChapter);
    expect(h.state.doc.eq(before)).toBe(true);
  });
});
