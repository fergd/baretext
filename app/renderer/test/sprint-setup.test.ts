import { describe, expect, it } from 'vitest';
import { DEFAULT_SPRINT } from '../../shared/bridge';

// sprint-setup.ts builds DOM only when constructed; its helpers are pure.
const { sprintSummary, sprintName } = await import('../sprint-setup');

const at = new Date(2026, 9, 2, 7, 0);
const clock = (h: number, m: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 9, 2, h, m));

describe('sprint setup', () => {
  it('says when a time sprint ends, counting breaks between rounds (not after the last)', () => {
    expect(sprintSummary({ ...DEFAULT_SPRINT, minutes: 25 }, at)).toBe(`Ends ${clock(7, 25)}`);
    expect(sprintSummary({ ...DEFAULT_SPRINT, minutes: 25, rounds: 4, breakMinutes: 5 }, at)).toBe(`4 × 25 min · ends ${clock(8, 55)}`);
    expect(sprintSummary({ ...DEFAULT_SPRINT, minutes: 25, rounds: 2, breakMinutes: 0 }, at)).toBe(`2 × 25 min · ends ${clock(7, 50)}`);
  });

  it('counts a words session in words', () => {
    expect(sprintSummary({ ...DEFAULT_SPRINT, kind: 'words', words: 500 }, at)).toBe('');
    expect(sprintSummary({ ...DEFAULT_SPRINT, kind: 'words', words: 1000, rounds: 3 }, at)).toBe(`3 × ${(1000).toLocaleString()} words`);
  });
});

describe('naming a sprint', () => {
  const when = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at);
  it('says what it was and when it started', () => {
    expect(sprintName({ ...DEFAULT_SPRINT, minutes: 15 }, at.getTime())).toBe(`Sprint · 15 min · ${when}`);
    expect(sprintName({ ...DEFAULT_SPRINT, kind: 'words', words: 1500 }, at.getTime())).toBe(`Sprint · ${(1500).toLocaleString()} words · ${when}`);
  });
});
