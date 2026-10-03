import { describe, expect, it } from 'vitest';
import { beatMenu, chosenBeat, CHOOSE_STRUCTURE } from '../beat-menu';

const scene = (id: string, label: string, beat: string | null = null) => ({ id, label, beat });
const outline = { chapters: [{ scenes: [scene('a', '1.1', 'midpoint'), scene('b', '1.2'), scene('c', '1.3', 'a-newer-beat')] }] } as never;
const ids = (items: ReturnType<typeof beatMenu>) => items.map((i) => ('id' in i ? i.id : '—'));

describe('the Story beat menu (DECISIONS §27)', () => {
  it('lists the structure’s beats in order, a check on the scene’s own, another scene’s by its number, then No beat', () => {
    const items = beatMenu(outline, 'three-act', 'b');
    expect(ids(items)).toEqual(['beat:inciting-incident', 'beat:first-plot-point', 'beat:midpoint', 'beat:second-plot-point', 'beat:climax', 'beat:resolution', '—', 'beat:']);
    expect(items[2]).toMatchObject({ label: 'Midpoint · 1.1', checked: false });
    expect(items.at(-1)).toMatchObject({ label: 'No beat', enabled: false });
    expect(beatMenu(outline, 'three-act', 'a')[2]).toMatchObject({ label: 'Midpoint', checked: true });
  });

  it('a beat the structure doesn’t have still shows, checked, by its id', () => {
    expect(beatMenu(outline, 'three-act', 'c').at(-3)).toMatchObject({ id: 'beat:a-newer-beat', label: 'A newer beat', checked: true });
  });

  it('without a structure: the way to choose one (and a marked scene can still be cleared)', () => {
    expect(ids(beatMenu(outline, null, 'b'))).toEqual([CHOOSE_STRUCTURE]);
    expect(ids(beatMenu(outline, null, 'a'))).toEqual(['beat:midpoint', '—', 'beat:', CHOOSE_STRUCTURE]);
  });

  it('reads a choice: a beat, a clear, or not a beat at all', () => {
    expect(chosenBeat('beat:midpoint')).toBe('midpoint');
    expect(chosenBeat('beat:')).toBeNull();
    expect(chosenBeat('copy')).toBeUndefined();
  });
});
