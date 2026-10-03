import { describe, expect, it } from 'vitest';
import { readTarget } from '../book-setup';

describe('a target length as typed', () => {
  it('reads whole numbers of words, with or without thousands separators', () => {
    expect(readTarget('90000')).toBe(90000);
    expect(readTarget(' 90,000 ')).toBe(90000);
    expect(readTarget('90 000')).toBe(90000);
    expect(readTarget('1,250,000')).toBe(1250000);
  });

  it('blank is no target', () => {
    expect(readTarget('')).toBeNull();
    expect(readTarget('   ')).toBeNull();
  });

  it('anything else is not a target (never guessed at)', () => {
    for (const t of ['90.5', '9,00', '90k', 'lots', '0', '-5', '1,0000', '99999999']) expect(readTarget(t), t).toBeNaN();
  });
});
