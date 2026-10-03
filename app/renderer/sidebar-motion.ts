// The side columns' motion (the outline on the left, notes on the right):
// the column slides in from its edge and the first items in view follow in a
// short cascade; closing keeps it painted (data-closing) until it has slid
// away. Transforms and opacity only.
//
// Like a magnet, the page leads both ways: closing, it glides first and
// pushes the column out (the reversed curve starts slow, then speeds away);
// opening, it glides first and the column is pulled in behind it — a curve
// that starts gently, gathers speed as the page slows, and settles with it.
// Never a pause and a lurch.

import { cssValue } from './dom';
import { glideMotion } from './motion';

const CASCADE_SPAN_MS = 160;
const CASCADE_STEP_MS = 12;
const CASCADE_OFFSET = 12;

export interface Motion {
  duration: number;
  easing: string;
  /** Opening: the column's curve, trailing the page's. */
  follow: string;
}

export function slideColumn(el: HTMLElement, side: 'left' | 'right', open: boolean, { duration, easing, follow }: Motion, items: () => HTMLElement[], list: HTMLElement) {
  for (const a of el.getAnimations({ subtree: true })) a.cancel();
  if (!duration) { delete el.dataset.closing; return; }
  if (!open) el.dataset.closing = 'true';
  const dir = side === 'left' ? -1 : 1;
  const slide = el.animate(
    [{ transform: `translateX(${dir * 100}%)`, opacity: 0.4 }, { transform: 'translateX(0)', opacity: 1 }],
    open ? { duration, easing: follow } : { duration, easing, direction: 'reverse' },
  );
  slide.onfinish = slide.oncancel = () => { if (!open) delete el.dataset.closing; };
  if (!open) return;
  // Every item in view joins the cascade; the whole wave fits a fixed span.
  const box = list.getBoundingClientRect();
  const visible = items().filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > box.top && b.top < box.bottom; });
  const step = Math.min(CASCADE_STEP_MS, CASCADE_SPAN_MS / Math.max(1, visible.length));
  visible.forEach((item, i) => {
    item.animate([{ opacity: 0, transform: `translateX(${dir * CASCADE_OFFSET}px)` }, { opacity: 1, transform: 'none' }],
      { duration: duration * 0.7, easing, delay: duration * 0.25 + i * step, /* as the column arrives */ fill: 'backwards' });
  });
}

/** A side column that slides (the outline, the notes panel). */
export interface SideColumn {
  motion(open: boolean, m: Motion): void;
}

/**
 * Columns open or close: the layout changes at once (`change`, keeping the
 * caret's line where it is), then the columns slide and the page glides from
 * where it was to its new place — so nothing in the manuscript is laid out
 * again during the motion. The motion's length (0 when not animated).
 */
export function moveColumns(page: HTMLElement, columns: SideColumn[], open: boolean, change: () => void, keepCaretLine: (change: () => void) => void, animate = true): number {
  const before = page.getBoundingClientRect().left;
  keepCaretLine(change);
  const { ms: duration, easing } = glideMotion('sidebar');
  const motion = { duration: animate ? duration : 0, easing, follow: cssValue('--ease-sidebar-follow', easing) };
  for (const c of columns) c.motion(open, motion);
  const dx = before - page.getBoundingClientRect().left;
  if (motion.duration && Math.abs(dx) >= 1) {
    page.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], { duration: motion.duration, easing, composite: 'add' });
  }
  return motion.duration;
}
