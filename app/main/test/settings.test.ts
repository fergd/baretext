import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, validateSettings } from '../settings';

describe('settings validation', () => {
  it('keeps a valid outline state and drops anything else', () => {
    expect(validateSettings({ outline: 'pinned' }).outline).toBe('pinned');
    expect(validateSettings({ outline: 'hidden' }).outline).toBe('hidden');
    expect(validateSettings({ outline: 'peek' }).outline).toBe(DEFAULT_SETTINGS.outline);
    expect(validateSettings({ outline: 1 }).outline).toBe('hidden');
    expect(validateSettings(null).outline).toBe('hidden');
  });
});

describe('prose font', () => {
  it('defaults to mono and keeps only mono, sans or serif', () => {
    expect(validateSettings({}).proseFont).toBe('mono');
    expect(validateSettings({ proseFont: 'serif' }).proseFont).toBe('serif');
    expect(validateSettings({ proseFont: 'sans' }).proseFont).toBe('sans');
    expect(validateSettings({ proseFont: 'comic' }).proseFont).toBe('mono');
  });
});

describe('theme', () => {
  it('defaults to Dracula and keeps only known themes (the old CRT theme is gone)', () => {
    expect(validateSettings({}).theme).toBe('dracula');
    for (const t of ['dark', 'light', 'grove', 'dracula', 'contrast']) expect(validateSettings({ theme: t }).theme).toBe(t);
    expect(validateSettings({ theme: 'amstrad' }).theme).toBe('dracula');
  });
});

describe('corkboard layout', () => {
  it('keeps rows or columns, and falls back to rows', () => {
    expect(validateSettings({ corkboardLayout: 'columns' }).corkboardLayout).toBe('columns');
    expect(validateSettings({ corkboardLayout: 'grid' }).corkboardLayout).toBe('rows');
    expect(validateSettings({}).corkboardLayout).toBe('rows');
  });
});

describe('sprint choices', () => {
  it('keeps valid choices and falls back field by field', () => {
    const ok = { kind: 'words', minutes: 40, words: 750, rounds: 3, breakMinutes: 10 };
    expect(validateSettings({ sprint: ok }).sprint).toEqual(ok);
    expect(validateSettings({}).sprint).toEqual(DEFAULT_SETTINGS.sprint);
    const bad = validateSettings({ sprint: { kind: 'laps', minutes: 0, words: 2.5, rounds: 99, breakMinutes: '5' } }).sprint;
    expect(bad).toEqual(DEFAULT_SETTINGS.sprint);
    // An older settings file's word goal (since cut) is simply left out.
    expect(validateSettings({ sprint: { ...ok, goal: 900 } }).sprint).toEqual(ok);
  });
});
