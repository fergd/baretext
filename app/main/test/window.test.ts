import { describe, expect, it } from 'vitest';
import { defaultBounds, placeWindow, type Rect } from '../window';

const laptop: Rect = { x: 0, y: 25, width: 1512, height: 944 };       // main display work area
const external: Rect = { x: 1512, y: 0, width: 2560, height: 1415 };

describe('window placement', () => {
  it('first launch: a large window centered on the main display, capped at 1440×900', () => {
    expect(defaultBounds(laptop)).toEqual({ x: 76, y: 72, width: 1361, height: 850 }); // 90% of a 1512×944 screen
    expect(defaultBounds(external)).toEqual({ x: 1512 + 560, y: 258, width: 1440, height: 900 });
    const small: Rect = { x: 0, y: 25, width: 1280, height: 775 };
    const b = defaultBounds(small);
    expect(b.width).toBe(Math.round(1280 * 0.9));
    expect(b.height).toBe(Math.round(775 * 0.9));
    expect(b.x + b.width / 2).toBeCloseTo(640, 0);
  });

  it('restores the saved size and position when it is on a connected display', () => {
    const saved = { x: 1700, y: 100, width: 1800, height: 1100 };
    expect(placeWindow(saved, [laptop, external])).toEqual(saved);
  });

  it('falls back to the default when the saved spot is off every display (monitor unplugged)', () => {
    const saved = { x: 1700, y: 100, width: 1800, height: 1100 };
    expect(placeWindow(saved, [laptop])).toEqual(defaultBounds(laptop));
  });

  it('shrinks a saved size that no longer fits, keeping it on screen', () => {
    const saved = { x: 10, y: 30, width: 3000, height: 2000 };
    const b = placeWindow(saved, [laptop]);
    expect(b.width).toBeLessThanOrEqual(laptop.width);
    expect(b.height).toBeLessThanOrEqual(laptop.height);
    expect(b.x).toBeGreaterThanOrEqual(laptop.x);
    expect(b.y).toBeGreaterThanOrEqual(laptop.y);
  });

  it('ignores nonsense', () => {
    expect(placeWindow(null, [laptop])).toEqual(defaultBounds(laptop));
    expect(placeWindow({ x: 0, y: 0, width: -5, height: 10 } as Rect, [laptop])).toEqual(defaultBounds(laptop));
  });
});
