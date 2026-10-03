// The story arc on the corkboard (DECISIONS §27): the whole book at a
// glance, in a strip along the board — across the top in Columns, down the
// left in Rows — however long the book. The book's structure is drawn as a
// tension curve over its length (by words). Hollow points: where each beat
// usually falls. Filled: the scene the writer marked as it, joined to where
// it usually is. A band shows the part of the board on screen.

import type { Outline } from './outline';
import type { Beat } from './structures';

/**
 * How the book is weighed: by words — or, while it has none, a scene apiece
 * (so an empty book still spreads out). Where each scene starts and ends, and
 * where each chapter starts, as shares of the book (0 to 1).
 */
export function weighBook(outline: Pick<Outline, 'chapters'>): { scenes: Map<string, [number, number]>; chapters: number[] } {
  const words = outline.chapters.reduce((n, c) => n + c.scenes.reduce((m, s) => m + s.words, 0), 0);
  const weight = (w: number) => (words > 0 ? w : 1);
  const total = outline.chapters.reduce((n, c) => n + c.scenes.reduce((m, s) => m + weight(s.words), 0), 0) || 1;
  const scenes = new Map<string, [number, number]>();
  const chapters: number[] = [];
  let before = 0;
  for (const c of outline.chapters) {
    chapters.push(before / total);
    for (const s of c.scenes) {
      const w = weight(s.words);
      scenes.set(s.id, [before / total, (before + w) / total]);
      before += w;
    }
  }
  return { scenes, chapters };
}

/** The middle of a scene's stretch of the book. */
export const middle = ([start, end]: [number, number]) => (start + end) / 2;

/**
 * A smooth curve through points (x ascending) that never overshoots them:
 * monotone between neighbours, flat at a peak or a valley (Fritsch–Carlson).
 * Beyond the ends it holds the end values.
 */
export function monotone(points: readonly (readonly [number, number])[]): (x: number) => number {
  const pts = points.filter((p, i) => i === 0 || p[0] > points[i - 1]![0]); // (one value per x)
  const n = pts.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => pts[0]![1];
  const slope = (j: number) => (pts[j + 1]![1] - pts[j]![1]) / (pts[j + 1]![0] - pts[j]![0]);
  const tangents = pts.map((_, j) => {
    if (j === 0) return slope(0);
    if (j === n - 1) return slope(j - 1);
    const [a, b] = [slope(j - 1), slope(j)];
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });
  return (x) => {
    if (x <= pts[0]![0]) return pts[0]![1];
    if (x >= pts[n - 1]![0]) return pts[n - 1]![1];
    let i = 0;
    while (x > pts[i + 1]![0]) i++;
    const [[x0, y0], [x1, y1]] = [pts[i]!, pts[i + 1]!];
    const h = x1 - x0;
    const u = (x - x0) / h;
    return (2 * u ** 3 - 3 * u ** 2 + 1) * y0 + (u ** 3 - 2 * u ** 2 + u) * h * tangents[i]!
      + (-2 * u ** 3 + 3 * u ** 2) * y1 + (u ** 3 - u ** 2) * h * tangents[i + 1]!;
  };
}

/** The tension (0 to 1) at a share of the book: through the structure's beats, from a quiet start to a quiet end. */
export function tensionAt(beats: readonly Beat[], share: number): number {
  const pts: [number, number][] = beats.map((b) => [b.at, b.t]);
  if (!pts.length || pts[0]![0] > 0) pts.unshift([0, QUIET]);
  if (pts.at(-1)![0] < 1) pts.push([1, QUIET]);
  return Math.max(0, Math.min(1, monotone(pts)(share)));
}

/** A book's arc opens and closes quietly. */
const QUIET = 0.08;

const SVG = 'http://www.w3.org/2000/svg';
const percent = (share: number) => `${Math.round(share * 100)}%`;

/** The arc's strip beside the board: drawn afresh when the book changes; its band follows the scrolling. */
export class ArcStrip {
  readonly el: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly band: SVGRectElement;
  private readonly choose: HTMLButtonElement;
  /** What the drawing on show was made from (the same again: nothing to do). */
  private drawn = '';
  /** The strip's run (px along it), its depth (px across), and which way it runs. */
  private frame = { length: 0, depth: 0, pad: 0, vertical: false };

  constructor(onChoose: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'bt-cork-arc';
    this.el.setAttribute('role', 'img');
    this.svg = document.createElementNS(SVG, 'svg');
    this.band = document.createElementNS(SVG, 'rect');
    this.band.setAttribute('class', 'bt-arc-band');
    this.choose = Object.assign(document.createElement('button'), { type: 'button', className: 'bt-cork-arc-choose', textContent: 'Choose a structure…' });
    this.choose.addEventListener('click', onChoose);
    this.el.append(this.svg, this.choose);
  }

  /** Draw the book's arc (`beats`: its structure's; none: the strip offers to choose one); `vertical`: down the left (Rows). */
  draw(outline: Outline, beats: readonly Beat[] | null, vertical: boolean) {
    const { width, height } = this.el.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(this.el).paddingTop) || 0;
    const [length, depth] = vertical ? [height, width] : [width, height];
    const weights = weighBook(outline);
    // Each marked scene, at its middle.
    const marked = new Map(outline.chapters.flatMap((c) => c.scenes).filter((s) => s.beat).map((s) => [s.beat!, { id: s.id, label: s.label, share: middle(weights.scenes.get(s.id) ?? [0, 0]) }]));
    const key = JSON.stringify([length, depth, vertical, beats, [...marked], weights.chapters]);
    if (key === this.drawn) return;
    this.drawn = key;
    this.frame = { length, depth, pad, vertical };
    this.el.dataset.empty = String(!beats);
    this.el.setAttribute('aria-label', beats ? 'The story arc' : 'The story arc: no structure chosen');
    this.svg.replaceChildren();
    if (!beats || length <= 2 * pad) return;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const add = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string | number>, title?: string) => {
      const el = document.createElementNS(SVG, tag);
      el.setAttribute('class', cls);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      if (title) el.append(Object.assign(document.createElementNS(SVG, 'title'), { textContent: title }));
      this.svg.append(el);
      return el;
    };
    this.svg.append(this.band);
    // The base: the book's length, a tick where each chapter starts.
    const [b0, b1] = [this.at(0, 0), this.at(1, 0)];
    add('line', 'bt-arc-base', { x1: b0[0], y1: b0[1], x2: b1[0], y2: b1[1] });
    for (const share of weights.chapters.slice(1)) {
      const [x, y] = this.at(share, 0);
      const [dx, dy] = vertical ? [-pad / 2, 0] : [0, pad / 2];
      add('line', 'bt-arc-tick', { x1: x, y1: y, x2: x + dx, y2: y + dy });
    }
    const n = Math.max(2, Math.ceil((length - 2 * pad) / 3));
    const curve = Array.from({ length: n + 1 }, (_, i) => this.at(i / n, tensionAt(beats, i / n)).map((v) => v.toFixed(1)).join(' '));
    add('path', 'bt-arc-curve', { d: `M${curve.join('L')}` });
    // Where each beat usually falls; and the scene marked as it, joined to that place.
    for (const b of beats) {
      const [ix, iy] = this.at(b.at, b.t);
      const scene = marked.get(b.id);
      const usually = `usually about ${percent(b.at)}`;
      if (!scene) { add('circle', 'bt-arc-ideal', { cx: ix, cy: iy, r: 3, 'data-beat': b.id }, `${b.name} — ${usually}`); continue; }
      const [mx, my] = this.at(scene.share, b.t);
      add('line', 'bt-arc-drift', { x1: ix, y1: iy, x2: mx, y2: my });
      add('circle', 'bt-arc-ideal', { cx: ix, cy: iy, r: 3 }, `${b.name} — ${usually}`);
      add('circle', 'bt-arc-mark', { cx: mx, cy: my, r: 4.5, 'data-beat': b.id, 'data-scene': scene.id }, `${b.name}: ${scene.label} — at ${percent(scene.share)} (${usually})`);
    }
  }

  /** Show which stretch of the book is on screen (shares; null: none). */
  showView(view: [number, number] | null) {
    const { length, depth, pad, vertical } = this.frame;
    if (!view || !length) { this.band.setAttribute('visibility', 'hidden'); return; }
    const run = length - 2 * pad;
    const [from, to] = [pad + view[0] * run, pad + view[1] * run];
    const box = vertical ? { x: 0, y: from, width: depth, height: to - from } : { x: from, y: 0, width: to - from, height: depth };
    for (const [k, v] of Object.entries(box)) this.band.setAttribute(k, v.toFixed(1));
    this.band.setAttribute('visibility', 'visible');
  }

  /** [share of the book, tension] → the strip's x, y (Columns: along x, tension up; Rows: along y, tension to the right). */
  private at(share: number, t: number): [number, number] {
    const { length, depth, pad, vertical } = this.frame;
    const along = pad + share * (length - 2 * pad);
    return vertical ? [pad + t * (depth - 2 * pad), along] : [along, depth - pad - t * (depth - 2 * pad)];
  }
}
