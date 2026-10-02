// The tick spine: one short tick per scene, a long tick for the current
// scene, chapters grouped with extra space. When the book is too long to
// fit, every chapter except the current one (and one the writer opened)
// collapses to a single tick.
//
// The long tick is one indicator that glides between ticks, so moving
// through the book (caret, scrolling, clicking a tick) reads as motion.

import type { ChapterEntry, Outline } from './outline';
import { sceneDisplayName } from './outline';

const PITCH = 8;
const CHAPTER_GAP = 16;
const PADDING = 48;

export class Spine {
  private outline: Outline | null = null;
  private currentSceneId: string | null = null;
  private currentChapterId: string | null = null;
  private openChapterId: string | null = null;
  private collapsed = false;
  private renderedKey = '';
  private readonly inner: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly indicator: HTMLElement;

  constructor(private readonly el: HTMLElement, private readonly navigate: (sceneId: string) => void) {
    this.inner = document.createElement('div');
    this.inner.className = 'bt-spine-inner';
    this.tip = document.createElement('div');
    this.tip.className = 'bt-spine-tip';
    this.tip.setAttribute('aria-hidden', 'true');
    this.indicator = document.createElement('div');
    this.indicator.className = 'bt-spine-indicator';
    this.indicator.setAttribute('aria-hidden', 'true');
    this.inner.append(this.indicator);
    el.append(this.inner);
    el.parentElement!.append(this.tip);
    new ResizeObserver(() => this.render()).observe(el);
    this.inner.addEventListener('mouseleave', () => { this.tip.dataset.visible = 'false'; });
  }

  update(outline: Outline, currentSceneId: string | null, currentChapterId: string | null) {
    this.outline = outline;
    if (currentChapterId !== this.currentChapterId && this.openChapterId === currentChapterId) this.openChapterId = null;
    this.currentSceneId = currentSceneId;
    this.currentChapterId = currentChapterId;
    this.render();
  }

  private needed(outline: Outline, collapsed: boolean): number {
    let ticks = 0;
    for (const c of outline.chapters) {
      const expanded = !collapsed || c.id === this.currentChapterId || c.id === this.openChapterId;
      ticks += expanded ? c.scenes.length : 1;
    }
    return ticks * PITCH + Math.max(0, outline.chapters.length - 1) * CHAPTER_GAP + PADDING;
  }

  private render() {
    const outline = this.outline;
    if (!outline) return;
    const available = this.el.clientHeight;
    // Hysteresis: collapse when it no longer fits; expand only with room to spare.
    const full = this.needed(outline, false);
    if (!this.collapsed && full > available) this.collapsed = true;
    else if (this.collapsed && full < available - 64) this.collapsed = false;

    const key = [outline.signature, this.collapsed, this.currentChapterId, this.openChapterId].join('|');
    if (key !== this.renderedKey) {
      const previouslyOpen = this.renderedKey.split('|')[3];
      this.renderedKey = key;
      this.build(outline, previouslyOpen);
    }
    let target: HTMLElement | null = null;
    for (const tick of this.inner.querySelectorAll<HTMLElement>('.bt-tick')) {
      const current = tick.dataset.scene === this.currentSceneId ||
        (tick.dataset.collapsed === 'true' && tick.dataset.chapter === this.currentChapterId);
      tick.setAttribute('aria-current', String(current));
      if (current) target = tick;
    }
    this.placeIndicator(target);
  }

  /** Glide the long tick to `tick` (CSS transitions the transform). */
  private placeIndicator(tick: HTMLElement | null) {
    if (!tick) { this.indicator.dataset.visible = 'false'; return; }
    const top = tick.offsetTop + tick.offsetHeight / 2;
    const first = this.indicator.dataset.visible !== 'true';
    // First placement (or after hiding) snaps; every later move glides.
    if (first) this.indicator.dataset.snap = 'true';
    this.indicator.style.transform = `translateY(${Math.round(top)}px)`;
    this.indicator.dataset.visible = 'true';
    if (first) requestAnimationFrame(() => { delete this.indicator.dataset.snap; });
    // A long, scrolling spine keeps the current tick in view.
    const view = this.inner;
    if (top < view.scrollTop + 16 || top > view.scrollTop + view.clientHeight - 16) {
      view.scrollTo({ top: top - view.clientHeight / 2, behavior: 'smooth' });
    }
  }

  private build(outline: Outline, previouslyOpen: string | undefined) {
    // The indicator stays put (re-inserting it would cancel its glide).
    for (const group of this.inner.querySelectorAll('.bt-spine-chapter')) group.remove();
    for (const chapter of outline.chapters) {
      const group = document.createElement('div');
      group.className = 'bt-spine-chapter';
      const expanded = !this.collapsed || chapter.id === this.currentChapterId || chapter.id === this.openChapterId;
      if (expanded && this.collapsed && chapter.id === this.openChapterId && previouslyOpen !== chapter.id) group.dataset.expanding = 'true';
      if (expanded) {
        for (const scene of chapter.scenes) {
          group.append(this.tick(`${scene.label}`, sceneDisplayName(scene), () => this.navigate(scene.id), { scene: scene.id, chapter: chapter.id }));
        }
      } else {
        group.append(this.tick(`${chapter.number}`, chapter.title || 'Untitled', () => this.expand(chapter), { chapter: chapter.id, collapsed: 'true' }));
      }
      this.inner.append(group);
    }
  }

  private expand(chapter: ChapterEntry) {
    this.openChapterId = chapter.id;
    this.render();
  }

  private tick(num: string, name: string, onClick: () => void, data: Record<string, string>): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bt-tick';
    b.tabIndex = -1; // keyboard users navigate with the jump palette and outline
    b.setAttribute('aria-label', `${num} ${name}`);
    Object.assign(b.dataset, data);
    b.addEventListener('click', onClick);
    b.addEventListener('mouseenter', () => this.showTip(b, num, name));
    return b;
  }

  private showTip(anchor: HTMLElement, num: string, name: string) {
    const n = document.createElement('span');
    n.className = 'bt-tip-num';
    n.textContent = num;
    this.tip.replaceChildren(n, document.createTextNode(name));
    const host = this.el.parentElement!.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    const y = Math.round(r.top - host.top + r.height / 2 - 12);
    // Still fading out counts as showing: it turns and glides back.
    const showing = this.tip.dataset.visible === 'true' || this.tip.getAnimations().length > 0;
    if (!showing) {
      // Hidden: move to the new tick without animating, commit that, then
      // spring in from there (the commit is a style flush on one small,
      // out-of-flow element, only when the tip first appears).
      this.tip.dataset.snap = 'true';
      this.tip.style.setProperty('--tip-y', `${y}px`);
      void getComputedStyle(this.tip).transform;
      delete this.tip.dataset.snap;
    } else {
      this.tip.style.setProperty('--tip-y', `${y}px`);
    }
    this.tip.dataset.visible = 'true';
  }
}
