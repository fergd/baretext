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
