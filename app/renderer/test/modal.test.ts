// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { arrowStep, Modal } from '../modal';

const key = (k: string, shift = false) => new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true });

function modal() {
  const onDismiss = vi.fn();
  const m = new Modal(document.body, { className: 'x', label: 'Test', onDismiss });
  m.el.innerHTML = '<button>a</button><button disabled>b</button><input><button>c</button>';
  return { m, onDismiss, stops: [...m.el.querySelectorAll<HTMLElement>('button:not([disabled]), input')] };
}

describe('the shared panel frame', () => {
  it('is a labelled modal dialog over a scrim, open state in data-open', () => {
    const { m } = modal();
    expect(m.el.getAttribute('role')).toBe('dialog');
    expect(m.el.getAttribute('aria-modal')).toBe('true');
    expect(m.el.getAttribute('aria-label')).toBe('Test');
    expect(m.isOpen).toBe(false);
    m.show();
    expect([m.el.dataset.open, m.scrim.dataset.open]).toEqual(['true', 'true']);
    m.hide();
    expect(m.isOpen).toBe(false);
  });

  it('Esc dismisses and is claimed, before the panel’s own keys', () => {
    const { m, onDismiss } = modal();
    const own = vi.fn();
    m.el.addEventListener('keydown', own);
    const outside = vi.fn();
    document.body.addEventListener('keydown', outside);
    const esc = key('Escape');
    m.el.querySelector('button')!.dispatchEvent(esc);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(esc.defaultPrevented).toBe(true);
    expect(own).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled();
  });

  it('a press on the scrim dismisses', () => {
    const { m, onDismiss } = modal();
    m.scrim.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('Tab cycles through what can take focus (skipping disabled), and wraps both ways', () => {
    const { m, stops } = modal();
    stops[0]!.focus();
    for (const expected of [1, 2, 0]) {
      document.activeElement!.dispatchEvent(key('Tab'));
      expect(document.activeElement).toBe(stops[expected]);
    }
    document.activeElement!.dispatchEvent(key('Tab', true));
    expect(document.activeElement).toBe(stops[2]);
    expect(m.el.contains(document.activeElement)).toBe(true);
  });

  it('arrow keys step through radios, wrapping; other keys are left alone', () => {
    const radios = [1, 2, 3].map(() => document.createElement('button'));
    expect(arrowStep(key('ArrowRight'), radios, radios[2]!)).toBe(radios[0]);
    expect(arrowStep(key('ArrowUp'), radios, radios[0]!)).toBe(radios[2]);
    expect(arrowStep(key('a'), radios, radios[0]!)).toBeNull();
  });
});
