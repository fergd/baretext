import { describe, expect, it } from 'vitest';
import { parse, serialize, validate, verifyRoundTrip, type Manuscript } from '../src';

// Cold Storage scenes remember where they came from (chapter + position), so
// Restore can put them back. The origin lives in the bookkeeping comment.
function book(): Manuscript {
  return {
    title: 'Book',
    chapters: [{ id: 'c1', title: 'One', scenes: [{ id: 's1', name: null, link: null, blocks: [{ type: 'paragraph', content: [{ text: 'Kept.' }] }] }] }],
    coldStorage: [
      { id: 'k1', name: 'Cut', link: null, origin: { chapter: 'c1', index: 1 }, blocks: [{ type: 'paragraph', content: [{ text: 'Parked.' }] }] },
      { id: 'k2', name: null, link: null, blocks: [{ type: 'paragraph', content: [{ text: 'No origin.' }] }] },
    ],
  };
}

describe('cold storage origins', () => {
  it('round-trip through the file', () => {
    const m = book();
    const back = parse(serialize(m)).manuscript;
    expect(back.coldStorage[0]!.origin).toEqual({ chapter: 'c1', index: 1 });
    expect(back.coldStorage[1]!.origin).toBeUndefined();
    expect(() => verifyRoundTrip(m)).not.toThrow();
  });

  it('a file without origins (older files) reads exactly as before', () => {
    const m = book();
    delete m.coldStorage[0]!.origin;
    const text = serialize(m);
    expect(text).not.toContain('origins');
    expect(parse(text).manuscript).toEqual(m);
  });

  it('a damaged origin is dropped, never trusted', () => {
    const text = serialize(book()).replace('"origins":{"k1":["c1",1]}', '"origins":{"k1":["NOT AN ID",-3],"s1":["c1",0]}');
    const back = parse(text).manuscript;
    expect(back.coldStorage[0]!.origin).toBeUndefined();
    expect(back.chapters[0]!.scenes[0]!.origin).toBeUndefined(); // only parked scenes have origins
  });

  it('validation rejects malformed origins and origins outside cold storage', () => {
    const bad = book();
    bad.coldStorage[0]!.origin = { chapter: 'NOT AN ID', index: -1 };
    expect(validate(bad).join(' ')).toMatch(/origin/);
    const misplaced = book();
    misplaced.chapters[0]!.scenes[0]!.origin = { chapter: 'c1', index: 0 };
    expect(validate(misplaced).join(' ')).toMatch(/origin/);
  });
});
