// Small shared helpers for the renderer.

/** A numeric design token: a duration in ms (0 under reduced motion), or a length in px. */
export function cssNumber(token: string): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)) || 0;
}

/** A design token's text value (e.g. an easing curve), or `fallback` if unset. */
export function cssValue(token: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;
}

/** Counts in the writer's locale ("1,250"). */
export const numberFormat = new Intl.NumberFormat();
