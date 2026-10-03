import { describe, expect, it } from 'vitest';
import { middle, monotone, tensionAt, weighBook } from '../arc';
import { STRUCTURES } from '../structures';

const scene = (id: string, words: number) => ({ id, words });
const book = (...chapters: { id: string; words: number }[][]) => ({ chapters: chapters.map((scenes) => ({ scenes })) }) as never;

describe('the story arc (DECISIONS §27)', () => {
  it('weighs the book by words: where each scene starts and ends, and each chapter starts', () => {
    const w = weighBook(book([scene('a', 100), scene('b', 300)], [scene('c', 600)]));
    expect(w.scenes.get('a')).toEqual([0, 0.1]);
    expect(w.scenes.get('b')).toEqual([0.1, 0.4]);
    expect(w.scenes.get('c')).toEqual([0.4, 1]);
    expect(middle(w.scenes.get('b')!)).toBeCloseTo(0.25);
    expect(w.chapters).toEqual([0, 0.4]);
  });

  it('an empty book is weighed a scene apiece (it still spreads out)', () => {
    const w = weighBook(book([scene('a', 0), scene('b', 0)], [scene('c', 0)]));
    expect(w.scenes.get('c')).toEqual([2 / 3, 1]);
    expect(w.chapters).toEqual([0, 2 / 3]);
  });

  it('every structure’s curve passes through its beats, stays within 0–1, and opens and closes quietly', () => {
    for (const s of STRUCTURES) {
      for (const b of s.beats) expect(tensionAt(s.beats, b.at), `${s.id} ${b.id}`).toBeCloseTo(b.t);
      for (let p = 0; p <= 1; p += 0.01) {
        const t = tensionAt(s.beats, p);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
      const climax = Math.max(...s.beats.map((b) => b.t));
      expect(tensionAt(s.beats, 0)).toBeLessThan(climax);
      expect(tensionAt(s.beats, 1)).toBeLessThan(climax);
    }
  });

  it('never overshoots between two beats: it peaks at the climax itself', () => {
    const three = STRUCTURES.find((s) => s.id === 'three-act')!.beats;
    for (let p = 0; p <= 1; p += 0.005) expect(tensionAt(three, p)).toBeLessThanOrEqual(1 + 1e-9);
    expect(tensionAt(three, 0.85)).toBeLessThan(1);
    expect(tensionAt(three, 0.95)).toBeLessThan(1);
  });

  it('monotone: through its points, never past them, holding its ends', () => {
    const f = monotone([[0, 0], [1, 1], [2, 0]]);
    expect(f(1)).toBe(1);
    for (let x = 0; x <= 2; x += 0.05) expect(f(x)).toBeLessThanOrEqual(1);
    expect(f(-1)).toBe(0);
    expect(f(3)).toBe(0);
  });
});
