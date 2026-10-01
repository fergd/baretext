// Every theme's text stays readable (spec §11): WCAG AA against the real
// theme values in tokens.css. Translucent colors are composited over the
// surface they sit on.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES } from '../../shared/bridge';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, '../styles/tokens.css'), 'utf8');

type RGBA = [number, number, number, number];

function themeTokens(theme: string): Record<string, string> {
  const block = new RegExp(`\\[data-theme='${theme}'\\][^{]*\\{([^}]*)\\}`).exec(css);
  if (!block) throw new Error(`no token block for theme ${theme}`);
  const tokens: Record<string, string> = {};
  for (const m of block[1]!.matchAll(/--(color-[a-z0-9-]+):\s*([^;]+);/g)) tokens[m[1]!] = m[2]!.trim();
  return tokens;
}

function parse(value: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1]!.split(',').map((s) => s.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  throw new Error(`unsupported color ${value}`);
}

const over = (top: RGBA, under: RGBA): RGBA => {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
};

function luminance([r, g, b]: RGBA): number {
  const c = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

export function contrast(fg: RGBA, bg: RGBA): number {
  const a = luminance(over(fg, bg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Surfaces text sits on, and the text colors that appear on them.
const SURFACES = ['color-chrome', 'color-page', 'color-bg', 'color-popover', 'color-outline-column'];
const BODY_TEXT = ['color-text', 'color-text-dim', 'color-text-dimmer', 'color-palette-item'];

describe.each(THEMES)('theme %s', (theme) => {
  const t = themeTokens(theme);
  const color = (name: string, on?: string): RGBA => {
    const c = parse(t[name] ?? (() => { throw new Error(`${theme}: missing --${name}`); })());
    return on ? over(c, parse(t[on]!)) : c;
  };

  it('defines every color token Dracula defines', () => {
    expect(Object.keys(t).sort()).toEqual(Object.keys(themeTokens('dracula')).sort());
  });

  it.each(SURFACES.flatMap((s) => BODY_TEXT.map((x) => [x, s])))('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('titles (large text) and the accent are at least 3:1 on the page', () => {
    for (const fg of ['color-h1', 'color-h2', 'color-accent']) expect(contrast(color(fg), color('color-page')), fg).toBeGreaterThanOrEqual(3);
  });

  it('the current scene row (accent wash) keeps body text readable', () => {
    const row = color('color-popover-active', 'color-outline-column');
    expect(contrast(color('color-text'), row)).toBeGreaterThanOrEqual(4.5);
  });

  if (theme === 'contrast') {
    // High Contrast goes further: WCAG AAA.
    it.each(SURFACES.flatMap((s) => BODY_TEXT.map((x) => [x, s])))('AAA: %s on %s is at least 7:1', (fg, bg) => {
      expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(7);
    });
    it('AAA: titles and the accent are at least 4.5:1, the current row and errors at least 7:1', () => {
      for (const fg of ['color-h1', 'color-h2', 'color-accent']) expect(contrast(color(fg), color('color-page')), fg).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color('color-text'), color('color-popover-active', 'color-outline-column'))).toBeGreaterThanOrEqual(7);
      expect(contrast(color('color-danger'), color('color-chrome'))).toBeGreaterThanOrEqual(7);
    });
  }

  it('an error ("not saved") reads on the status bar', () => {
    expect(contrast(color('color-danger'), color('color-chrome'))).toBeGreaterThanOrEqual(4.5);
  });
});
