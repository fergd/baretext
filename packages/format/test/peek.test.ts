import { describe, expect, it } from 'vitest';
import { emptyManuscript, peekTitle, serialize } from '../src';

describe('peekTitle', () => {
  it('reads a Baretext file’s title from its front matter alone', () => {
    const m = { ...emptyManuscript('x'), title: 'The “Quiet” Book' };
    expect(peekTitle(serialize(m))).toBe('The “Quiet” Book');
    // Only the head is needed: a truncated file still yields its title.
    expect(peekTitle(serialize(m).slice(0, 60))).toBe('The “Quiet” Book');
  });

  it('is null without front matter or a title', () => {
    expect(peekTitle('# Chapter\n\nText.\n')).toBeNull();
    expect(peekTitle('---\nbaretext: 1\n---\n')).toBeNull();
    expect(peekTitle('')).toBeNull();
  });
});
