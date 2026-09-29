import { describe, expect, it } from 'vitest';
import { parse, sceneText, serialize } from '../src';

// Same shape as files written by the previous Baretext app.
const LEGACY = [
  '<!-- BOOK TITLE: The Book -->',
  '',
  '# ',
  '',
  '<!-- The Side Door -->',
  '',
  'First line of the first scene.',
  'Second line is its own paragraph with *italic* and **bold**.',
  '',
  '## January 18',
  'Dated entry.',
  '---',
  '<!-- Morning Coffee -->',
  'Coffee scene.',
  '<!-- SCENE GROUP: group-1 -->',
  '### A Subhead',
  'More.',
  '---',
  'Unnamed scene text.',
  '',
  '# Part Two?',
  '---',
  '<!-- Call -->',
  '<!-- SCENE GROUP: group-1 -->',
  'Call text.',
  '<!-- COLD STORAGE -->',
  '---',
  '<!-- Cut -->',
  '- a note line',
].join('\n');

describe('legacy Baretext files', () => {
  const r = parse(LEGACY, 'fallback');
  const m = r.manuscript;

  it('is recognized and reads the private title record', () => {
    expect(r.source).toBe('legacy-baretext');
    expect(r.native).toBe(false);
    expect(m.title).toBe('The Book');
  });

  it('turns each line into its own paragraph', () => {
    const s = m.chapters[0]!.scenes[0]!;
    expect(s.name).toBe('The Side Door');
    expect(s.blocks).toEqual([
      { type: 'paragraph', content: [{ text: 'First line of the first scene.' }] },
      { type: 'paragraph', content: [{ text: 'Second line is its own paragraph with ' }, { text: 'italic', italic: true }, { text: ' and ' }, { text: 'bold', bold: true }, { text: '.' }] },
    ]);
  });

  it('maps headings, breaks, and waypoint names to scenes', () => {
    expect(m.chapters.map((c) => [c.title, c.scenes.map((s) => s.name)])).toEqual([
      ['', ['The Side Door', 'January 18', 'Morning Coffee', 'A Subhead', null]],
      ['Part Two?', ['Call']],
    ]);
    expect(sceneText(m.chapters[0]!.scenes[4]!)).toBe('Unnamed scene text.');
  });

  it('keeps scene links and cold storage; drops no text', () => {
    expect(m.chapters[0]!.scenes[2]!.link).toBe('ggroup1');
    expect(m.chapters[1]!.scenes[0]!.link).toBe('ggroup1');
    expect(m.coldStorage.map((s) => [s.name, sceneText(s)])).toEqual([['Cut', '- a note line']]);
  });

  it('converts to a Baretext file that round-trips', () => {
    const text = serialize(m);
    const back = parse(text);
    expect(back.source).toBe('baretext');
    expect(back.manuscript).toEqual(m);
  });

  it('plain Markdown without legacy records is not mistaken for legacy', () => {
    expect(parse('# Title\n\nText\n\n---\n\nMore').source).toBe('markdown');
  });
});
