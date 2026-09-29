import { describe, expect, it } from 'vitest';
import { undo } from 'prosemirror-history';
import { insertSectionBreak, schema, toggleQuote } from '../src';
import { harness, sampleManuscript, scene } from './helpers';

const blocks = (h: ReturnType<typeof harness>, c = 0, s = 0) =>
  h.model().chapters[c]!.scenes[s]!.blocks.map((b) =>
    b.type === 'paragraph' ? b.content.map((r) => r.text).join('') : b.type === 'section_break' ? '* * *' : `[${b.type}]`);

const threeParagraphs = () => {
  const m = sampleManuscript();
  m.chapters[0]!.scenes[0] = scene('s1', ['One.', 'Two words.', 'Three.']);
  return harness(m);
};
const caretParent = (h: ReturnType<typeof harness>) => h.state.selection.$head.parent.textContent;

describe('insert pause (section break)', () => {
  it('mid-paragraph: splits it, caret at the start of the second half', () => {
    const h = threeParagraphs();
    const sig = h.signature();
    h.cursor(h.at('words.'));
    expect(h.run(insertSectionBreak)).toBe(true);
    expect(blocks(h)).toEqual(['One.', 'Two ', '* * *', 'words.', 'Three.']);
    expect(caretParent(h)).toBe('words.');
    expect(h.state.selection.$head.parentOffset).toBe(0);
    expect(h.signature()).toBe(sig); // same chapters and scenes
    expect(h.rejected).toBe(0);
  });

  it('at the end of a paragraph: caret moves to the next line, no empty line added', () => {
    const h = threeParagraphs();
    h.cursor(h.at('One.', 4));
    h.run(insertSectionBreak);
    expect(blocks(h)).toEqual(['One.', '* * *', 'Two words.', 'Three.']);
    expect(caretParent(h)).toBe('Two words.');
  });

  it('at the end of the scene: adds a line to keep writing on', () => {
    const h = threeParagraphs();
    h.cursor(h.at('Three.', 6));
    h.run(insertSectionBreak);
    expect(blocks(h)).toEqual(['One.', 'Two words.', 'Three.', '* * *', '']);
    expect(caretParent(h)).toBe('');
  });

  it('on an empty line or at the start of a line: goes before it, caret stays', () => {
    const h = threeParagraphs();
    h.cursor(h.at('Three.'));
    h.run(insertSectionBreak);
    expect(blocks(h)).toEqual(['One.', 'Two words.', '* * *', 'Three.']);
    expect(caretParent(h)).toBe('Three.');
  });

  it('never doubles a pause, or starts a scene with one', () => {
    const h = threeParagraphs();
    h.cursor(h.at('Three.'));
    h.run(insertSectionBreak);
    const once = h.state.doc;
    h.run(insertSectionBreak); // already a pause right before
    expect(h.state.doc.eq(once)).toBe(true);
    h.cursor(h.at('Two words.', 10));
    h.run(insertSectionBreak); // already a pause right after
    expect(h.state.doc.eq(once)).toBe(true);
    h.cursor(h.at('One.'));
    h.run(insertSectionBreak); // first line of the scene
    expect(h.state.doc.eq(once)).toBe(true);
  });

  it('does nothing in titles, quotes, or with a selection', () => {
    const h = threeParagraphs();
    const before = h.state.doc;
    h.cursor(h.at('One', 1)); // chapter title "One"
    h.run(insertSectionBreak);
    h.select(h.at('Two'), h.at('Two', 3));
    h.run(insertSectionBreak);
    expect(h.state.doc.eq(before)).toBe(true);
    h.cursor(h.at('Two words.'));
    h.run(toggleQuote);
    const quoted = h.state.doc;
    h.cursor(h.at('words.'));
    h.run(insertSectionBreak);
    expect(h.state.doc.eq(quoted)).toBe(true);
  });

  it('is one undo step', () => {
    const h = threeParagraphs();
    const original = h.state.doc;
    h.cursor(h.at('words.'));
    h.run(insertSectionBreak);
    expect(h.state.doc.childCount).toBe(original.childCount);
    h.run(undo);
    expect(h.state.doc.eq(original)).toBe(true);
    expect(schema.nodes.section_break).toBeDefined();
  });
});
