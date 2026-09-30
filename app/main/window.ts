// Where the window opens: where it was last time, if that is still on a
// connected display; otherwise a large window centered on the main display.

export interface Rect { x: number; y: number; width: number; height: number }

export const MIN_SIZE = { width: 520, height: 360 };
const MAX_DEFAULT = { width: 1440, height: 900 };

/** First launch (or a lost position): up to 1440×900, never more than 90% of the screen. */
export function defaultBounds(area: Rect): Rect {
  const width = Math.min(MAX_DEFAULT.width, Math.round(area.width * 0.9));
  const height = Math.min(MAX_DEFAULT.height, Math.round(area.height * 0.9));
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

const valid = (r: Rect | null | undefined): r is Rect =>
  !!r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= MIN_SIZE.width && r.height >= MIN_SIZE.height;

/** `areas[0]` is the main display's work area. */
export function placeWindow(saved: Rect | null | undefined, areas: readonly Rect[]): Rect {
  const main = areas[0]!;
  if (!valid(saved)) return defaultBounds(main);
  // The display holding the window's title bar area (where you'd grab it).
  const grabX = saved.x + Math.min(saved.width / 2, 200);
  const grabY = saved.y + 12;
  const area = areas.find((a) => grabX >= a.x && grabX < a.x + a.width && grabY >= a.y && grabY < a.y + a.height);
  if (!area) return defaultBounds(main);
  const width = Math.min(saved.width, area.width);
  const height = Math.min(saved.height, area.height);
  return {
    x: Math.min(Math.max(saved.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(saved.y, area.y), area.y + area.height - height),
    width,
    height,
  };
}
