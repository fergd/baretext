import { describe, expect, it } from 'vitest';
import { bookLabels } from '../sprint-keep';

const b = (path: string, title: string) => ({ path, title, current: false });

describe('naming the writer’s books in the picker', () => {
  it('uses titles alone when they differ', () => {
    expect(bookLabels([b('/W/a.md', 'Alpha'), b('/W/b.md', 'Beta')])).toEqual(['Alpha', 'Beta']);
  });

  it('tells repeated titles apart by file name', () => {
    expect(bookLabels([b('/W/Book.md', 'Book'), b('/W/Book draft 2.md', 'Book'), b('/W/c.md', 'Other')]))
      .toEqual(['Book — Book.md', 'Book — Book draft 2.md', 'Other']);
  });

  it('and by folder when the file names repeat too', () => {
    expect(bookLabels([b('/Writing/The Keeper.md', 'The Keeper'), b('/Writing/Drafts/The Keeper.md', 'The Keeper')]))
      .toEqual(['The Keeper — Writing/The Keeper.md', 'The Keeper — Drafts/The Keeper.md']);
  });
});
