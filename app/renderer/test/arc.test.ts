import { describe, expect, it } from 'vitest';
import { middle, tensionAt, weighBook } from '../arc';
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

  it('every structure’s arc is one smooth curve: quiet at both ends, peaking at its climax, within 0–1', () => {
    for (const s of STRUCTURES) {
      const climax = s.beats.reduce((a, b) => (b.t > a.t ? b : a));
      expect(tensionAt(s.beats, climax.at), s.id).toBeCloseTo(1);
      expect(tensionAt(s.beats, 0)).toBeLessThan(0.1);
      expect(tensionAt(s.beats, 1)).toBeLessThan(0.1);
      let last = tensionAt(s.beats, 0);
      for (let p = 0.005; p <= 1; p += 0.005) {
        const t = tensionAt(s.beats, p);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
        // Rising before the climax, falling after it: never a wobble.
        if (p <= climax.at) expect(t).toBeGreaterThanOrEqual(last - 1e-9);
        else if (p - 0.005 > climax.at) expect(t).toBeLessThanOrEqual(last + 1e-9); // (the step over the top goes both ways)
        last = t;
      }
    }
  });

  it('has no corners: its slope changes gradually, even at the top', () => {
    const three = STRUCTURES.find((s) => s.id === 'three-act')!.beats;
    const slope = (p: number) => (tensionAt(three, p + 1e-7) - tensionAt(three, p - 1e-7)) / 2e-7;
    expect(Math.abs(slope(0.9))).toBeLessThan(1e-3); // level at the climax
    // Approaching any point from either side, the slope agrees.
    for (let p = 0.01; p < 0.99; p += 0.01) expect(Math.abs(slope(p + 1e-5) - slope(p - 1e-5))).toBeLessThan(0.05);
  });
});
