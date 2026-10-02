// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARM_MS, Arming } from '../arming';

afterEach(() => vi.useRealTimers());

describe('two-step confirmation', () => {
  it('the first press arms, a second on the same thing acts', () => {
    const changes: (string | null)[] = [];
    const a = new Arming<string>((k) => changes.push(k));
    expect(a.press('x', () => true)).toBe(false);
    expect(a.key).toBe('x');
    expect(a.press('x', () => true)).toBe(true);
    expect(a.key).toBeNull();
    expect(changes).toEqual(['x', null]);
  });

  it('pressing another thing arms that one instead', () => {
    const a = new Arming<string>(() => {});
    a.press('x', () => true);
    expect(a.press('y', () => true)).toBe(false);
    expect(a.key).toBe('y');
  });

  it('disarms by itself after a few seconds', () => {
    vi.useFakeTimers();
    const a = new Arming<string>(() => {});
    a.press('x', () => true);
    vi.advanceTimersByTime(ARM_MS - 1);
    expect(a.key).toBe('x');
    vi.advanceTimersByTime(1);
    expect(a.key).toBeNull();
  });

  it('a press elsewhere disarms; a press on its own control does not; Esc disarms and is claimed', () => {
    const own = document.createElement('button');
    const other = document.createElement('div');
    document.body.append(own, other);
    const a = new Arming<string>(() => {});
    a.press('x', (t) => t === own);
    own.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(a.key).toBe('x');
    other.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(a.key).toBeNull();

    a.press('x', (t) => t === own);
    const later = vi.fn();
    window.addEventListener('keydown', later);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    other.dispatchEvent(esc);
    expect(a.key).toBeNull();
    expect(esc.defaultPrevented).toBe(true);
    expect(later).not.toHaveBeenCalled();
    window.removeEventListener('keydown', later);
  });
});
