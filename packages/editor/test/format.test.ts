import { describe, expect, it } from 'vitest';
import { undo } from 'prosemirror-history';
import { canonicalize, parse, serialize } from '@baretext/format';
import {
  docToModel,
  hasFormattableText,
  markState,
  normalizeHref,
  quoteState,
  removeLink,
  schema,
  selectedLink,
  setLink,
  toggleBold,
  toggleQuote,
} from '../src';
import { harness, sampleManuscript, scene } from './helpers';

const blocksOf = (h: ReturnType<typeof harness>, c: number, s: number) =>
  h.model().chapters[c]!.scenes[s]!.blocks.map((b) =>
    b.type === 'paragraph' ? b.content.map((r) => r.text).join('')
      : b.type === 'quote' ? `> ${b.paragraphs.map((p) => p.map((r) => r.text).join('')).join(' | ')}` : `[${b.type}]`);

const threeParagraphs = () => {
  const m = sampleManuscript();
  m.chapters[0]!.scenes[0] = scene('s1', ['One.', 'Two.', 'Three.']);
  return harness(m);
};

describe('toolbar state', () => {
  it('reports marks as on, off, or mixed', () => {
    const h = harness();
    const start = h.at('Alpha first.');
    h.select(start, start + 5);
    expect(markState(h.state, schema.marks.bold!)).toBe('off');
    h.run(toggleBold);
    expect(markState(h.state, schema.marks.bold!)).toBe('on');
    h.select(start, start + 12);
    expect(markState(h.state, schema.marks.bold!)).toBe('mixed');
  });

  it('only offers formatting for prose, never for titles or empty selections', () => {
    const h = harness();
    h.cursor(h.at('Alpha'));
    expect(hasFormattableText(h.state)).toBe(false);
    h.select(h.at('One'), h.at('One', 3)); // chapter title
    expect(hasFormattableText(h.state)).toBe(false);
    h.select(h.at('Alpha'), h.at('Alpha', 5));
    expect(hasFormattableText(h.state)).toBe(true);
  });
});

describe('links', () => {
  it('normalizes what people type and rejects unsafe or invalid input', () => {
    expect(normalizeHref('example.com/a?b')).toBe('https://example.com/a?b');
    expect(normalizeHref(' https://x.y ')).toBe('https://x.y');
    expect(normalizeHref('me@example.com')).toBe('mailto:me@example.com');
    for (const bad of ['', 'javascript:alert(1)', 'not a link', 'word', 'data:text/html,x']) expect(normalizeHref(bad)).toBeNull();
  });

  it('sets, reads, replaces, and removes a link on the selection', () => {
    const h = harness();
    h.select(h.at('Alpha'), h.at('Alpha', 5));
    expect(h.run(setLink('example.com'))).toBe(true);
    expect(selectedLink(h.state)).toBe('https://example.com');
    h.run(setLink('https://other.org'));
    expect(selectedLink(h.state)).toBe('https://other.org');
    expect(h.run(setLink('javascript:alert(1)'))).toBe(false);
    h.run(removeLink);
    expect(selectedLink(h.state)).toBeNull();
    expect(h.rejected).toBe(0);
  });
});

describe('quote', () => {
  it('wraps the selected paragraphs in one quote and unwraps them again', () => {
    const h = threeParagraphs();
    const sig = h.signature();
    h.select(h.at('One.'), h.at('Two.', 2));
    expect(h.run(toggleQuote)).toBe(true);
    expect(blocksOf(h, 0, 0)).toEqual(['> One. | Two.', 'Three.']);
    expect(quoteState(h.state)).toBe('on');
    h.run(toggleQuote);
    expect(blocksOf(h, 0, 0)).toEqual(['One.', 'Two.', 'Three.']);
    expect(h.signature()).toBe(sig);
    expect(h.rejected).toBe(0);
  });

  it('keeps a writable line after quoting the last paragraph of a scene', () => {
    const h = threeParagraphs();
    h.cursor(h.at('Three.'));
    h.run(toggleQuote);
    expect(blocksOf(h, 0, 0)).toEqual(['One.', 'Two.', '> Three.', '']);
  });

  it('unquoting the last paragraph again removes the line quoting added', () => {
    const h = threeParagraphs();
    const original = h.state.doc;
    h.cursor(h.at('Three.'));
    h.run(toggleQuote);
    h.cursor(h.at('Three.'));
    h.run(toggleQuote);
    expect(blocksOf(h, 0, 0)).toEqual(['One.', 'Two.', 'Three.']);
    expect(h.state.doc.eq(original)).toBe(true);
  });

  it('keeps that trailing line once something is written on it', () => {
    const h = threeParagraphs();
    h.cursor(h.at('Three.'));
    h.run(toggleQuote);
    h.state = h.state.apply(h.state.tr.insertText('Four.', h.state.doc.resolve(h.at('Three.')).after(3) + 1));
    h.cursor(h.at('Three.'));
    h.run(toggleQuote);
    expect(blocksOf(h, 0, 0)).toEqual(['One.', 'Two.', 'Three.', 'Four.']);
  });

  it('unquotes only the selected paragraphs of a longer quote', () => {
    const h = threeParagraphs();
    h.select(h.at('One.'), h.at('Three.', 2));
    h.run(toggleQuote);
    h.cursor(h.at('Two.'));
    expect(quoteState(h.state)).toBe('on');
    h.run(toggleQuote);
    expect(blocksOf(h, 0, 0)).toEqual(['> One.', 'Two.', '> Three.', '']);
  });

  it('treats a partly quoted selection as mixed and quotes all of it', () => {
    const h = threeParagraphs();
    h.cursor(h.at('One.'));
    h.run(toggleQuote);
    h.select(h.at('One.'), h.at('Two.', 2));
    expect(quoteState(h.state)).toBe('mixed');
    h.run(toggleQuote);
    expect(blocksOf(h, 0, 0)).toEqual(['> One. | Two.', 'Three.']);
  });

  it('never quotes across scenes or titles', () => {
    const h = harness();
    const before = h.state.doc;
    h.select(h.at('Alpha last.'), h.at('Beta', 2));
    expect(h.run(toggleQuote)).toBe(false);
    h.cursor(h.at('One'));
    expect(h.run(toggleQuote)).toBe(false);
    h.cursor(h.at('Book')); // book title: outside every scene
    expect(h.run(toggleQuote)).toBe(false);
    expect(h.state.doc.eq(before)).toBe(true);
  });

  it('is one undo step and survives a save round trip', () => {
    const h = threeParagraphs();
    const original = h.state.doc;
    h.select(h.at('One.'), h.at('Two.', 2));
    h.run(toggleQuote);
    const m = docToModel(h.state.doc);
    expect(parse(serialize(m)).manuscript).toEqual(canonicalize(m));
    h.run(undo);
    expect(h.state.doc.eq(original)).toBe(true);
  });
});
