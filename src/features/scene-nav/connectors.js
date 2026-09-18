// An overlay in the scrolling content keeps connectors attached to their
// cards. ResizeObserver also covers wrapped rows and expanded summaries.
export function connectCards(canvas) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('scene-connectors');
  svg.setAttribute('aria-hidden', 'true');
  canvas.prepend(svg);
  let frame;

  function draw() {
    const origin = canvas.getBoundingClientRect();
    svg.setAttribute('width', origin.width);
    svg.setAttribute('height', origin.height);
    const groups = new Map();
    for (const card of canvas.querySelectorAll('[data-connector-group]')) {
      const key = card.dataset.connectorGroup;
      if (!groups.has(key)) groups.set(key, []);
      const r = card.getBoundingClientRect();
      groups.get(key).push({ left: r.left - origin.left, right: r.right - origin.left, top: r.top - origin.top, bottom: r.bottom - origin.top });
    }
    const paths = [];
    for (const cards of groups.values()) {
      for (let i = 1; i < cards.length; i++) {
        const a = cards[i - 1], b = cards[i];
        let d;
        if (Math.abs(a.top - b.top) < 2 && b.left - a.right < 40) {
          const ay = (a.top + a.bottom) / 2, by = (b.top + b.bottom) / 2;
          const bend = (b.left - a.right) / 2;
          d = `M ${a.right} ${ay} C ${a.right + bend} ${ay + 6}, ${b.left - bend} ${by + 6}, ${b.left} ${by}`;
        } else if (Math.abs(a.top - b.top) < 2) {
          const x1 = (a.left + a.right) / 2, x2 = (b.left + b.right) / 2;
          const y = Math.max(a.bottom, b.bottom) + 8;
          d = `M ${x1} ${a.bottom} Q ${x1} ${y} ${x1 + 8} ${y} L ${x2 - 8} ${y} Q ${x2} ${y} ${x2} ${b.bottom}`;
        } else if (b.top - a.bottom < 30) {
          const x1 = (a.left + a.right) / 2, x2 = (b.left + b.right) / 2;
          const mid = (a.bottom + b.top) / 2;
          d = `M ${x1} ${a.bottom} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${b.top}`;
        } else {
          const x1 = (a.left + a.right) / 2, x2 = (b.left + b.right) / 2;
          const y1 = a.bottom + 7, y2 = b.top - 7, outside = origin.width + 12;
          d = `M ${x1} ${a.bottom} Q ${x1} ${y1} ${x1 + 6} ${y1} L ${outside - 6} ${y1} Q ${outside} ${y1} ${outside} ${y1 + 6} L ${outside} ${y2 - 6} Q ${outside} ${y2} ${outside - 6} ${y2} L ${x2 + 6} ${y2} Q ${x2} ${y2} ${x2} ${b.top}`;
        }
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', d);
        paths.push(path);
      }
    }
    svg.replaceChildren(...paths);
  }
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  });
  observer.observe(canvas);
  canvas.querySelectorAll('.scene-card').forEach(card => observer.observe(card));
  draw();
  return () => { observer.disconnect(); cancelAnimationFrame(frame); };
}
