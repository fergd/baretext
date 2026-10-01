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
