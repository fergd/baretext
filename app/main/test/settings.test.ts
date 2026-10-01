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
