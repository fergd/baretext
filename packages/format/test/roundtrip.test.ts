import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  deepEqual,
  emptyManuscript,
  MAX_TARGET,
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
    cold: fc.array(fc.tuple(scene, fc.option(fc.tuple(fc.constantFrom('ca', 'cb'), fc.nat(9)), { nil: null })), { maxLength: 3 }),
    author: fc.option(text, { nil: undefined }),
    structure: fc.option(fc.constantFrom('three-act', 'save-the-cat', 'some-future-structure'), { nil: undefined }),
    target: fc.option(fc.integer({ min: 1, max: MAX_TARGET }), { nil: undefined }),
  })
  .map(({ title, chapters, cold, author, structure, target }) => ({
    title,
    // The book's setup, when it has one (DECISIONS §26).
    ...(author !== undefined ? { author } : {}),
    ...(structure !== undefined ? { structure } : {}),
    ...(target !== undefined ? { target } : {}),
    chapters: chapters.map((c) => ({ id: id(), title: c.title, scenes: c.scenes.map((s) => ({ id: id(), ...s })) })),
    // Parked scenes may remember where they came from (Restore puts them back).
    coldStorage: cold.map(([s, from]) => ({ id: id(), ...s, ...(from ? { origin: { chapter: from[0], index: from[1] } } : {}) })),
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

describe('book setup (front matter)', () => {
  const book = (extra: Partial<Manuscript>): Manuscript => ({ ...emptyManuscript('The Keeper'), ...extra });

  it('writes the author, structure and target under the title, and reads them back', () => {
    const m = book({ author: 'Ann "A." Lee', structure: 'three-act', target: 90000 });
    const text = serialize(m);
    expect(text.split('\n').slice(0, 7)).toEqual(['---', 'title: "The Keeper"', 'author: "Ann \\"A.\\" Lee"', 'structure: three-act', 'target: 90000', 'baretext: 1', '---']);
    expect(parse(text).manuscript).toMatchObject({ author: 'Ann "A." Lee', structure: 'three-act', target: 90000 });
    expect(verifyRoundTrip(m)).toBe(text);
  });

  it('a book without a setup is written exactly as before (none of the keys)', () => {
    const text = serialize(book({}));
    expect(text.split('\n').slice(0, 4)).toEqual(['---', 'title: "The Keeper"', 'baretext: 1', '---']);
    const back = parse(text).manuscript;
    expect('author' in back || 'structure' in back || 'target' in back).toBe(false);
  });

  it('an author is trimmed; a blank one is no author', () => {
    expect('author' in canonicalize(book({ author: '' }))).toBe(false);
    expect('author' in canonicalize(book({ author: '  ' }))).toBe(false);
    expect(canonicalize(book({ author: ' Ann Lee ' })).author).toBe('Ann Lee');
  });

  it('keeps a structure it does not know (a newer app’s), so saving never drops it', () => {
    expect(parse(serialize(book({ structure: 'some-future-structure' }))).manuscript.structure).toBe('some-future-structure');
  });

  it('refuses a setup that could not be written back', () => {
    expect(validate(book({ author: 'a\nb' })).join()).toMatch(/author/);
    expect(validate(book({ structure: 'Three Acts' })).join()).toMatch(/structure/);
    for (const target of [0, -5, 1.5, MAX_TARGET + 1, Number.NaN]) expect(validate(book({ target })).join()).toMatch(/target/);
  });

  it('reads hand-edited values it can, and ignores the ones it cannot', () => {
    const edited = serialize(book({})).replace('baretext: 1', "author: 'Ann Lee'\nstructure: Not An Id\ntarget: lots\nbaretext: 1");
    const m = parse(edited).manuscript;
    expect(m.author).toBe('Ann Lee');
    expect(m.structure).toBeUndefined();
    expect(m.target).toBeUndefined();
    expect(parse(serialize(book({})).replace('baretext: 1', 'target: 85,000\nbaretext: 1')).manuscript.target).toBe(85000);
  });

  it('imported Markdown keeps an author from its own front matter', () => {
    expect(parse('---\ntitle: Notes\nauthor: Ann Lee\n---\n\nSome prose.\n').manuscript.author).toBe('Ann Lee');
  });
});
