import { describe, expect, it } from 'vitest';
import { createManuscriptState } from '@baretext/editor';
import type { Block } from '@baretext/format';
import { outlineOf } from '../outline';

const p = (text: string): Block => ({ type: 'paragraph', content: [{ text }] });
const book = (blocks: Block[], name: string | null = null) => createManuscriptState({
  title: 'B', coldStorage: [],
  chapters: [{ id: 'c1', title: 'One', scenes: [{ id: 's1', name, link: null, blocks }] }],
}).doc;
const opening = (blocks: Block[], name: string | null = null) => outlineOf(book(blocks, name)).chapters[0]!.scenes[0]!.opening;

describe('a scene’s opening (the corkboard card’s lines)', () => {
  it('is its first prose, paragraphs run together, whitespace collapsed', () => {
    expect(opening([p('The boat  left.'), p('The keeper\\u2019s cottage.')])).toBe('The boat left. The keeper\\u2019s cottage.');
  });

  it('skips the scene’s name and its pauses, and includes quotes', () => {
    expect(opening([p(''), { type: 'section_break' }, { type: 'quote', paragraphs: [[{ text: 'Said once.' }]] }, p('After.')], 'The log')).toBe('Said once. After.');
  });

  it('stops after a few lines’ worth, at a word', () => {
    const long = opening([p('word '.repeat(200))]);
    expect(long.length).toBeLessThanOrEqual(301);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toMatch(/\\s…$/);
  });

  it('is empty for a scene with no prose yet', () => {
    expect(opening([p('')])).toBe('');
  });
});
