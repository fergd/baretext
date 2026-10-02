// Export (DECISIONS §18): choose a format and what to include, then
// Export… asks where (the macOS save dialog). Remembers the last choices.
// Built from the Appearance panel's parts so the two read as one family.

import type { ExportFormat } from '@baretext/format';
import type { ExportPrefs, ExportResult } from '../shared/bridge';

export interface ExportCounts {
  /** The book's title (for the Author field's example). */
  title: string;
  words: number;
  chapters: number;
  /** Parked scenes. */
  cold: number;
  /** Open notes. */
  notes: number;
}

export interface ExportHost {
  current(): ExportPrefs;
  counts(): ExportCounts;
  /** Export with these choices (they are remembered either way). */
  run(prefs: ExportPrefs): Promise<ExportResult>;
  onClose(): void;
}

const FORMATS: [ExportFormat, string, string][] = [
  ['docx', 'Word', 'Standard manuscript format'],
  ['markdown', 'Markdown', 'Clean, portable text'],
  ['text', 'Plain text', 'No formatting at all'],
];

const numberFormat = new Intl.NumberFormat();
const plural = (n: number, one: string, many = `${one}s`) => `${numberFormat.format(n)} ${n === 1 ? one : many}`;

export class ExportPanel {
  readonly el: HTMLElement;
  private readonly scrim: HTMLElement;
  private readonly author: HTMLInputElement;
  private pending: ExportPrefs = { format: 'docx', coldStorage: false, notes: false, author: '' };
  private counts: ExportCounts = { title: '', words: 0, chapters: 0, cold: 0, notes: 0 };
  private busy = false;

  constructor(host: HTMLElement, private readonly h: ExportHost) {
    this.scrim = document.createElement('div');
    this.scrim.className = 'bt-palette-scrim';
    this.el = document.createElement('div');
    this.el.className = 'bt-appearance bt-export';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'bt-export-title');
    this.el.dataset.open = 'false';
    this.el.innerHTML = `
      <header class="bt-appearance-head"><span class="bt-appearance-title" id="bt-export-title">Export</span></header>
      <div class="bt-export-body">
        <div class="bt-appearance-group">
          <span class="bt-appearance-label" id="bt-export-format">Format</span>
          <div role="radiogroup" aria-labelledby="bt-export-format" class="bt-choices bt-export-formats">${FORMATS.map(([value, label, detail]) => `
            <button type="button" role="radio" class="bt-choice" data-value="${value}" aria-checked="false">
              <span class="bt-choice-label">${label}</span><span class="bt-choice-detail">${detail}</span>
            </button>`).join('')}
          </div>
        </div>
        <label class="bt-appearance-group bt-export-author">
          <span class="bt-appearance-label">Author</span>
          <input type="text" class="bt-export-input" placeholder="Your name, as it should appear" spellcheck="false" autocomplete="name">
          <span class="bt-choice-detail bt-export-hint"></span>
        </label>
        <div class="bt-appearance-group">
          <span class="bt-appearance-label">Include</span>
          <div class="bt-export-includes">
            <button type="button" class="bt-toggle bt-export-include" role="switch" data-key="coldStorage" aria-checked="false"><span class="bt-switch" aria-hidden="true"><span class="bt-switch-knob"></span></span><span class="bt-export-include-label">Cold Storage</span><span class="bt-choice-detail" data-count="cold"></span></button>
            <button type="button" class="bt-toggle bt-export-include" role="switch" data-key="notes" aria-checked="false"><span class="bt-switch" aria-hidden="true"><span class="bt-switch-knob"></span></span><span class="bt-export-include-label">Notes</span><span class="bt-choice-detail" data-count="notes"></span></button>
          </div>
        </div>
      </div>
      <footer class="bt-appearance-foot">
        <span class="bt-export-summary"></span>
        <button type="button" class="bt-appearance-button" data-action="cancel">Cancel</button>
        <button type="button" class="bt-appearance-button bt-appearance-primary" data-action="export">Export…</button>
      </footer>`;
    host.append(this.scrim, this.el);
    this.author = this.el.querySelector('.bt-export-input')!;

    this.scrim.addEventListener('mousedown', (e) => { e.preventDefault(); this.close(); });
    this.author.addEventListener('input', () => { this.pending.author = this.author.value; this.reflect(); });
    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const radio = target.closest<HTMLElement>('[role="radio"]');
      if (radio) { this.pending.format = radio.dataset.value as ExportFormat; this.reflect(); return; }
      const include = target.closest<HTMLButtonElement>('[role="switch"]');
      if (include && !include.disabled) { const k = include.dataset.key as 'coldStorage' | 'notes'; this.pending[k] = !this.pending[k]; this.reflect(); return; }
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'export') void this.export();
      else if (action === 'cancel') this.close();
    });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return this.el.dataset.open === 'true';
  }

  open() {
    if (this.isOpen) return;
    this.pending = { ...this.h.current() };
    this.counts = this.h.counts();
    this.author.value = this.pending.author;
    this.reflect();
    this.el.dataset.open = 'true';
    this.scrim.dataset.open = 'true';
    this.el.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.el.dataset.open = 'false';
    this.scrim.dataset.open = 'false';
    this.h.onClose();
  }

  private async export() {
    if (this.busy) return;
    this.busy = true;
    this.el.dataset.busy = 'true';
    try {
      const result = await this.h.run({ ...this.pending, author: this.pending.author.trim() });
      if (result.ok) this.close(); // a cancelled save dialog leaves the panel as it was
    } finally {
      this.busy = false;
      delete this.el.dataset.busy;
    }
  }

  private reflect() {
    const p = this.pending;
    for (const radio of this.el.querySelectorAll<HTMLElement>('[role="radio"]')) {
      const on = radio.dataset.value === p.format;
      radio.setAttribute('aria-checked', String(on));
      radio.tabIndex = on ? 0 : -1;
    }
    this.el.querySelector<HTMLElement>('.bt-export-author')!.hidden = p.format !== 'docx';
    // Where the name goes in a Word manuscript: the byline, and every page's header.
    const name = p.author.trim();
    const head = [name.split(/\s+/).at(-1), (this.counts.title.trim() || 'Untitled').toUpperCase()].filter(Boolean).join(' / ');
    this.el.querySelector('.bt-export-hint')!.textContent = name
      ? `“by ${name}” on the title page; “${head} / 2” atop each page`
      : 'For the title page’s byline and the header atop each page';
    const c = this.counts;
    for (const sw of this.el.querySelectorAll<HTMLButtonElement>('[role="switch"]')) {
      const key = sw.dataset.key as 'coldStorage' | 'notes';
      const count = key === 'coldStorage' ? c.cold : c.notes;
      sw.disabled = count === 0;
      sw.setAttribute('aria-checked', String(count > 0 && p[key]));
    }
    this.el.querySelector('[data-count="cold"]')!.textContent = c.cold ? plural(c.cold, 'scene') : 'None';
    this.el.querySelector('[data-count="notes"]')!.textContent = c.notes
      ? `${plural(c.notes, 'open note')}${p.format === 'docx' ? ' as comments' : ''}`
      : 'None';
    this.el.querySelector('.bt-export-summary')!.textContent = `${plural(c.chapters, 'chapter')} · ${plural(c.words, 'word')}`;
  }

  private onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.target === this.author)) { e.preventDefault(); void this.export(); return; }
    if (e.key === 'Tab') { this.trapTab(e); return; }
    const radio = (e.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!radio || !step) return;
    e.preventDefault();
    const radios = [...this.el.querySelectorAll<HTMLElement>('[role="radio"]')];
    const next = radios[(radios.indexOf(radio) + step + radios.length) % radios.length]!;
    this.pending.format = next.dataset.value as ExportFormat;
    this.reflect();
    next.focus();
  }

  /** Keep keyboard focus inside the dialog. */
  private trapTab(e: KeyboardEvent) {
    const stops = [...this.el.querySelectorAll<HTMLElement>('button, input')].filter((b) => b.tabIndex >= 0 && b.offsetParent !== null && !(b as HTMLButtonElement).disabled);
    if (!stops.length) return;
    const i = stops.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i === stops.length - 1 ? 0 : i + 1);
    e.preventDefault();
    stops[next]!.focus();
  }
}
