// Ending a sprint (DECISIONS §21): where does its writing go? Into the book
// as a new scene (at the end of a chapter, or of the book), into Cold
// Storage, kept in Sprints, or discarded. Nothing is chosen for the writer;
// Discard asks twice. Esc (or Keep writing) goes back to the page.

export type KeepChoice = 'chapter' | 'end' | 'cold' | 'sprints' | 'discard';

export interface KeepChapter {
  id: string;
  label: string;
}

export interface SprintKeepHost {
  /** The book's chapters, and the one the caret was in. */
  chapters(): { list: KeepChapter[]; current: string | null };
  /** Resolves true when the choice was carried out (the panel then closes). */
  choose(choice: KeepChoice, chapterId: string | null): Promise<boolean>;
  keepWriting(): void;
}

const numberFormat = new Intl.NumberFormat();

const OPTIONS: [KeepChoice, string][] = [
  ['chapter', 'End of chapter'],
  ['end', 'End of book'],
  ['cold', 'Cold Storage'],
  ['sprints', 'Sprints'],
  ['discard', 'Discard'],
];

export class SprintKeep {
  readonly el: HTMLElement;
  private readonly scrim: HTMLElement;
  private readonly select: HTMLSelectElement;
  private choice: KeepChoice | null = null;
  private armed = false;
  private busy = false;

  constructor(host: HTMLElement, private readonly h: SprintKeepHost) {
    this.scrim = document.createElement('div');
    this.scrim.className = 'bt-palette-scrim';
    this.el = document.createElement('div');
    this.el.className = 'bt-appearance bt-sprint bt-keep';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'bt-keep-title');
    this.el.dataset.open = 'false';
    this.el.innerHTML = `
      <header class="bt-appearance-head">
        <span class="bt-appearance-title" id="bt-keep-title">Keep this sprint?</span>
        <span class="bt-keep-words"></span>
      </header>
      <div class="bt-sprint-body">
        <div role="radiogroup" aria-labelledby="bt-keep-title" class="bt-keep-options">${OPTIONS.map(([value, label]) => `
          <div class="bt-keep-option" data-value="${value}">
            <button type="button" role="radio" class="bt-keep-radio" data-value="${value}" aria-checked="false"><span class="bt-keep-dot" aria-hidden="true"></span>${label}</button>
            ${value === 'chapter' ? '<select class="bt-keep-select" aria-label="Chapter"></select>' : value === 'end' ? '<span class="bt-keep-detail" data-detail="end"></span>' : ''}
          </div>`).join('')}
        </div>
      </div>
      <footer class="bt-appearance-foot">
        <button type="button" class="bt-appearance-button bt-sprint-button bt-keep-back" data-action="back">Keep writing<kbd>esc</kbd></button>
        <button type="button" class="bt-appearance-button bt-appearance-primary bt-sprint-button" data-action="done" disabled>Done<kbd>↵</kbd></button>
      </footer>`;
    host.append(this.scrim, this.el);
    this.select = this.el.querySelector('.bt-keep-select')!;

    this.scrim.addEventListener('mousedown', (e) => { e.preventDefault(); this.back(); });
    this.select.addEventListener('change', () => { this.pick('chapter'); });
    this.select.addEventListener('mousedown', () => { if (this.choice !== 'chapter') this.pick('chapter'); });
    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const radio = target.closest<HTMLElement>('[role="radio"]');
      if (radio) { this.pick(radio.dataset.value as KeepChoice); return; }
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'done') void this.done();
      else if (action === 'back') this.back();
    });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return this.el.dataset.open === 'true';
  }

  open(words: number) {
    const { list, current } = this.h.chapters();
    this.select.replaceChildren(...list.map((c) => new Option(c.label, c.id, false, c.id === current)));
    this.el.querySelector('[data-detail="end"]')!.textContent = list.at(-1)?.label ?? '';
    this.el.querySelector('.bt-keep-words')!.textContent = `${numberFormat.format(words)} ${words === 1 ? 'word' : 'words'}`;
    this.choice = null;
    this.armed = false;
    this.reflect();
    this.el.dataset.open = 'true';
    this.scrim.dataset.open = 'true';
    this.el.querySelector<HTMLElement>('[role="radio"]')!.focus();
  }

  close() {
    this.el.dataset.open = 'false';
    this.scrim.dataset.open = 'false';
  }

  private back() {
    if (this.busy) return;
    this.close();
    this.h.keepWriting();
  }

  private pick(choice: KeepChoice) {
    if (this.choice !== choice) this.armed = false;
    this.choice = choice;
    this.reflect();
  }

  private async done() {
    if (!this.choice || this.busy) return;
    // Discarding asks twice: the first press arms it.
    if (this.choice === 'discard' && !this.armed) { this.armed = true; this.reflect(); return; }
    this.busy = true;
    try {
      if (await this.h.choose(this.choice, this.choice === 'chapter' ? this.select.value : null)) this.close();
    } finally {
      this.busy = false;
    }
  }

  private reflect() {
    const radios = [...this.el.querySelectorAll<HTMLElement>('[role="radio"]')];
    for (const r of radios) {
      const on = r.dataset.value === this.choice;
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on || (!this.choice && r === radios[0]) ? 0 : -1;
    }
    this.el.dataset.choice = this.choice ?? '';
    const done = this.el.querySelector<HTMLButtonElement>('[data-action="done"]')!;
    done.disabled = !this.choice;
    done.dataset.danger = String(this.choice === 'discard');
    done.firstChild!.textContent = this.choice === 'discard' ? (this.armed ? 'Discard for good' : 'Discard') : 'Done';
  }

  private onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    const target = e.target as HTMLElement;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.back(); return; }
    if (e.key === 'Enter') {
      if (target.closest('[data-action="back"]') || target === this.select) return;
      e.preventDefault();
      void this.done();
      return;
    }
    if (e.key === 'Tab') { this.trapTab(e); return; }
    const radio = target.closest<HTMLElement>('[role="radio"]');
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!radio || !step) return;
    e.preventDefault();
    const radios = [...this.el.querySelectorAll<HTMLElement>('[role="radio"]')];
    const next = radios[(radios.indexOf(radio) + step + radios.length) % radios.length]!;
    this.pick(next.dataset.value as KeepChoice);
    next.focus();
  }

  private trapTab(e: KeyboardEvent) {
    const stops = [...this.el.querySelectorAll<HTMLElement>('button, select')].filter((b) => b.tabIndex >= 0 && b.offsetParent !== null && !(b as HTMLButtonElement).disabled);
    if (!stops.length) return;
    const i = stops.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i === stops.length - 1 ? 0 : i + 1);
    e.preventDefault();
    stops[next]!.focus();
  }
}
