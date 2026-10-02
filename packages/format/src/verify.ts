import { canonicalize, type Manuscript } from './model';
import { parse } from './parse';
import { serialize } from './serialize';

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Serialize and prove the output parses back to the same manuscript.
 * Returns the text only if the round trip is exact; otherwise throws.
 */
export function verifyRoundTrip(m: Manuscript): string {
  const expected = canonicalize(m);
  const text = serialize(expected);
  const back = parse(text).manuscript;
  if (!deepEqual(back, expected)) {
    throw new Error('Round-trip verification failed: the saved file would not reproduce the manuscript.');
  }
  return text;
}
