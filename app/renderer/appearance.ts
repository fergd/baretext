// Appearance (DECISIONS §10): theme, prose font, paragraph spacing, prose
// width and font size in one place. Choices show in a sample window drawn
// with the writer's own current scene; nothing in the app changes until
// Save. Cancel or Esc leaves everything as it was.

import {
  DEFAULT_APPEARANCE,
  type AppearancePrefs,
  type FontSize,
  type ParagraphSpacing,
  type ProseFont,
  type ProseWidth,
  type Theme,
} from '../shared/bridge';

/** What the sample window shows: the writer's own scene. */
export interface SampleText {
  book: string;
  chapterNumber: number;
  chapterTitle: string;
  sceneLabel: string;
  sceneName: string | null;
  paragraphs: string[];
  words: number;
}

export interface AppearanceHost {
  current: () => AppearancePrefs;
  sample: () => SampleText;
  save: (prefs: AppearancePrefs) => void;
  /** Called when the panel closes (focus goes back to the manuscript). */
  onClose: () => void;
}

type Key = keyof AppearancePrefs;
interface Group<K extends Key> {
  key: K;
  label: string;
  options: [AppearancePrefs[K], string, string?][];
  cards?: boolean;
}

const GROUPS: Group<Key>[] = [
  { key: 'theme', label: 'Theme', cards: true, options: [
    ['dracula', 'Dracula'], ['dark', 'Dark'], ['light', 'Light'], ['grove', 'Grove'], ['contrast', 'High Contrast'],
  ] as [Theme, string][] },
  { key: 'proseFont', label: 'Prose font', options: [
    ['mono', 'Mono', 'IBM Plex Mono'], ['sans', 'Sans', 'IBM Plex Sans'], ['serif', 'Serif', 'IBM Plex Serif'],
  ] as [ProseFont, string, string][] },
  { key: 'fontSize', label: 'Font size', options: [
    ['small', 'Small', '14'], ['medium', 'Medium', '15'], ['large', 'Large', '17'], ['xlarge', 'Extra large', '19'],
  ] as [FontSize, string, string][] },
  { key: 'paragraphSpacing', label: 'Paragraph spacing', options: [
    ['full', 'Full line'], ['half', 'Half line'], ['none', 'None', 'Indent first lines'],
  ] as [ParagraphSpacing, string, string?][] },
  { key: 'proseWidth', label: 'Prose width', options: [
    ['narrow', 'Narrow', '~55 characters'], ['wide', 'Wide', '~70 characters'],
  ] as [ProseWidth, string, string][] },
];

const numberFormat = new Intl.NumberFormat();
const ATTRS: Record<Key, string> = { theme: 'theme', proseFont: 'proseFont', paragraphSpacing: 'paragraphSpacing', proseWidth: 'proseWidth', fontSize: 'fontSize' };

export class AppearancePanel {
  readonly el: HTMLElement;
  private readonly scrim: HTMLElement;
  private readonly sampleEl: HTMLElement;
  private pending: AppearancePrefs = { ...DEFAULT_APPEARANCE };

  constructor(host: HTMLElement, private readonly h: AppearanceHost) {
    this.scrim = document.createElement('div');
    this.scrim.className = 'bt-palette-scrim';
    this.el = document.createElement('div');
    this.el.className = 'bt-appearance';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'bt-appearance-title');
    this.el.dataset.open = 'false';
    this.el.innerHTML = `
      <header class="bt-appearance-head">
        <span class="bt-appearance-title" id="bt-appearance-title">Appearance</span>
        <button type="button" class="bt-appearance-link" data-action="reset">Reset to defaults</button>
      </header>
      <div class="bt-appearance-body">
        <div class="bt-appearance-controls">${GROUPS.map((g) => this.groupHTML(g)).join('')}</div>
        <section class="bt-appearance-preview" aria-label="Sample">
          <div class="bt-sample" aria-hidden="true"></div>
        </section>
      </div>
      <footer class="bt-appearance-foot">
        <button type="button" class="bt-appearance-button" data-action="cancel">Cancel</button>
        <button type="button" class="bt-appearance-button bt-appearance-primary" data-action="save">Save</button>
      </footer>`;
    host.append(this.scrim, this.el);
    this.sampleEl = this.el.querySelector('.bt-sample')!;

    this.scrim.addEventListener('mousedown', (e) => { e.preventDefault(); this.close(); });
    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const option = target.closest<HTMLElement>('[role="radio"]');
      if (option) { this.choose(option.dataset.key as Key, option.dataset.value!); return; }
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'save') this.save();
      else if (action === 'cancel') this.close();
      else if (action === 'reset') { this.pending = { ...DEFAULT_APPEARANCE }; this.reflect(); }
    });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return this.el.dataset.open === 'true';
  }

  /** The choices not yet saved (for tests). */
  get choices(): AppearancePrefs {
    return { ...this.pending };
  }

  open() {
    if (this.isOpen) return;
    this.pending = { ...this.h.current() };
    this.buildSample(this.h.sample());
    this.reflect();
    this.el.dataset.open = 'true';
    this.scrim.dataset.open = 'true';
    // Start on the theme that is in use.
    this.el.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
  }

  /** Close without saving. */
  close() {
    if (!this.isOpen) return;
    this.el.dataset.open = 'false';
    this.scrim.dataset.open = 'false';
    this.h.onClose();
  }

  private save() {
    this.h.save({ ...this.pending });
    this.close();
  }

  private choose(key: Key, value: string) {
    (this.pending as unknown as Record<string, string>)[key] = value;
    this.reflect();
  }

  /** Mark the chosen options and draw the sample with them. */
  private reflect() {
    for (const radio of this.el.querySelectorAll<HTMLElement>('[role="radio"]')) {
      const on = this.pending[radio.dataset.key as Key] === radio.dataset.value;
      radio.setAttribute('aria-checked', String(on));
      radio.tabIndex = on ? 0 : -1; // one tab stop per group
    }
    for (const key of Object.keys(ATTRS) as Key[]) this.sampleEl.dataset[ATTRS[key]] = this.pending[key];
  }

  private onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // Esc closes the panel, nothing else
      this.close();
      return;
    }
    if (e.key === 'Enter' && e.metaKey) { // ⌘↵ saves from anywhere in the panel
      e.preventDefault();
      this.save();
      return;
    }
    if (e.key === 'Tab') { this.trapTab(e); return; }
    const radio = (e.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
    if (!radio) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const radios = [...radio.closest('[role="radiogroup"]')!.querySelectorAll<HTMLElement>('[role="radio"]')];
    const next = radios[(radios.indexOf(radio) + step + radios.length) % radios.length]!;
    this.choose(next.dataset.key as Key, next.dataset.value!);
    next.focus();
  }

  /** Keep keyboard focus inside the dialog. */
  private trapTab(e: KeyboardEvent) {
    const stops = [...this.el.querySelectorAll<HTMLElement>('button')].filter((b) => b.tabIndex >= 0 && b.offsetParent !== null);
    if (!stops.length) return;
    const i = stops.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i === stops.length - 1 ? 0 : i + 1);
    e.preventDefault();
    stops[next]!.focus();
  }

  private groupHTML(g: Group<Key>): string {
    const id = `bt-appearance-${g.key}`;
    const options = g.options.map(([value, label, detail]) => g.cards
      ? `<button type="button" role="radio" class="bt-theme-card" data-key="${g.key}" data-value="${value}" aria-checked="false" data-theme="${value}">
           <span class="bt-theme-swatch" aria-hidden="true"><i class="t1"></i><i class="t2"></i><i class="t3"></i><i class="t4"></i></span>
           <span class="bt-theme-name">${label}</span>
         </button>`
      : `<button type="button" role="radio" class="bt-choice" data-key="${g.key}" data-value="${value}" aria-checked="false">
           <span class="bt-choice-label">${label}</span>${detail ? `<span class="bt-choice-detail">${detail}</span>` : ''}
         </button>`).join('');
    return `<div class="bt-appearance-group">
        <span class="bt-appearance-label" id="${id}">${g.label}</span>
        <div role="radiogroup" aria-labelledby="${id}" class="${g.cards ? 'bt-theme-cards' : 'bt-choices'}">${options}</div>
      </div>`;
  }

  /** A small Baretext: title bar, the writer's scene on its page, status bar. */
  private buildSample(s: SampleText) {
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const scene = s.sceneName ? `<h3 class="bt-sample-scene"><span class="bt-sample-num">${s.sceneLabel}</span>${esc(s.sceneName)}</h3>` : '';
    this.sampleEl.innerHTML = `
      <div class="bt-sample-titlebar"><span class="bt-sample-book">${esc(s.book || 'Untitled')}</span><span>Chapter ${s.chapterNumber}${s.chapterTitle ? ` · ${esc(s.chapterTitle)}` : ''}${s.sceneName ? ` · ${esc(s.sceneName)}` : ''}</span></div>
      <div class="bt-sample-page"><div class="bt-sample-column">
        <h2 class="bt-sample-chapter"><span class="bt-sample-num">${s.chapterNumber}</span>${esc(s.chapterTitle || 'Untitled')}</h2>
        ${scene}
        ${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}
      </div></div>
      <div class="bt-sample-status"><span><span class="bt-num-text">${numberFormat.format(s.words)}</span> words</span></div>`;
  }
}
