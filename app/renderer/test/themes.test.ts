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
// How strongly the cold surfaces are washed with the theme's blue (must match tokens.css).
const COLD_PAGE_MIX = 0.06;
const COLD_BAR_MIX = 0.12;

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

  // Cold Storage: the theme's blue, and the surfaces washed with it (DECISIONS §14).
  const mix = (c: RGBA, pct: number, base: RGBA): RGBA => [0, 1, 2].map((i) => c[i]! * pct + base[i]! * (1 - pct)).concat(1) as RGBA;
  const coldPage = () => mix(color('color-cold'), COLD_PAGE_MIX, color('color-page'));
  const coldBar = () => mix(color('color-cold'), COLD_BAR_MIX, color('color-page'));

  it('Cold Storage: the blue label reads on its bar, and prose stays readable on the cold page', () => {
    const level = theme === 'contrast' ? 7 : 4.5;
    expect(contrast(color('color-cold'), coldBar()), 'cold on bar').toBeGreaterThanOrEqual(level);
    expect(contrast(color('color-cold'), color('color-outline-column')), 'cold in the outline').toBeGreaterThanOrEqual(level);
    for (const fg of ['color-text', 'color-text-dim']) expect(contrast(color(fg), coldPage()), fg).toBeGreaterThanOrEqual(level);
    for (const fg of ['color-h1', 'color-h2']) expect(contrast(color(fg), coldPage()), fg).toBeGreaterThanOrEqual(theme === 'contrast' ? 4.5 : 3);
  });

  // Notes (DECISIONS §16): each theme reserves a note color (a rose from its
  // own palette); a noted passage is washed with it, the active one more.
  // Mixed in OKLab, as tokens.css does, so the wash keeps its hue.
  const NOTE_WASH_MIX = 0.1; // must match tokens.css
  const NOTE_ACTIVE_MIX = 0.18;
  const toLin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const fromLin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const toLab = ([r, g, b]: RGBA) => {
    const [R, G, B] = [toLin(r), toLin(g), toLin(b)];
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const q = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q];
  };
  const fromLab = ([L, A, B]: number[]): RGBA => {
    const l = (L! + 0.3963377774 * A! + 0.2158037573 * B!) ** 3;
    const m = (L! - 0.1055613458 * A! - 0.0638541728 * B!) ** 3;
    const q = (L! - 0.0894841775 * A! - 1.291485548 * B!) ** 3;
    return [fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q), fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q), fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * q), 1];
  };
  const mixLab = (c: RGBA, pct: number, base: RGBA): RGBA => { const x = toLab(c), y = toLab(base); return fromLab(x.map((v, i) => v * pct + y[i]! * (1 - pct))); };
  it('notes: prose stays readable on a noted passage, active or not; the wash never looks like the selection', () => {
    const level = theme === 'contrast' ? 7 : 4.5;
    const wash = mixLab(color('color-note'), NOTE_WASH_MIX, color('color-page'));
    const active = mixLab(color('color-note'), NOTE_ACTIVE_MIX, color('color-page'));
    for (const bg of [wash, active]) for (const fg of ['color-text', 'color-text-dim']) expect(contrast(color(fg), bg), fg).toBeGreaterThanOrEqual(level);
    // Told apart by hue (OKLab angle), as the eye does.
    const hue = (c: RGBA) => { const [, a, b] = toLab(c); return (Math.atan2(b!, a!) * 180) / Math.PI; };
    const apart = (x: number, y: number) => { const d = Math.abs(x - y) % 360; return d > 180 ? 360 - d : d; };
    const sel = hue(color('color-selection', 'color-page'));
    expect(apart(hue(color('color-note')), sel), 'note hue vs selection hue').toBeGreaterThanOrEqual(45);
    // The outline's count badge: the note color on its wash, in the column.
    const badge = mixLab(color('color-note'), NOTE_WASH_MIX, color('color-outline-column'));
    expect(contrast(color('color-note'), badge), 'badge').toBeGreaterThanOrEqual(theme === 'contrast' ? 7 : 4.5);
  });

  it('an error ("not saved") reads on the status bar', () => {
    expect(contrast(color('color-danger'), color('color-chrome'))).toBeGreaterThanOrEqual(4.5);
  });
});
