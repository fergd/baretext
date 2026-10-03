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
export interface BookWeights { scenes: Map<string, [number, number]>; chapters: number[] }
/** Weighed once per outline (an outline is the book as it is at one moment: it never changes). */
const weighed = new WeakMap<object, BookWeights>();

export function weighBook(outline: Pick<Outline, 'chapters'>): BookWeights {
  let w = weighed.get(outline);
  if (!w) weighed.set(outline, (w = weigh(outline)));
  return w;
}

function weigh(outline: Pick<Outline, 'chapters'>): BookWeights {
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

/** A book's arc opens and closes quietly. */
const QUIET = 0.08;

/** 0 → 1, easing in and out (flat at both ends). */
const ease = (u: number) => u * u * (3 - 2 * u);

/**
 * The tension (0 to 1) at a share of the book: one smooth arc — rising from
 * a quiet start to the structure's climax (its most tense beat), then
 * falling to a quiet end; level at the top, with no corners anywhere.
 */
export function tensionAt(beats: readonly Beat[], share: number): number {
  const climax = beats.reduce<Beat | null>((top, b) => (!top || b.t > top.t ? b : top), null);
  const peak = Math.max(0.05, Math.min(0.97, climax?.at ?? 0.85));
  const x = Math.max(0, Math.min(1, share));
  const u = x <= peak ? x / peak : 1 - (x - peak) / (1 - peak);
  return QUIET + (1 - QUIET) * ease(u);
}

const SVG = 'http://www.w3.org/2000/svg';
/** The example arc an empty strip shows: a rise to a late climax, then a fall. */
const EXAMPLE: readonly Beat[] = [{ id: 'climax', name: '', at: 0.82, t: 1 }];
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

  /** `onChoose`: choose a structure; `onPick`: a point was chosen — go to that place in the book (a share of it). */
  constructor(onChoose: () => void, onPick: (share: number) => void) {
    this.el = document.createElement('div');
    this.el.className = 'bt-cork-arc';
    this.el.setAttribute('role', 'img');
    this.svg = document.createElementNS(SVG, 'svg');
    this.band = document.createElementNS(SVG, 'rect');
    this.band.setAttribute('class', 'bt-arc-band');
    this.choose = Object.assign(document.createElement('button'), { type: 'button', className: 'bt-cork-arc-choose', textContent: 'Choose a structure…' });
    this.choose.addEventListener('click', onChoose);
    this.el.append(this.svg, this.choose);
    // A point on the arc is a way to its place on the board (a click, or ↵ / space with the keyboard on it).
    const pick = (e: Event) => {
      const point = (e.target as Element).closest<SVGElement>('[data-share]');
      if (point) onPick(Number(point.dataset.share));
    };
    this.svg.addEventListener('click', pick);
    this.svg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); } });
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
    if (length <= 2 * pad) return;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const add = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string | number>, title?: string) => {
      const el = document.createElementNS(SVG, tag);
      el.setAttribute('class', cls);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      if (title) {
        el.append(Object.assign(document.createElementNS(SVG, 'title'), { textContent: title }));
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', `${title}. Go there`);
      }
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
    // No structure yet: a faint example of an arc, behind the way to choose one.
    const n = Math.max(2, Math.ceil((length - 2 * pad) / 3));
    const curve = Array.from({ length: n + 1 }, (_, i) => this.at(i / n, tensionAt(beats ?? EXAMPLE, i / n)).map((v) => v.toFixed(1)).join(' '));
    add('path', beats ? 'bt-arc-curve' : 'bt-arc-curve bt-arc-example', { d: `M${curve.join('L')}` });
    if (!beats) return;
    // Where each beat usually falls; and the scene marked as it, joined to that place.
    for (const b of beats) {
      const t = tensionAt(beats, b.at); // (on the arc)
      const [ix, iy] = this.at(b.at, t);
      const scene = marked.get(b.id);
      const usually = `usually about ${percent(b.at)}`;
      if (!scene) { add('circle', 'bt-arc-ideal', { cx: ix, cy: iy, r: 3, 'data-beat': b.id, 'data-share': b.at }, `${b.name} — ${usually}`); continue; }
      // On the arc at its own place; the stretch of arc between it and where the beat usually falls, dashed.
      const [mx, my] = this.at(scene.share, tensionAt(beats, scene.share));
      const [from, to] = [Math.min(b.at, scene.share), Math.max(b.at, scene.share)];
      const steps = Math.max(1, Math.ceil(((to - from) * (length - 2 * pad)) / 3));
      const stretch = Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps).map((p) => this.at(p, tensionAt(beats, p)).map((v) => v.toFixed(1)).join(' '));
      add('path', 'bt-arc-drift', { d: `M${stretch.join('L')}` });
      add('circle', 'bt-arc-ideal', { cx: ix, cy: iy, r: 3, 'data-share': b.at }, `${b.name} — ${usually}`);
      add('circle', 'bt-arc-mark', { cx: mx, cy: my, r: 4.5, 'data-beat': b.id, 'data-scene': scene.id, 'data-share': scene.share }, `${b.name}: ${scene.label} — at ${percent(scene.share)} (${usually})`);
    }
  }

  /** Show which stretch of the book is on screen (shares; null: none). */
  showView(view: [number, number] | null) {
    const { length, depth, pad, vertical } = this.frame;
    if (!view || !length || this.el.dataset.empty === 'true') { this.band.setAttribute('visibility', 'hidden'); return; } // (no arc yet: no band)
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
