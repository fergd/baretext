// History (DECISIONS §6): the manuscript's local snapshots, a read-only
// preview, and Restore. Restoring snapshots the current version first and
// is one undoable step, so it needs no confirmation.

import type { Manuscript } from '@baretext/format';
import type { BaretextBridge, SnapshotInfo } from '../shared/bridge';
import { Modal } from './modal';
import { numberFormat } from './dom';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function when(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const day = d.toDateString() === today.toDateString() ? 'Today'
    : d.toDateString() === yesterday.toDateString() ? 'Yesterday' : dateFormat.format(d);
  return `${day}, ${timeFormat.format(d)}`;
}

const signed = (n: number) => (n > 0 ? `+${numberFormat.format(n)}` : n < 0 ? `−${numberFormat.format(-n)}` : '±0');

export interface HistoryHost {
  bridge: BaretextBridge;
  filePath: () => string | null;
  /** The manuscript as it is in the window now. */
  current: () => Manuscript | null;
  currentWords: () => number;
  /** Replace the manuscript with `m` (one undoable step). */
  restore: (m: Manuscript, from: SnapshotInfo) => void;
  /** Called when the panel closes (focus goes back to the manuscript). */
  onClose: () => void;
}

export class HistoryPanel {
  private readonly modal: Modal;
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly previewHead: HTMLElement;
  private readonly label: HTMLInputElement;
  private entries: SnapshotInfo[] = [];
  private selected = -1;
  private loadToken = 0;

  constructor(host: HTMLElement, private readonly h: HistoryHost) {
    this.modal = new Modal(host, { className: 'bt-history', label: 'History', onDismiss: () => this.close() });
    this.el = this.modal.el;
    this.el.innerHTML = `
      <header class="bt-history-head">
        <span class="bt-history-title">History</span>
        <form class="bt-history-save">
          <input class="bt-history-label bt-field bt-field-quiet" type="text" placeholder="Label (optional)" aria-label="Snapshot label" spellcheck="false" autocomplete="off">
          <button type="submit" class="bt-history-button">Save snapshot</button>
        </form>
        <button type="button" class="bt-history-close" aria-label="Close" title="Close  Esc">×</button>
      </header>
      <div class="bt-history-body">
        <div class="bt-history-list" role="listbox" aria-label="Versions" tabindex="0"></div>
        <section class="bt-history-preview">
          <div class="bt-history-preview-head"></div>
          <div class="bt-history-preview-text" tabindex="-1"></div>
        </section>
      </div>`;
    this.list = this.el.querySelector('.bt-history-list')!;
    this.preview = this.el.querySelector('.bt-history-preview-text')!;
    this.previewHead = this.el.querySelector('.bt-history-preview-head')!;
    this.label = this.el.querySelector('.bt-history-label')!;

    this.el.querySelector('.bt-history-close')!.addEventListener('click', () => this.close());
    this.el.querySelector('form')!.addEventListener('submit', (e) => { e.preventDefault(); void this.saveSnapshot(); });
    this.list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
      if (row) void this.select(Number(row.dataset.index));
    });
    this.previewHead.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-action="restore"]')) void this.restoreSelected();
    });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  /** Open the panel; with `labelFirst`, the caret goes to the snapshot label field. */
  async open(labelFirst = false) {
    this.modal.show();
    this.label.value = '';
    if (labelFirst) this.label.focus(); else this.list.focus();
    await this.reload(0);
  }

  close() {
    if (!this.isOpen) return;
    this.modal.hide();
    this.loadToken++;
    this.preview.replaceChildren();
    this.h.onClose();
  }

  private async reload(select: number) {
    const file = this.h.filePath();
    this.entries = file ? await this.h.bridge.listSnapshots(file) : [];
    this.renderList();
    if (this.entries.length) await this.select(Math.min(select, this.entries.length - 1));
    else {
      this.previewHead.textContent = '';
      this.preview.replaceChildren(Object.assign(document.createElement('p'), {
        className: 'bt-history-empty', textContent: 'No snapshots yet. They are taken as you write, once a day, and whenever you save one here.',
      }));
    }
  }

  private renderList() {
    this.list.replaceChildren(...this.entries.map((e, i) => {
      const row = document.createElement('div');
      row.className = 'bt-history-row';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.id = `bt-history-${i}`;
      row.dataset.index = String(i);
      row.dataset.kind = e.kind;
      const older = this.entries[i + 1];
      const top = document.createElement('div');
      top.className = 'bt-history-when';
      top.textContent = when(e.time);
      const bottom = document.createElement('div');
      bottom.className = 'bt-history-meta';
      const what = document.createElement('span');
      what.className = 'bt-history-what';
      what.textContent = e.label || e.reason;
      const words = document.createElement('span');
      words.className = 'bt-history-words';
      words.textContent = `${numberFormat.format(e.words)} words${older ? `  ${signed(e.words - older.words)}` : ''}`;
      bottom.append(what, words);
      row.append(top, bottom);
      return row;
    }));
  }

  private async select(i: number) {
    const e = this.entries[i];
    const file = this.h.filePath();
    if (!e || !file) return;
    this.list.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    const row = this.list.children[i] as HTMLElement;
    row.setAttribute('aria-selected', 'true');
    this.list.setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView({ block: 'nearest' });
    this.selected = i;

    const vsNow = e.words - this.h.currentWords();
    this.previewHead.innerHTML = '';
    const info = document.createElement('span');
    info.className = 'bt-history-vs';
    info.textContent = `${when(e.time)} · ${numberFormat.format(e.words)} words · ${vsNow === 0 ? 'same length as now' : `${signed(vsNow)} vs now`}`;
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'bt-history-button bt-history-restore';
    restore.dataset.action = 'restore';
    restore.textContent = 'Restore this version';
    this.previewHead.append(info, restore);

    const token = ++this.loadToken;
    let m: Manuscript;
    try {
      m = await this.h.bridge.readSnapshot(file, e.id);
    } catch (err) {
      if (token !== this.loadToken) return;
      this.preview.replaceChildren(Object.assign(document.createElement('p'), {
        className: 'bt-history-empty', textContent: `This version can’t be read: ${(err as Error).message}`,
      }));
      return;
    }
    if (token !== this.loadToken) return; // a newer selection won
    this.renderPreview(m);
  }

  /** Read-only text of the version: titles, scene names, prose. */
  private renderPreview(m: Manuscript) {
    const out: HTMLElement[] = [];
    const add = (tag: string, cls: string, text: string) => {
      const el = document.createElement(tag);
      el.className = cls;
      el.textContent = text;
      out.push(el);
    };
    add('h1', 'bt-hp-book', m.title || 'Untitled');
    m.chapters.forEach((c, ci) => {
      add('h2', 'bt-hp-chapter', `${ci + 1}  ${c.title || 'Untitled'}`);
      c.scenes.forEach((s, si) => {
        if (s.name !== null) add('h3', 'bt-hp-scene', `${ci + 1}.${si + 1}  ${s.name || 'Untitled'}`);
        else if (si > 0) add('div', 'bt-hp-break', '');
        for (const b of s.blocks) {
          if (b.type === 'paragraph') add('p', 'bt-hp-p', b.content.map((r) => r.text).join(''));
          else if (b.type === 'quote') for (const p of b.paragraphs) add('p', 'bt-hp-p bt-hp-quote', p.map((r) => r.text).join(''));
          else add('div', 'bt-hp-pause', '');
        }
      });
    });
    this.preview.replaceChildren(...out);
    this.preview.scrollTop = 0;
  }

  private async restoreSelected() {
    const e = this.entries[this.selected];
    const file = this.h.filePath();
    const now = this.h.current();
    const button = this.previewHead.querySelector<HTMLButtonElement>('[data-action="restore"]');
    if (!e || !file || !now || button?.disabled) return;
    if (button) button.disabled = true; // one restore per click
    try {
      // Keep what is here now before replacing it.
      await this.h.bridge.takeSnapshot(file, now, 'point', 'Before restore');
      const m = await this.h.bridge.readSnapshot(file, e.id);
      this.close();
      this.h.restore(m, e);
    } catch (err) {
      if (button) button.disabled = false;
      const info = this.previewHead.querySelector('.bt-history-vs');
      if (info) info.textContent = `Couldn’t restore this version: ${(err as Error).message} Nothing was changed.`;
    }
  }

  private async saveSnapshot() {
    const file = this.h.filePath();
    const now = this.h.current();
    if (!file || !now) return;
    await this.h.bridge.takeSnapshot(file, now, 'manual', 'Saved snapshot', this.label.value);
    this.label.value = '';
    this.list.focus();
    await this.reload(0);
  }

  private onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.target === this.label) return;
    const n = this.entries.length;
    if (!n) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); void this.select(Math.min(this.selected + 1, n - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); void this.select(Math.max(this.selected - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); void this.select(0); }
    else if (e.key === 'End') { e.preventDefault(); void this.select(n - 1); }
  }
}
