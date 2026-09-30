import { describe, expect, it } from 'vitest';
import { prepare, search } from '../fuzzy';

const ITEMS = [
  { label: 'New manuscript', keywords: 'file create' },
  { label: 'Open…', keywords: 'file' },
  { label: 'Go to chapter or scene…', keywords: 'jump navigate find' },
  { label: 'Insert scene break', keywords: 'split new scene' },
  { label: 'Insert pause', keywords: 'section break within scene * * *' },
  { label: 'Typewriter mode', keywords: 'center line' },
  { label: 'Focus mode', keywords: 'hide chrome distraction' },
  { label: 'Paragraph spacing: Full line' },
];
const P = prepare(ITEMS);
const labels = (q: string) => search(q, P).map((i) => ITEMS[i]!.label);

describe('palette search', () => {
  it('empty query lists everything in order', () => {
    expect(labels('')).toEqual(ITEMS.map((i) => i.label));
    expect(labels('   ')).toHaveLength(ITEMS.length);
  });

  it('prefers a label prefix, then a word start, then anywhere', () => {
    expect(labels('type')[0]).toBe('Typewriter mode');
    expect(labels('mode')).toEqual(['Typewriter mode', 'Focus mode']);
    expect(labels('pause')[0]).toBe('Insert pause');
  });

  it('matches initials and letters in order', () => {
    expect(labels('tw')[0]).toBe('Typewriter mode');
    expect(labels('gts')[0]).toBe('Go to chapter or scene…');
  });

  it('matches keywords below labels, and needs every word', () => {
    expect(labels('section')).toEqual(['Insert pause']);
    expect(labels('jump')).toEqual(['Go to chapter or scene…']);
    expect(labels('scene break')[0]).toBe('Insert scene break');
    expect(labels('focus typewriter')).toEqual([]);
    expect(labels('zzq')).toEqual([]);
  });

  it('matches scene numbers', () => {
    const scenes = prepare([{ label: '4.2 The Harbor' }, { label: '14.2 Low Tide' }, { label: '4.12 Night' }]);
    expect(search('4.2', scenes)).toEqual([0, 1]);
    expect(search('4.1', scenes)[0]).toBe(2);
  });

  it('is fast on a whole book of scenes', () => {
    const many = prepare(Array.from({ length: 2000 }, (_, i) => ({ label: `${Math.floor(i / 7) + 1}.${(i % 7) + 1} Scene name number ${i}` })));
    const t = performance.now();
    for (const q of ['s', 'sc', 'scene n', '12.3', 'nm 19']) search(q, many);
    expect((performance.now() - t) / 5).toBeLessThan(5);
  });
});
