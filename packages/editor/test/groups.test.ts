import { describe, expect, it } from 'vitest';
import { undo, undoDepth } from 'prosemirror-history';
import type { Manuscript } from '@baretext/format';
import { joinGroup, moveGroup, moveScene, moveToColdStorage, placeScene, renameGroup, splitScene, ungroup } from '../src';
import { harness } from './helpers';

// c1: a b c d   c2: e f   (each scene one paragraph: its own id, as text)
const scene = (id: string, link: string | null = null) => ({ id, name: null, link, blocks: [{ type: 'paragraph' as const, content: [{ text: `${id}.` }] }] });
const book = (links: Record<string, string> = {}, groups?: Record<string, string>): Manuscript => ({
  title: 'B',
  ...(groups ? { groups } : {}),
  chapters: [
    { id: 'c1', title: 'One', scenes: ['a', 'b', 'c', 'd'].map((id) => scene(id, links[id] ?? null)) },
    { id: 'c2', title: 'Two', scenes: ['e', 'f'].map((id) => scene(id, links[id] ?? null)) },
  ],
  coldStorage: [],
});
/** The book as rows of scenes, a group's members in brackets: "a [b c] d | e f". */
const layout = (h: ReturnType<typeof harness>) => h.model().chapters.map((c) => {
  const parts: string[] = [];
  c.scenes.forEach((s, i) => {
    const prev = c.scenes[i - 1]?.link;
    const next = c.scenes[i + 1]?.link;
    parts.push(`${s.link && s.link !== prev ? '[' : ''}${s.id}${s.link && s.link !== next ? ']' : ''}`);
  });
  return parts.join(' ');
}).join(' | ');

describe('scene groups (DECISIONS §28)', () => {
  it('joining: a card dropped on another makes a group of the two, the dropped one placed after; one undo', () => {
    const h = harness(book());
    const depth = undoDepth(h.state);
    expect(h.run(joinGroup('d', 'a'))).toBe(true);
    expect(layout(h)).toBe('[a d] b c | e f');
    expect(undoDepth(h.state)).toBe(depth + 1);
    expect(h.run(joinGroup('e', 'd'))).toBe(true); // (onto a member: it joins that group, after it)
    expect(layout(h)).toBe('[a d e] b c | f');
    h.run(undo);
    expect(layout(h)).toBe('[a d] b c | e f');
    expect(h.rejected).toBe(0);
  });

  it('placing: into a group at a place, or out of it (a group left with one scene is no group)', () => {
    const h = harness(book({ b: 'g', c: 'g' }));
    expect(h.run(placeScene('e', 'c1', 3, 'g'))).toBe(true);
    expect(layout(h)).toBe('a [b c e] d | f');
    expect(h.run(placeScene('b', 'c2', 1, null))).toBe(true);
    expect(layout(h)).toBe('a [c e] d | f b');
    expect(h.run(placeScene('c', 'c1', 3, null))).toBe(true);
    expect(layout(h)).toBe('a e d c | f b');
  });

  it('the rule holds whatever moves: a scene moved into a group’s middle joins it; one moved away from it leaves', () => {
    const h = harness(book({ a: 'g', b: 'g', c: 'g' }));
    h.run(moveScene('e', 'c1', 1));
    expect(layout(h)).toBe('[a e b c] d | f');
    h.run(moveScene('a', 'c2', 0));
    expect(layout(h)).toBe('[e b c] d | a f');
    h.run(undo);
    expect(layout(h)).toBe('[a e b c] d | f');
  });

  it('a scene split inside a group stays in it (both halves); a parked member leaves it', () => {
    const h = harness(book({ a: 'g', b: 'g' }));
    h.cursor(h.at('a.', 1));
    expect(h.run(splitScene)).toBe(true);
    expect(h.model().chapters[0]!.scenes.slice(0, 3).every((s) => s.link === 'g')).toBe(true);
    h.run(moveToColdStorage('b'));
    expect(h.model().coldStorage[0]!.link).toBeNull();
    expect(h.model().chapters[0]!.scenes.slice(0, 2).every((s) => s.link === 'g')).toBe(true);
  });

  it('moving a group moves its scenes as one, in order — within a chapter or to another', () => {
    const h = harness(book({ b: 'g', c: 'g' }));
    expect(h.run(moveGroup('g', 'c2', 1))).toBe(true);
    expect(layout(h)).toBe('a d | e [b c] f');
    expect(h.run(moveGroup('g', 'c2', 0))).toBe(true);
    expect(layout(h)).toBe('a d | [b c] e f');
    expect(h.run(moveGroup('g', 'c2', 0))).toBe(false); // (already there)
    h.run(undo);
    expect(layout(h)).toBe('a d | e [b c] f');
  });

  it('a chapter keeps a scene: its only scenes, as a group, can’t all leave it', () => {
    const h = harness(book({ e: 'g', f: 'g' }));
    expect(h.run(moveGroup('g', 'c1', 0))).toBe(false);
  });

  it('naming and ungrouping, each one undoable step', () => {
    const h = harness(book({ b: 'g', c: 'g' }));
    expect(h.run(renameGroup('g', '  Letters '))).toBe(true);
    expect(h.model().groups).toEqual({ g: 'Letters' });
    expect(h.run(renameGroup('g', 'Letters'))).toBe(false);
    expect(h.run(ungroup('g'))).toBe(true);
    expect(layout(h)).toBe('a b c d | e f');
    h.run(undo);
    expect(layout(h)).toBe('a [b c] d | e f');
  });

  it('a book read with a link the rule doesn’t allow is put right as it opens (its text untouched)', () => {
    // (the first version linked scenes far apart; here, g's members are in two chapters)
    const h = harness(book({ a: 'g', b: 'g', f: 'g' }));
    expect(layout(h)).toBe('[a b] c d | e f');
    expect(h.text()).toContain('f.');
  });
});
