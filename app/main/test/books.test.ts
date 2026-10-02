import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyManuscript, serialize } from '@baretext/format';
import { bookChapters, listBooks } from '../books';

const dir = () => mkdtempSync(path.join(os.tmpdir(), 'bt-books-'));
const book = (root: string, name: string, title: string, chapters: string[]) => {
  const m = emptyManuscript(title);
  m.chapters = chapters.map((t, i) => ({ ...m.chapters[0]!, id: `c${i}`, title: t, scenes: m.chapters[0]!.scenes.map((s) => ({ ...s, id: `s${i}` })) }));
  const p = path.join(root, name);
  writeFileSync(p, serialize(m));
  return p;
};

describe('the writer’s manuscripts', () => {
  it('lists the open one first, then recent ones that still exist, each once, by title', async () => {
    const root = dir();
    const a = book(root, 'a.md', 'Alpha', ['One']);
    const b = book(root, 'b.md', 'Beta', ['One']);
    const plain = path.join(root, 'notes.md');
    writeFileSync(plain, '# Just a chapter\n\nText.\n');
    const books = await listBooks(b, [a, b, path.join(root, 'gone.md'), plain]);
    expect(books).toEqual([
      { path: b, title: 'Beta', current: true },
      { path: a, title: 'Alpha', current: false },
      { path: plain, title: 'notes', current: false }, // no title of its own: the file's name
    ]);
  });

  it('reads a book’s chapter titles without changing the file', async () => {
    const root = dir();
    const a = book(root, 'a.md', 'Alpha', ['Arrival', '', 'Departure']);
    expect(await bookChapters(a)).toEqual(['Arrival', '', 'Departure']);
    expect(await bookChapters(path.join(root, 'missing.md'))).toBeNull();
  });
});
