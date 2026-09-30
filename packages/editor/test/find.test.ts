import { describe, expect, it } from 'vitest';
import { undo } from 'prosemirror-history';
import { findMatches, replaceAll, replaceMatch, toggleBold } from '../src';
import { harness, sampleManuscript, scene } from './helpers';

const book = () => {
  const m = sampleManuscript();
  m.chapters[0]!.scenes[0] = scene('s1', ['The harbor was quiet. The HARBOR slept.', 'Don’t go to the harbour.', 'Harbormaster Wren.']);
  m.coldStorage = [scene('k1', ['harbor in cold storage'])];
  return harness(m);
};
const texts = (h: ReturnType<typeof harness>, ms: { from: number; to: number }[]) => ms.map((r) => h.state.doc.textBetween(r.from, r.to));

describe('find', () => {
  it('finds the prose the writer sees: case-insensitive by default, never cold storage', () => {
    const h = book();
    const ms = findMatches(h.state.doc, 'harbor');
    expect(texts(h, ms)).toEqual(['harbor', 'HARBOR', 'Harbor']);
    expect(ms.every((r, i) => i === 0 || r.from > ms[i - 1]!.from)).toBe(true); // document order
  });

  it('match case and whole word', () => {
    const h = book();
    expect(texts(h, findMatches(h.state.doc, 'harbor', { caseSensitive: true }))).toEqual(['harbor']);
    expect(texts(h, findMatches(h.state.doc, 'harbor', { wholeWord: true }))).toEqual(['harbor', 'HARBOR']);
  });

  it('treats straight and curly quotes alike', () => {
    const h = book();
    expect(texts(h, findMatches(h.state.doc, "don't"))).toEqual(['Don’t']);
  });

  it('finds titles and scene names too, and matches across formatting', () => {
    const h = book();
    expect(findMatches(h.state.doc, 'One')).toHaveLength(1); // chapter title
    expect(findMatches(h.state.doc, 'Two')).toHaveLength(1); // scene name
    const [q] = findMatches(h.state.doc, 'quiet');
    h.select(q!.from, q!.from + 3);
    h.run(toggleBold); // "qui" bold, "et" plain
    expect(texts(h, findMatches(h.state.doc, 'was quiet.'))).toEqual(['was quiet.']);
  });

  it('caps very common queries', () => {
    const h = book();
    const all = findMatches(h.state.doc, 'e');
    expect(findMatches(h.state.doc, 'e', { limit: 3 })).toHaveLength(3);
    expect(all.length).toBeGreaterThan(3);
    expect(findMatches(h.state.doc, '')).toEqual([]);
  });
});

describe('replace', () => {
  it('keeps the formatting of the text it replaces', () => {
    const h = book();
    const [q] = findMatches(h.state.doc, 'quiet');
    h.select(q!.from, q!.to);
    h.run(toggleBold);
    const [again] = findMatches(h.state.doc, 'quiet');
    h.state = h.state.apply(replaceMatch(h.state, again!, 'still')!);
    const runs = h.model().chapters[0]!.scenes[0]!.blocks[0]!;
    expect(runs.type === 'paragraph' && runs.content).toEqual([
      { text: 'The harbor was ' }, { text: 'still', bold: true }, { text: '. The HARBOR slept.' },
    ]);
  });

  it('replace all is one undo step and never touches structure or cold storage', () => {
    const h = book();
    const original = h.state.doc;
    const sig = h.signature();
    const tr = replaceAll(h.state, findMatches(h.state.doc, 'harbor', { wholeWord: true }), 'port');
    h.state = h.state.apply(tr!);
    expect(h.text()).toContain('The port was quiet. The port slept.');
    expect(h.text()).toContain('Harbormaster');
    expect(h.model().coldStorage[0]!.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'harbor in cold storage' }] });
    expect(h.signature()).toBe(sig);
    expect(h.rejected).toBe(0);
    h.run(undo);
    expect(h.state.doc.eq(original)).toBe(true);
  });

  it('can replace a match with nothing, and a scene name keeps working', () => {
    const h = book();
    h.state = h.state.apply(replaceAll(h.state, findMatches(h.state.doc, ' slept'), '')!);
    expect(h.text()).toContain('The HARBOR.');
    h.state = h.state.apply(replaceAll(h.state, findMatches(h.state.doc, 'Two'), 'Second')!);
    expect(h.model().chapters[0]!.scenes[1]!.name).toBe('Second');
  });
});
