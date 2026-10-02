// Sprint setup (spec §5): what to sprint for (a time or a word count), and
// the session around it (rounds, breaks). Enter starts; Esc cancels.
// Remembers the last choices. Built from the Appearance panel's parts.

import { SPRINT_LIMITS, type SprintKind, type SprintPrefs } from '../shared/bridge';
import { arrowStep, Modal } from './modal';
import { numberFormat } from './dom';

export interface SprintSetupHost {
  current(): SprintPrefs;
  start(prefs: SprintPrefs): void;
  onClose(): void;
}

const PRESETS: Record<SprintKind, number[]> = {
  time: [10, 15, 20, 25, 30],
  words: [250, 500, 750, 1000, 1500],
};
const ROUNDS = [1, 2, 3, 4];
const BREAKS = [0, 5, 10];

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** The footer line: the session at a glance. */
export function sprintSummary(p: SprintPrefs, now: Date): string {
  if (p.kind === 'words') return p.rounds > 1 ? `${p.rounds} × ${numberFormat.format(p.words)} words` : '';
  const total = p.rounds * p.minutes + (p.rounds - 1) * p.breakMinutes;
  const ends = `ends ${timeFormat.format(new Date(now.getTime() + total * 60_000))}`;
  return p.rounds > 1 ? `${p.rounds} × ${p.minutes} min · ${ends}` : ends.replace(/^e/, 'E');
}

const startFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** What a sprint was: "15 min", or "500 words". */
export const sprintLength = (p: SprintPrefs) => (p.kind === 'time' ? `${p.minutes} min` : `${numberFormat.format(p.words)} words`);

/** When a sprint started: "Oct 2, 7:58 AM". */
export const sprintStart = (started: number) => startFormat.format(new Date(started));

/** A sprint's name where it needs one (in Cold Storage): what it was, and when it started. */
export const sprintName = (p: SprintPrefs, started: number) => `Sprint · ${sprintLength(p)} · ${sprintStart(started)}`;

const seg = (group: string, values: number[], label: (v: number) => string) => values.map((v) =>
  `<button type="button" role="radio" class="bt-seg-item" data-group="${group}" data-value="${v}" aria-checked="false">${label(v)}</button>`).join('');

export class SprintSetup {
  private readonly modal: Modal;
  readonly el: HTMLElement;
  private readonly custom: HTMLInputElement;
  private pending: SprintPrefs = { kind: 'time', minutes: 15, words: 500, rounds: 1, breakMinutes: 5 };

  constructor(host: HTMLElement, private readonly h: SprintSetupHost) {
    this.modal = new Modal(host, { className: 'bt-appearance bt-sprint bt-sprint-setup', labelledBy: 'bt-sprint-title', onDismiss: () => this.close() });
    this.el = this.modal.el;
    this.el.innerHTML = `
      <header class="bt-appearance-head">
        <span class="bt-appearance-title" id="bt-sprint-title">Sprint</span>
        <div role="radiogroup" aria-label="Sprint for" class="bt-seg bt-sprint-kind">
          <button type="button" role="radio" class="bt-seg-item" data-group="kind" data-value="time" aria-checked="false">Time</button>
          <button type="button" role="radio" class="bt-seg-item" data-group="kind" data-value="words" aria-checked="false">Words</button>
        </div>
      </header>
      <div class="bt-sprint-body">
        <div class="bt-sprint-length">
          <div role="radiogroup" aria-labelledby="bt-sprint-unit" class="bt-sprint-presets"></div>
          <input type="text" class="bt-sprint-custom" inputmode="numeric" placeholder="Custom" spellcheck="false" autocomplete="off" aria-label="Custom length">
          <span class="bt-sprint-unit" id="bt-sprint-unit"></span>
        </div>
        <div class="bt-sprint-row">
          <span class="bt-sprint-label" id="bt-sprint-rounds">Rounds</span>
          <div role="radiogroup" aria-labelledby="bt-sprint-rounds" class="bt-seg">${seg('rounds', ROUNDS, String)}</div>
        </div>
        <div class="bt-sprint-row" data-row="break">
          <span class="bt-sprint-label" id="bt-sprint-break">Break</span>
          <div role="radiogroup" aria-labelledby="bt-sprint-break" class="bt-seg">${seg('breakMinutes', BREAKS, (v) => (v ? `${v} min` : 'Off'))}</div>
        </div>
      </div>
      <footer class="bt-appearance-foot">
        <span class="bt-sprint-summary"></span>
        <button type="button" class="bt-appearance-button bt-sprint-button" data-action="cancel">Cancel<kbd>esc</kbd></button>
        <button type="button" class="bt-appearance-button bt-appearance-primary bt-sprint-button" data-action="start">Start<kbd>↵</kbd></button>
      </footer>`;
    this.custom = this.el.querySelector('.bt-sprint-custom')!;

    this.custom.addEventListener('input', () => {
      const n = this.parse(this.custom, this.pending.kind === 'time' ? 'minutes' : 'words');
      if (n !== null) this.setLength(n);
      this.reflect();
    });
    this.custom.addEventListener('blur', () => this.reflect());
    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const radio = target.closest<HTMLButtonElement>('[role="radio"]');
      if (radio && !radio.disabled) { this.choose(radio); return; }
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'start') this.start();
      else if (action === 'cancel') this.close();
    });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  open() {
    if (this.isOpen) return;
    this.pending = { ...this.h.current() };
    this.custom.value = '';
    this.reflect();
    this.modal.show();
    (this.el.querySelector<HTMLElement>('.bt-sprint-presets [aria-checked="true"]') ?? this.custom).focus();
  }

  close() {
    if (!this.isOpen) return;
    this.modal.hide();
    this.h.onClose();
  }

  private start() {
    const p = { ...this.pending };
    this.modal.hide();
    this.h.start(p);
  }

  private get length(): number {
    return this.pending.kind === 'time' ? this.pending.minutes : this.pending.words;
  }

  private setLength(n: number) {
    if (this.pending.kind === 'time') this.pending.minutes = n;
    else this.pending.words = n;
  }

  /** A whole number within the field's limits, or null. */
  private parse(input: HTMLInputElement, key: 'minutes' | 'words'): number | null {
    const n = Number(input.value.replace(/[^\d]/g, ''));
    const [min, max] = SPRINT_LIMITS[key];
    return input.value.trim() && Number.isInteger(n) && n >= min && n <= max ? n : null;
  }

  private choose(radio: HTMLElement) {
    const value = radio.dataset.value!;
    switch (radio.dataset.group) {
      case 'kind': this.pending.kind = value as SprintKind; this.custom.value = ''; break;
      case 'length': this.setLength(Number(value)); this.custom.value = ''; break;
      case 'rounds': this.pending.rounds = Number(value); break;
      case 'breakMinutes': this.pending.breakMinutes = Number(value); break;
    }
    this.reflect();
  }

  private reflect() {
    const p = this.pending;
    const presets = PRESETS[p.kind];
    const list = this.el.querySelector<HTMLElement>('.bt-sprint-presets')!;
    if (list.dataset.kind !== p.kind) {
      list.dataset.kind = p.kind;
      list.innerHTML = seg('length', presets, (v) => numberFormat.format(v));
    }
    this.el.dataset.kind = p.kind;
    this.el.querySelector('.bt-sprint-unit')!.textContent = p.kind === 'time' ? 'Minutes' : 'Words';
    const custom = !presets.includes(this.length);
    this.custom.dataset.active = String(custom);
    if (custom && document.activeElement !== this.custom) this.custom.value = numberFormat.format(this.length);

    const values: Record<string, number | string> = { kind: p.kind, length: custom ? NaN : this.length, rounds: p.rounds, breakMinutes: p.breakMinutes };
    for (const group of this.el.querySelectorAll<HTMLElement>('[role="radiogroup"]')) {
      const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
      const on = radios.find((r) => String(values[r.dataset.group!]) === r.dataset.value);
      for (const r of radios) {
        r.setAttribute('aria-checked', String(r === on));
        r.tabIndex = r === (on ?? radios[0]) ? 0 : -1;
      }
    }
    const single = p.rounds === 1;
    const breakRow = this.el.querySelector<HTMLElement>('[data-row="break"]')!;
    breakRow.dataset.disabled = String(single);
    for (const b of breakRow.querySelectorAll<HTMLButtonElement>('button')) b.disabled = single;
    this.el.querySelector('.bt-sprint-summary')!.textContent = sprintSummary(p, new Date());
  }

  private onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    const target = e.target as HTMLElement;
    if (e.key === 'Enter') {
      if (target.closest('[data-action="cancel"]')) return;
      e.preventDefault();
      this.start();
      return;
    }
    const radio = target.closest<HTMLButtonElement>('[role="radio"]');
    const next = radio && arrowStep(e, [...radio.closest('[role="radiogroup"]')!.querySelectorAll<HTMLButtonElement>('[role="radio"]')], radio);
    if (!radio || !next) return;
    this.choose(next);
    // The kind switch rebuilds the presets; focus follows the choice.
    (radio.dataset.group === 'kind' ? this.el.querySelector<HTMLElement>(`[data-group="kind"][data-value="${next.dataset.value}"]`)! : next).focus();
  }
}
