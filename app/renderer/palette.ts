// Command palette (⌘K) and its "Go to chapter or scene" view (⌘⇧O).
//
// Built for speed: the input takes focus synchronously on open (no key is
// ever lost to the manuscript); rows are built once per opening and typing
// only re-ranks them; one delegated listener serves the whole list; no
// backdrop blur. Follows the dialog / combobox / listbox pattern.

import { prepare, search, type Prepared } from './fuzzy';

export interface PaletteItem {
  id: string;
  group: string;
  label: string;
  /** Extra words that find this item ("section break" finds Pause). */
  keywords?: string;
  /** Shortcut shown on the right. */
  keys?: string;
  /** Toggles show on/off; choices show a check on the current one. */
  state?: 'on' | 'off' | 'current';
  /** Indent level (scenes under their chapter in the jump list). */
  depth?: number;
  run: () => void;
  /** The item opens another view instead of closing the palette. */
  keepOpen?: boolean;
}

export interface PaletteView {
  name: string;
  placeholder: string;
  items: () => PaletteItem[];
  /** Item to highlight when the query is empty (e.g. the current scene). */
  initialId?: string | null;
  /** Backspace on an empty query goes back here. */
  back?: () => PaletteView;
}

export class Palette {
  readonly el: HTMLElement;
  private readonly scrim: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;

  private view: PaletteView | null = null;
  private items: PaletteItem[] = [];
  private prepared: Prepared[] = [];
  private rows: HTMLElement[] = [];
  /** Rows (and group headers) in their natural order, shown for an empty query. */
  private natural: HTMLElement[] = [];
  /** Item indices currently shown, in order. */
  private shown: number[] = [];
  private active = 0;
  private restoreFocus: (() => void) | null = null;

  /** Timings of the last open and the last keystroke, for performance tests. */
  readonly timings = { open: 0, filter: 0 };

  constructor(host: HTMLElement) {
    this.scrim = document.createElement('div');
    this.scrim.className = 'bt-palette-scrim';
    this.el = document.createElement('div');
    this.el.className = 'bt-palette';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Command palette');
    this.el.dataset.open = 'false';

    this.input = document.createElement('input');
    this.input.className = 'bt-palette-input';
    this.input.type = 'text';
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-expanded', 'true');
    this.input.setAttribute('aria-controls', 'bt-palette-list');
    this.input.setAttribute('aria-autocomplete', 'list');

    this.list = document.createElement('div');
    this.list.className = 'bt-palette-list';
    this.list.id = 'bt-palette-list';
    this.list.setAttribute('role', 'listbox');

    this.empty = document.createElement('div');
    this.empty.className = 'bt-palette-empty';
    this.empty.textContent = 'No matches';

    this.el.append(this.input, this.list, this.empty);
    host.append(this.scrim, this.el);

    this.input.addEventListener('input', () => this.filter());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    // Clicking a row must not blur the input first.
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
      if (row) this.choose(Number(row.dataset.index));
    });
    // Only a real pointer move changes the highlight (never a list scrolling under a still pointer).
    this.list.addEventListener('pointermove', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
      if (row) this.setActive(this.shown.indexOf(Number(row.dataset.index)), false);
    });
    this.scrim.addEventListener('mousedown', (e) => { e.preventDefault(); this.close(); });
  }

  get isOpen(): boolean {
    return this.el.dataset.open === 'true';
  }

  /** Name of the open view, or null when closed. */
  get current(): string | null {
    return this.isOpen ? this.view?.name ?? null : null;
  }

  /** Open (or switch to) a view. `restoreFocus` runs when the palette closes. */
  open(view: PaletteView, restoreFocus?: () => void) {
    const t0 = performance.now();
    if (!this.isOpen) this.restoreFocus = restoreFocus ?? null;
    this.view = view;
    this.items = view.items();
    this.prepared = prepare(this.items);
    this.build();
    this.input.value = '';
    this.input.placeholder = view.placeholder;
    this.el.dataset.open = 'true';
    this.scrim.dataset.open = 'true';
    this.input.focus();
    this.filter();
    const initial = view.initialId ? this.items.findIndex((i) => i.id === view.initialId) : -1;
    if (initial >= 0) this.setActive(this.shown.indexOf(initial), true, 'center');
    this.timings.open = performance.now() - t0;
  }

  close() {
    if (!this.isOpen) return;
    this.el.dataset.open = 'false';
    this.scrim.dataset.open = 'false';
    this.view = null;
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    restore?.();
  }

  // ── rendering ──

  private build() {
    this.rows = this.items.map((item, i) => {
      const row = document.createElement('div');
      row.className = 'bt-palette-row';
      row.id = `bt-palette-option-${i}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.dataset.index = String(i);
      if (item.depth) row.dataset.depth = String(item.depth);
      const label = document.createElement('span');
      label.className = 'bt-palette-label';
      label.textContent = item.label;
      row.append(label);
      if (item.state === 'on' || item.state === 'off') {
        const s = document.createElement('span');
        s.className = 'bt-palette-state';
        s.dataset.state = item.state;
        s.textContent = item.state;
        row.append(s);
        row.setAttribute('aria-checked', String(item.state === 'on'));
      } else if (item.state === 'current') {
        const s = document.createElement('span');
        s.className = 'bt-palette-check';
        s.textContent = '✓';
        row.append(s);
        row.setAttribute('aria-current', 'true');
      }
      if (item.keys) {
        const k = document.createElement('kbd');
        k.className = 'bt-palette-keys';
        k.textContent = item.keys;
        row.append(k);
      }
      return row;
    });
    this.natural = [];
    let group = '';
    this.items.forEach((item, i) => {
      if (item.group !== group) {
        group = item.group;
        const h = document.createElement('div');
        h.className = 'bt-palette-group';
        h.setAttribute('role', 'presentation');
        h.textContent = group;
        this.natural.push(h);
      }
      this.natural.push(this.rows[i]!);
    });
  }

  private filter() {
    const t0 = performance.now();
    const query = this.input.value;
    this.shown = search(query, this.prepared);
    // Grouped in natural order when browsing; ranked, without headers, when searching.
    this.list.replaceChildren(...(query.trim() ? this.shown.map((i) => this.rows[i]!) : this.natural));
    this.empty.hidden = this.shown.length > 0;
    this.setActive(0, true);
    this.timings.filter = performance.now() - t0;
  }

  private setActive(position: number, scroll: boolean, block: ScrollLogicalPosition = 'nearest') {
    if (position < 0 || !this.shown.length) {
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    this.rows[this.shown[this.active] ?? -1]?.setAttribute('aria-selected', 'false');
    this.active = position;
    const row = this.rows[this.shown[position]!]!;
    row.setAttribute('aria-selected', 'true');
    this.input.setAttribute('aria-activedescendant', row.id);
    if (scroll) row.scrollIntoView({ block });
  }

  private choose(index: number) {
    const item = this.items[index];
    if (!item) return;
    if (item.keepOpen) { item.run(); return; }
    // Close first so the command runs with the manuscript focused and its selection intact.
    this.close();
    item.run();
  }

  private onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    const n = this.shown.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (n) this.setActive((this.active + 1) % n, true);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (n) this.setActive((this.active - 1 + n) % n, true);
        break;
      case 'Enter':
        e.preventDefault();
        if (n) this.choose(this.shown[this.active]!);
        break;
      case 'Escape':
        // Claim Esc so it never also leaves focus mode (DECISIONS: Esc layering).
        e.preventDefault();
        e.stopPropagation();
        this.close();
        break;
      case 'Tab':
        e.preventDefault(); // focus stays in the palette
        break;
      case 'Backspace':
        if (!this.input.value && this.view?.back) {
          e.preventDefault();
          this.open(this.view.back());
        }
        break;
    }
  }
}
