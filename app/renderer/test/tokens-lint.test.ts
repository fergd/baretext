// Appearance comes from tokens (DECISIONS §3): outside tokens.css, styles
// use var(--…), never literal colors or pixel sizes. Allowed: 0–2px strokes,
// pure-black alpha masks, custom-property definitions, and the breakpoints of
// @container/@media queries (which cannot use variables).
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../styles');
const files = readdirSync(dir).filter((f) => f.endsWith('.css') && f !== 'tokens.css');

function violations(css: string): string[] {
  const out: string[] = [];
  css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).split('\n').forEach((line, i) => {
    const code = line.trim();
    if (!code || /^--[\w-]+\s*:/.test(code) || /^@(container|media)\b/.test(code)) return;
    const withoutMasks = code.replace(/rgba\(0, 0, 0, [^)]*\)|#000\b/g, '');
    for (const m of withoutMasks.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(/gi)) out.push(`${i + 1}: color ${m[0]} in "${code}"`);
    for (const m of code.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px\b/g)) if (Number(m[1]) > 2) out.push(`${i + 1}: ${m[0]} in "${code}"`);
  });
  return out;
}

describe('styles use tokens', () => {
  it.each(files)('%s has no literal colors or sizes', (file) => {
    expect(violations(readFileSync(path.join(dir, file), 'utf8'))).toEqual([]);
  });
});
