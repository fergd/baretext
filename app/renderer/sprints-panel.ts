// The Sprints library (DECISIONS §21): sprints kept on their own, newest
// first, each read in full beside the list. One can go into the book (the
// same chooser as at a sprint's end) or be discarded (asks twice). Built from
// the History panel's parts so the two read as one family.

import type { Block, Run } from '@baretext/format';
import type { BaretextBridge, SprintSummary } from '../shared/bridge';
import { Arming } from './arming';
import { Modal } from './modal';
import { sprintLength, sprintStart } from './sprint-setup';
import { numberFormat } from './dom';


export interface SprintsHost {
  bridge: BaretextBridge;
  /** Ask where the sprint goes in the book (the panel has closed; reopen it to go back). */
  place(sprint: SprintSummary, blocks: Block[]): void;
  /** Resolves true once the sprint is recorded as discarded. */
  discard(sprint: SprintSummary): Promise<boolean>;
  onClose(): void;
}

export class SprintsPanel {
  private readonly modal: Modal;
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly head: HTMLElement;
  private readonly text: HTMLElement;
  private entries: SprintSummary[] = [];
  private selected = -1;
  private blocks: Block[] | null = null;
  private loadToken = 0;
  /** Discard waiting for its confirmation (the selected sprint's id). */
  private readonly arming = new Arming<string>((armed) => {
    const button = this.head.querySelector<HTMLButtonElement>('[data-action="discard"]');
    if (!button) return;
    button.dataset.armed = String(!!armed);
    button.textContent = armed ? 'Discard for good' : 'Discard';
  });

  constructor(host: HTMLElement, private readonly h: SprintsHost) {
    this.modal = new Modal(host, { className: 'bt-sprints', label: 'Sprints', onDismiss: () => this.close() });
    this.el = this.modal.el;
    this.el.innerHTML = `
      <header class="bt-history-head">
        <span class="bt-history-title">Sprints</span>
        <button type="button" class="bt-history-close" aria-label="Close" title="Close  Esc">×</button>
      </header>
      <div class="bt-history-body">
        <div class="bt-history-list" role="listbox" aria-label="Kept sprints" tabindex="0"></div>
        <section class="bt-history-preview">
          <div class="bt-history-preview-head"></div>
          <div class="bt-history-preview-text" tabindex="-1"></div>
        </section>
      </div>`;
    this.list = this.el.querySelector('.bt-history-list')!;
    this.head = this.el.querySelector('.bt-history-preview-head')!;
    this.text = this.el.querySelector('.bt-history-preview-text')!;

    this.el.querySelector('.bt-history-close')!.addEventListener('click', () => this.close());
    this.list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
      if (row) void this.select(Number(row.dataset.index));
    });
    this.head.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'place') this.place();
      else if (action === 'discard') void this.discard();
    });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  /** Open the library, on the sprint `selectId` when given (else the newest). */
  async open(selectId?: string) {
    this.modal.show();
    this.list.focus();
    this.entries = await this.h.bridge.keptSprints();
    this.renderList();
    const at = Math.max(0, this.entries.findIndex((s) => s.record.id === selectId));
    if (this.entries.length) await this.select(at);
    else this.showEmpty();
  }

  close() {
    if (!this.isOpen) return;
    this.hide();
    this.h.onClose();
  }

  /** Close without handing focus back (another panel takes over). */
  private hide() {
    this.arming.disarm();
    this.modal.hide();
    this.loadToken++;
  }

  private showEmpty() {
    this.selected = -1;
    this.blocks = null;
    this.head.replaceChildren();
    this.text.replaceChildren(Object.assign(document.createElement('p'), { className: 'bt-history-empty', textContent: 'No sprints kept yet.' }));
  }

  private renderList() {
    this.list.replaceChildren(...this.entries.map((s, i) => {
      const row = document.createElement('div');
      row.className = 'bt-history-row';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.id = `bt-sprints-${i}`;
      row.dataset.index = String(i);
      const opening = document.createElement('div');
      opening.className = 'bt-sprints-opening';
      opening.textContent = s.opening || '—';
      const meta = document.createElement('div');
      meta.className = 'bt-history-meta';
      const when = document.createElement('span');
      when.className = 'bt-history-what';
      when.textContent = sprintStart(s.record.started);
      const words = document.createElement('span');
      words.className = 'bt-history-words';
      words.textContent = `${numberFormat.format(s.record.words)} words`;
      meta.append(when, words);
      row.append(opening, meta);
      return row;
    }));
  }

  private async select(i: number) {
    const s = this.entries[i];
    if (!s) return;
    this.arming.disarm();
    this.list.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    const row = this.list.children[i] as HTMLElement;
    row.setAttribute('aria-selected', 'true');
    this.list.setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView({ block: 'nearest' });
    this.selected = i;
    this.blocks = null;

    const info = document.createElement('span');
    info.className = 'bt-history-vs';
    info.textContent = `${sprintStart(s.record.started)} · ${sprintLength(s.record.prefs)}`;
    const discard = Object.assign(document.createElement('button'), { type: 'button', className: 'bt-history-button bt-sprints-discard', textContent: 'Discard' });
    discard.dataset.action = 'discard';
    const place = Object.assign(document.createElement('button'), { type: 'button', className: 'bt-history-button bt-history-restore', textContent: 'Add to book…', disabled: true });
    place.dataset.action = 'place';
    const actions = document.createElement('span');
    actions.className = 'bt-sprints-actions';
    actions.append(discard, place);
    this.head.replaceChildren(info, actions);

    const token = ++this.loadToken;
    let blocks: Block[];
    try {
      blocks = await this.h.bridge.readSprint(s.record.id);
    } catch {
      if (token !== this.loadToken) return;
      this.text.replaceChildren(Object.assign(document.createElement('p'), { className: 'bt-history-empty', textContent: 'This sprint can’t be read right now. It’s kept safe; try again later.' }));
      return;
    }
    if (token !== this.loadToken) return; // a newer selection won
    this.blocks = blocks;
    place.disabled = !blocks.length;
    this.renderText(blocks);
  }

  /** The sprint's writing, read-only, as written (bold and italic kept). */
  private renderText(blocks: Block[]) {
    const out: HTMLElement[] = [];
    const paragraph = (runs: Run[], cls: string) => {
      const p = document.createElement('p');
      p.className = cls;
      p.append(...runs.map((r) => {
        let node: Node = document.createTextNode(r.text);
        if (r.italic) { const em = document.createElement('em'); em.append(node); node = em; }
        if (r.bold) { const strong = document.createElement('strong'); strong.append(node); node = strong; }
        return node;
      }));
      out.push(p);
    };
    for (const b of blocks) {
      if (b.type === 'paragraph') paragraph(b.content, 'bt-hp-p');
      else if (b.type === 'quote') for (const q of b.paragraphs) paragraph(q, 'bt-hp-p bt-hp-quote');
      else out.push(Object.assign(document.createElement('div'), { className: 'bt-hp-pause' }));
    }
    this.text.replaceChildren(...out);
    this.text.scrollTop = 0;
  }

  private place() {
    const s = this.entries[this.selected];
    if (!s || !this.blocks?.length) return;
    const blocks = this.blocks;
    this.hide();
    this.h.place(s, blocks);
  }

  // ── Discard: the first press arms it; a second, within a few seconds, discards ──

  private async discard() {
    const s = this.entries[this.selected];
    if (!s || !this.arming.press(s.record.id, (t) => !!t.closest('.bt-sprints [data-action="discard"]'))) return;
    if (!(await this.h.discard(s))) return;
    this.entries.splice(this.selected, 1);
    this.renderList();
    if (this.entries.length) await this.select(Math.min(this.selected, this.entries.length - 1));
    else this.showEmpty();
    this.list.focus();
  }

  private onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if ((e.target as HTMLElement).closest('button')) return; // buttons keep their own keys
    const n = this.entries.length;
    if (!n) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); void this.select(Math.min(this.selected + 1, n - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); void this.select(Math.max(this.selected - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); void this.select(0); }
    else if (e.key === 'End') { e.preventDefault(); void this.select(n - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); this.place(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); void this.discard(); }
    else if (this.arming.key && !['Shift', 'Meta', 'Alt', 'Control'].includes(e.key)) this.arming.disarm();
  }
}
