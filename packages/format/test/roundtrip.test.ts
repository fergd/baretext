import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  deepEqual,
  emptyManuscript,
  parse,
  serialize,
  validate,
  verifyRoundTrip,
  type Block,
  type Manuscript,
  type Run,
  type Scene,
} from '../src';

// Text pieces chosen to look like markup, entities, and edge whitespace.
const PIECES = [
  'a', 'word', 'The', ' ', '  ', '\t', ' ', '.', ',', '!', '?', '"', "'", '—', '–', '…',
  '*', '**', '***', '_', '__', '[', ']', '(', ')', '[x](y)', '\\', '\\*', '`', '```', '<', '>', '<!--', '-->',
  '&', '&amp;', '&nbsp;', '&#32;', '&#x41;', '&bogus;', '#', '## ', '# ', '-', '---', '* * *', '+', '=', '===', '|',
  '1.', '2)', '~', '~~', 'é', '漢字', '😀', 'é', '\u0001', '​', ':', 'title:', 'baretext',
];

const text = fc.array(fc.constantFrom(...PIECES), { minLength: 1, maxLength: 8 }).map((p) => p.join(''));
const maybeText = fc.oneof(fc.constant(''), text);
const href = fc.constantFrom('https://example.com', 'https://a.b/c?d=e&f=g', 'a b', 'x)y', '(p)', 'back\\slash', '<tag>', 'mailto:x@y.z');

const run: fc.Arbitrary<Run> = fc
  .record({ text, bold: fc.boolean(), italic: fc.boolean(), link: fc.option(href, { nil: undefined }) })
  .map(({ text, bold, italic, link }) => {
    const r: Run = { text };
    if (bold) r.bold = true;
    if (italic) r.italic = true;
    if (link) r.link = link;
    return r;
  });

const runs = fc.array(run, { maxLength: 6 });

const block: fc.Arbitrary<Block> = fc.oneof(
  { weight: 6, arbitrary: runs.map((content): Block => ({ type: 'paragraph', content })) },
  { weight: 1, arbitrary: fc.constant<Block>({ type: 'section_break' }) },
  { weight: 1, arbitrary: fc.array(runs, { minLength: 1, maxLength: 3 }).map((paragraphs): Block => ({ type: 'quote', paragraphs })) },
);

let counter = 0;
const id = () => `id${(counter++).toString(36)}`;

const scene: fc.Arbitrary<Omit<Scene, 'id'>> = fc.record({
  name: fc.option(maybeText, { nil: null }),
  link: fc.option(fc.constantFrom('g1', 'g2'), { nil: null }),
  blocks: fc.array(block, { minLength: 1, maxLength: 5 }),
});

const manuscript: fc.Arbitrary<Manuscript> = fc
  .record({
    title: maybeText,
    chapters: fc.array(fc.record({ title: maybeText, scenes: fc.array(scene, { minLength: 1, maxLength: 4 }) }), { minLength: 1, maxLength: 4 }),
    cold: fc.array(scene, { maxLength: 3 }),
  })
  .map(({ title, chapters, cold }) => ({
    title,
    chapters: chapters.map((c) => ({ id: id(), title: c.title, scenes: c.scenes.map((s) => ({ id: id(), ...s })) })),
    coldStorage: cold.map((s) => ({ id: id(), ...s })),
  }));

describe('round trip (own files)', () => {
  it('parse(serialize(m)) equals m for random manuscripts', () => {
    fc.assert(
      fc.property(manuscript, (m) => {
        const expected = canonicalize(m);
        const result = parse(serialize(m));
        expect(result.native).toBe(true);
        expect(result.identitiesReset).toBe(false);
        expect(result.manuscript).toEqual(expected);
      }),
      { numRuns: Number(process.env.FC_RUNS ?? 3000) },
    );
  });

  it('serialization is stable across repeated saves', () => {
    fc.assert(
      fc.property(manuscript, (m) => {
        const once = serialize(m);
        expect(serialize(parse(once).manuscript)).toBe(once);
      }),
      { numRuns: 1000 },
    );
  });

  it('verifyRoundTrip returns the file text for valid manuscripts', () => {
    const m = emptyManuscript('My Book');
    expect(verifyRoundTrip(m)).toBe(serialize(m));
  });

  it('prose that looks like markup stays prose', () => {
    const lines = ['# Not a chapter', '## Not a scene', '---', '* * *', '> not a quote', '&nbsp;', '<!-- baretext:cold-storage -->',
      '<!-- baretext {"v":1} -->', '1. not a list', '- not a list', '**not bold**', '[not](a link)', '    indented', 'trailing  '];
    const m: Manuscript = {
      title: '---',
      chapters: [{ id: 'c1', title: '# hash', scenes: [{ id: 's1', name: 'name ##', link: null,
        blocks: lines.map((l): Block => ({ type: 'paragraph', content: [{ text: l }] })) }] }],
      coldStorage: [],
    };
    expect(parse(serialize(m)).manuscript).toEqual(canonicalize(m));
  });

  it('empty paragraphs survive as real paragraphs', () => {
    const m = emptyManuscript();
    m.chapters[0]!.scenes[0]!.blocks = [
      { type: 'paragraph', content: [] },
      { type: 'paragraph', content: [{ text: 'x' }] },
      { type: 'paragraph', content: [] },
      { type: 'paragraph', content: [] },
    ];
    expect(parse(serialize(m)).manuscript).toEqual(canonicalize(m));
  });

  it('writes a readable file', () => {
    const m: Manuscript = {
      title: 'The Book',
      chapters: [{ id: 'c1', title: 'Arrival', scenes: [
        { id: 's1', name: 'The Station', link: null, blocks: [
          { type: 'paragraph', content: [{ text: 'She was ' }, { text: 'late', italic: true }, { text: '.' }] },
          { type: 'section_break' },
          { type: 'paragraph', content: [{ text: 'Later.', bold: true }] },
        ] },
        { id: 's2', name: null, link: null, blocks: [{ type: 'paragraph', content: [{ text: 'Next scene.' }] }] },
      ] }],
      coldStorage: [],
    };
    expect(serialize(m)).toMatchInlineSnapshot(`
      "---
      title: "The Book"
      baretext: 1
      ---

      # Arrival

      ## The Station

      She was *late*.

      * * *

      **Later.**

      ---

      Next scene.

      <!-- baretext {"v":1,"chapters":["c1"],"scenes":["s1","s2"],"links":{}} -->
      "
    `);
  });
});

describe('validation', () => {
  it('refuses to serialize invalid manuscripts', () => {
    const noChapters: Manuscript = { title: '', chapters: [], coldStorage: [] };
    expect(() => serialize(noChapters)).toThrow(/no chapters/);
    const m = emptyManuscript();
    m.chapters[0]!.scenes[0]!.blocks = [{ type: 'paragraph', content: [{ text: 'a\nb' }] }];
    expect(validate(m).join()).toMatch(/line break/);
    const dup = emptyManuscript();
    dup.chapters.push({ ...dup.chapters[0]!, id: dup.chapters[0]!.id });
    expect(validate(dup).join()).toMatch(/duplicate/);
  });
});

describe('identities', () => {
  it('reset (never mismatched) when a hand edit changes the scene count', () => {
    const m = emptyManuscript('B');
    const text = serialize(m).replace('&nbsp;', '&nbsp;\n\n---\n\nAdded by hand.');
    const r = parse(text);
    expect(r.identitiesReset).toBe(true);
    expect(r.manuscript.chapters[0]!.scenes).toHaveLength(2);
    expect(r.manuscript.chapters[0]!.scenes[1]!.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'Added by hand.' }] });
  });
});

describe('deepEqual', () => {
  it('ignores undefined keys only', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});
