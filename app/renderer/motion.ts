// Motion shared by every part that moves things into place (DECISIONS §22):
// FLIP — remember where things were, change the layout at once, then let each
// glide from where it was to where it is now. Transforms only (nothing is laid
// out again during the motion). Timing comes from the design tokens; with
// reduced motion they are 0 and nothing animates.

import { cssNumber, cssValue } from './dom';

export interface Glide {
  ms: number;
  easing: string;
}

/** The standard glide (things settling into place), or the side columns' (`sidebar`), from the tokens. */
export function glideMotion(kind: 'glide' | 'sidebar' = 'glide'): Glide {
  return kind === 'sidebar'
    ? { ms: cssNumber('--dur-sidebar'), easing: cssValue('--ease-sidebar', 'ease-out') }
    : { ms: cssNumber('--dur-glide'), easing: cssValue('--ease-out', 'ease-out') };
}

/** Where each element is now (viewport), by key. */
export function measure<K>(entries: Iterable<readonly [K, HTMLElement]>): Map<K, DOMRect> {
  const at = new Map<K, DOMRect>();
  for (const [key, el] of entries) at.set(key, el.getBoundingClientRect());
  return at;
}

/**
 * FLIP: each element glides from where it was (`before`, by the same key) to
 * where it is now; one that didn't move (or wasn't there before) stays still.
 * An entry's third element, when given, is the one measured (a section glides
 * as one by its header's travel).
 */
export function glideFrom<K>(before: ReadonlyMap<K, DOMRect>, now: Iterable<readonly [K, HTMLElement, HTMLElement?]>, m: Glide = glideMotion()) {
  if (!m.ms) return;
  for (const [key, el, by = el] of now) {
    const was = before.get(key);
    if (!was) continue;
    const is = by.getBoundingClientRect();
    const [dx, dy] = [was.left - is.left, was.top - is.top];
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: m.ms, easing: m.easing });
  }
}

/** The one that moved flashes once, so the eye finds where it landed. */
export function flash(el: HTMLElement | null | undefined, m: Glide = glideMotion()) {
  if (el && m.ms) el.animate([{ backgroundColor: 'var(--color-popover-active)' }, {}], { duration: m.ms * 3, easing: 'ease-out' });
}
