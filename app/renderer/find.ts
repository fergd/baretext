// Find & replace panel (⌘F, ⌥⌘F). Searches as you type; highlights only
// what is near the screen; the current match is centered (so it sits in
// the clear band in typewriter mode). The manuscript's selection is left
// alone while you search and moves to the current match when you close
// with Esc — or when you replace.

import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { FIND_LIMIT, findKey, findMatches, replaceAll, replaceMatch, type FindMatch } from '@baretext/editor';

const numberFormat = new Intl.NumberFormat();

const ICONS = {
  expand: '<path d="M6 4l4 4-4 4"/>',
  prev: '<path d="M4 10l4-4 4 4"/>',
  next: '<path d="M4 6l4 4 4-4"/>',
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
};
const svg = (paths: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export class FindPanel {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly caseButton: HTMLButtonElement;
  private readonly wordButton: HTMLButtonElement;

  private matches: FindMatch[] = [];
  private current = -1;
  private searchedDoc: unknown = null;
  private frame = 0;
  private restoreFocus = true;

  /** Script time of the last search, for performance tests. */
  lastSearchMs = 0;

  constructor(
    workspace: HTMLElement,
    private readonly scroller: HTMLElement,
    private readonly getView: () => EditorView | null,
    /** Runs just before Replace All changes the manuscript (a snapshot). */
    private readonly beforeReplaceAll: () => void = () => {},
  ) {
    this.el = document.createElement('div');
    this.el.className = 'bt-find';
    this.el.setAttribute('role', 'search');
    this.el.setAttribute('aria-label', 'Find and replace');
    this.el.dataset.open = 'false';
    this.el.dataset.replace = 'false';
    this.el.innerHTML = `
      <div class="bt-find-row">
        <button type="button" class="bt-find-icon bt-find-expand" data-action="toggle-replace" aria-expanded="false" aria-label="Show replace" title="Replace  ⌥⌘F">${svg(ICONS.expand)}</button>
        <div class="bt-find-field">
          <input class="bt-find-input" type="text" placeholder="Find" aria-label="Find" spellcheck="false" autocomplete="off">
          <span class="bt-find-count" aria-live="polite"></span>
        </div>
        <div class="bt-find-controls">
          <button type="button" class="bt-find-toggle" data-option="case" aria-pressed="false" title="Match case">Aa</button>
          <button type="button" class="bt-find-toggle" data-option="word" aria-pressed="false" title="Whole word">ab</button>
          <button type="button" class="bt-find-icon" data-action="prev" aria-label="Previous match" title="Previous  ⇧⌘G">${svg(ICONS.prev)}</button>
          <button type="button" class="bt-find-icon" data-action="next" aria-label="Next match" title="Next  ⌘G">${svg(ICONS.next)}</button>
          <button type="button" class="bt-find-icon" data-action="close" aria-label="Close" title="Close  Esc">${svg(ICONS.close)}</button>
        </div>
      </div>
      <div class="bt-find-row bt-find-replace-row">
        <span class="bt-find-indent" aria-hidden="true"></span>
        <input class="bt-find-input" data-ref="replace" type="text" placeholder="Replace with" aria-label="Replace with" spellcheck="false" autocomplete="off">
        <div class="bt-find-controls">
          <button type="button" class="bt-find-text" data-action="replace">Replace</button>
          <button type="button" class="bt-find-text" data-action="all">All</button>
        </div>
      </div>`;
    workspace.append(this.el);
    this.input = this.el.querySelector('.bt-find-input')!;
    this.replaceInput = this.el.querySelector('[data-ref="replace"]')!;
    this.count = this.el.querySelector('.bt-find-count')!;
    this.caseButton = this.el.querySelector('[data-option="case"]')!;
    this.wordButton = this.el.querySelector('[data-option="word"]')!;

    this.input.addEventListener('input', () => this.search(true));
    this.input.addEventListener('keydown', (e) => this.onKey(e, false));
    this.replaceInput.addEventListener('keydown', (e) => this.onKey(e, true));
    this.el.addEventListener('mousedown', (e) => {
      if (!(e.target as HTMLElement).closest('input')) e.preventDefault(); // buttons keep the field focused
    });
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.dataset.option) {
        b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
        this.search(true);
        return;
      }
      switch (b.dataset.action) {
        case 'prev': this.step(-1); break;
        case 'next': this.step(1); break;
        case 'close': this.close(); break;
        case 'toggle-replace': this.setReplace(this.el.dataset.replace !== 'true', true); break;
        case 'replace': this.replaceOne(); break;
        case 'all': this.replaceEvery(); break;
      }
    });
    scroller.addEventListener('scroll', () => this.scheduleHighlight(), { passive: true });
  }

  get isOpen(): boolean {
    return this.el.dataset.open === 'true';
  }

  /** ⌘F / ⌥⌘F. A short one-line selection becomes the query. */
  open(replace: boolean) {
    const view = this.getView();
    if (!view) return;
    const { from, to, empty } = view.state.selection;
    const selected = empty ? '' : view.state.doc.textBetween(from, to, '\n');
    if (selected && !selected.includes('\n') && selected.length <= 200) this.input.value = selected;
    const wasOpen = this.isOpen;
    this.el.dataset.open = 'true';
    this.restoreFocus = true;
    if (replace) this.setReplace(true, wasOpen && !!this.input.value);
    if (!replace || !wasOpen || !this.input.value) { this.input.focus(); this.input.select(); }
    this.search(true);
  }

  /** Show or hide the Replace row; `focusIt` moves the caret into it. */
  private setReplace(on: boolean, focusIt: boolean) {
    this.el.dataset.replace = String(on);
    const toggle = this.el.querySelector<HTMLButtonElement>('[data-action="toggle-replace"]')!;
    toggle.setAttribute('aria-expanded', String(on));
    toggle.setAttribute('aria-label', on ? 'Hide replace' : 'Show replace');
    if (on && focusIt) { this.replaceInput.focus(); this.replaceInput.select(); }
    else if (!on && document.activeElement === this.replaceInput) this.input.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.el.dataset.open = 'false';
    this.setReplace(false, false);
    const view = this.getView();
    if (!view) return;
    // Leave the manuscript on the current match.
    const m = this.matches[this.current];
    const tr = view.state.tr.setMeta(findKey, null);
    if (m && m.to <= view.state.doc.content.size) tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to));
    view.dispatch(tr);
    if (this.restoreFocus) view.focus();
  }

  /** ⌘G / ⇧⌘G: step, opening the panel with the last query if needed. */
  next(dir: 1 | -1) {
    if (!this.isOpen) { this.open(false); if (!this.input.value) return; }
    this.step(dir);
  }

  // ── searching ──

  private options() {
    return { caseSensitive: this.caseButton.getAttribute('aria-pressed') === 'true', wholeWord: this.wordButton.getAttribute('aria-pressed') === 'true' };
  }

  /** Recompute matches; `fromCaret` picks the first match at or after the caret. */
  private search(fromCaret: boolean) {
    const view = this.getView();
    if (!view) return;
    const t0 = performance.now();
    const doc = view.state.doc;
    const previous = this.matches[this.current];
    this.matches = findMatches(doc, this.input.value, this.options());
    this.searchedDoc = doc;
    const anchor = fromCaret ? view.state.selection.from : previous?.from ?? 0;
    let i = this.matches.findIndex((m) => m.from >= anchor);
    if (i < 0) i = this.matches.length ? 0 : -1;
    this.current = i;
    this.lastSearchMs = performance.now() - t0;
    this.render(true);
  }

  private step(dir: 1 | -1) {
    const view = this.getView();
    if (view && view.state.doc !== this.searchedDoc) this.search(false);
    const n = this.matches.length;
    if (!n) return;
    this.current = (this.current + dir + n) % n;
    this.render(true);
  }

  private replaceOne() {
    const view = this.getView();
    const m = this.matches[this.current];
    if (!view || !m) return;
    const tr = replaceMatch(view.state, m, this.replaceInput.value);
    if (!tr) return;
    view.dispatch(tr);
    // Continue from just after the replacement.
    const after = tr.mapping.map(m.to);
    this.matches = findMatches(view.state.doc, this.input.value, this.options());
    this.searchedDoc = view.state.doc;
    const i = this.matches.findIndex((x) => x.from >= after);
    this.current = i >= 0 ? i : this.matches.length ? 0 : -1;
    this.render(true);
  }

  private replaceEvery() {
    const view = this.getView();
    if (!view || !this.matches.length) return;
    const all = findMatches(view.state.doc, this.input.value, { ...this.options(), limit: Infinity });
    const tr = replaceAll(view.state, all, this.replaceInput.value);
    if (!tr) return;
    this.beforeReplaceAll();
    view.dispatch(tr);
    this.count.textContent = `Replaced ${numberFormat.format(all.length)}`;
    this.matches = findMatches(view.state.doc, this.input.value, this.options());
    this.searchedDoc = view.state.doc;
    this.current = this.matches.length ? 0 : -1;
    this.render(false, true);
  }

  // ── display ──

  private render(reveal: boolean, keepCount = false) {
    const n = this.matches.length;
    if (!keepCount) {
      this.count.textContent = !this.input.value ? '' : !n ? 'No results'
        : `${numberFormat.format(this.current + 1)} of ${numberFormat.format(n)}${n >= FIND_LIMIT ? '+' : ''}`;
    }
    this.el.dataset.empty = String(!!this.input.value && !n);
    this.el.dataset.counted = String(!!this.count.textContent);
    if (reveal) this.reveal();
    this.highlight();
  }

  /** Center the current match in the window (the clear band in typewriter mode). */
  private reveal() {
    const view = this.getView();
    const m = this.matches[this.current];
    if (!view || !m) return;
    let c: { top: number; bottom: number };
    try { c = view.coordsAtPos(m.from); } catch { return; }
    const box = this.scroller.getBoundingClientRect();
    const mid = (c.top + c.bottom) / 2;
    const margin = box.height / 4;
    if (mid < box.top + margin || mid > box.bottom - margin) {
      this.scroller.scrollTop += Math.round(mid - (box.top + box.height / 2));
    }
  }

  private scheduleHighlight() {
    if (!this.isOpen || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.highlight(); });
  }

  /** Decorate matches within about a screen of what is visible. */
  private highlight() {
    const view = this.getView();
    if (!view || !this.isOpen) return;
    const box = this.scroller.getBoundingClientRect();
    const column = view.dom.getBoundingClientRect();
    const x = (column.left + column.right) / 2;
    const at = (y: number, fallback: number) => view.posAtCoords({ left: x, top: y })?.pos ?? fallback;
    const window = {
      from: at(box.top - box.height, 0),
      to: at(box.bottom + box.height, view.state.doc.content.size),
    };
    if (window.to <= window.from) window.to = view.state.doc.content.size;
    view.dispatch(view.state.tr.setMeta(findKey, { matches: this.matches, current: this.current, window }));
  }

  private onKey(e: KeyboardEvent, inReplace: boolean) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // Esc layering: closing find never also leaves focus mode
      this.close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (inReplace) this.replaceOne();
      else this.step(e.shiftKey ? -1 : 1);
    }
  }
}
