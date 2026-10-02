// The notes panel (spec §9, DECISIONS §16): a column on the right with every
// note — general notes (about the book, not a passage) first, then notes on
// passages in manuscript order — each editable in place. Resolved notes are
// hidden until "Show resolved"; there they can be reopened or deleted (two
// steps). Opened only deliberately: the title-bar button, ⇧⌘N, or a note's
// marker when the margin has no room for cards.

import type { EditorView } from 'prosemirror-view';
import { anchorsIn } from '@baretext/editor';
import type { Note } from '../shared/notes';
import type { NotesStore } from './notes-store';
import { outlineOf } from './outline';
import { PLUS } from './icons';
import { NoteBody } from './note-body';
import { slideColumn, type Motion } from './sidebar-motion';

const ARM_MS = 4000;

export interface NotesPanelHost {
  view(): EditorView | null;
  store: NotesStore;
  /** Go to a note's passage (and make it the active note). */
  show(id: string): void;
  /** Delete a note and its anchor. */
  remove(id: string): void;
  toEditor(): void;
  onPresence(open: boolean): void;
}

interface Place { label: string; order: number; lost: boolean }

export class NotesPanel {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly count: HTMLElement;
  private showResolved = false;
  private armed: { id: string; timer: number } | null = null;
  private frame = 0;
  private readonly bodies = new Map<string, NoteBody>();
  isOpen = false;

  constructor(host: HTMLElement, private readonly h: NotesPanelHost) {
    this.el = document.createElement('aside');
    this.el.className = 'bt-notes-panel';
    this.el.setAttribute('aria-label', 'Notes');
    this.el.dataset.open = 'false';
    this.el.innerHTML = `
      <div class="bt-notes-head">
        <span class="bt-notes-title">Notes</span>
        <span class="bt-notes-count"></span>
        <button type="button" class="bt-notes-new" data-action="new" title="New general note">${PLUS}<span>New note</span></button>
      </div>
      <div class="bt-notes-list"></div>
      <div class="bt-notes-foot"><button type="button" class="bt-notes-toggle" data-action="resolved" aria-pressed="false"></button></div>`;
    this.list = this.el.querySelector('.bt-notes-list')!;
    this.count = this.el.querySelector('.bt-notes-count')!;
    host.append(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); this.h.toEditor(); }
    });
    h.store.onChange(() => this.refresh());
  }

  setOpen(open: boolean) {
    if (open === this.isOpen) return;
    this.isOpen = open;
    this.el.dataset.open = String(open);
    if (open) this.render();
    else if (this.el.contains(document.activeElement)) this.h.toEditor();
    this.h.onPresence(open);
  }

  /** Slide in from the right edge, the cards in view following (as the outline does). */
  motion(open: boolean, m: Motion) {
    slideColumn(this.el, 'right', open, m, () => [...this.list.querySelectorAll<HTMLElement>('.bt-notes-section, .bt-notes-card, .bt-notes-empty')], this.list);
  }

  /** Open the panel on one note: a new one ready to write; a saved one shown (the caret stays put). */
  focusNote(id: string) {
    const note = this.h.store.get(id);
    if (note?.resolved) this.showResolved = true;
    this.setOpen(true);
    this.render();
    const card = this.list.querySelector<HTMLElement>(`[data-note="${CSS.escape(id)}"]`);
    card?.scrollIntoView({ block: 'nearest' });
    if (note && !note.body) this.bodies.get(id)?.focus();
  }

  /** A new general note, ready to type. */
  newGeneral() {
    const note = this.h.store.create(null);
    this.focusNote(note.id);
  }

  refresh() {
    if (!this.isOpen || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }

  /** Where each anchored note is: "2.3 Name", "Cold Storage", or that its passage was deleted. */
  private places(): Map<string, Place> {
    const view = this.h.view();
    const out = new Map<string, Place>();
    if (!view) return out;
    const outline = outlineOf(view.state.doc);
    const anchors = anchorsIn(view.state.doc);
    const scenes = new Map(outline.chapters.flatMap((c) => c.scenes).map((s, i) => [s.id, { s, i }]));
    for (const note of this.h.store.all) {
      if (!note.anchor) continue;
      const a = anchors.get(note.id);
      if (!a) { out.set(note.id, { label: 'Passage deleted', order: Number.MAX_SAFE_INTEGER, lost: true }); continue; }
      const sc = scenes.get(a.scene);
      const parked = outline.parked.find((p) => p.id === a.scene);
      out.set(note.id, sc
        ? { label: `${sc.s.label}${sc.s.name ? ` ${sc.s.name}` : ''}`, order: a.from, lost: false }
        : { label: `Cold Storage${parked?.name ? ` · ${parked.name}` : ''}`, order: Number.MAX_SAFE_INTEGER - 1, lost: false });
    }
    return out;
  }

  private render() {
    // Never rebuild under the writer's typing.
    if ([...this.bodies.values()].some((b) => b.isEditing && b.el.contains(document.activeElement))) {
      this.updateCounts();
      return;
    }
    this.bodies.clear();
    const places = this.places();
    const notes = this.h.store.all;
    const open = notes.filter((n) => !n.resolved);
    const general = open.filter((n) => !n.anchor);
    const anchored = open.filter((n) => n.anchor).sort((a, b) => places.get(a.id)!.order - places.get(b.id)!.order);
    const resolved = notes.filter((n) => n.resolved);
    const frag = document.createDocumentFragment();
    if (general.length) frag.append(heading('General'), ...general.map((n) => this.card(n, null)));
    if (anchored.length) frag.append(heading('In the manuscript'), ...anchored.map((n) => this.card(n, places.get(n.id)!)));
    if (!open.length) frag.append(Object.assign(document.createElement('p'), { className: 'bt-notes-empty', textContent: 'No open notes. Select a passage and press ⇧⌘M, or add a general note.' }));
    if (this.showResolved && resolved.length) frag.append(heading('Resolved'), ...resolved.map((n) => this.card(n, places.get(n.id) ?? null)));
    const scroll = this.list.scrollTop;
    this.list.replaceChildren(frag);
    this.list.scrollTop = scroll;
    this.updateCounts();
  }

  private updateCounts() {
    const notes = this.h.store.all;
    const open = notes.filter((n) => !n.resolved).length;
    const resolved = notes.length - open;
    this.count.textContent = open ? String(open) : '';
    const toggle = this.el.querySelector<HTMLElement>('.bt-notes-toggle')!;
    toggle.hidden = resolved === 0;
    toggle.textContent = this.showResolved ? `Hide resolved (${resolved})` : `Show resolved (${resolved})`;
    toggle.setAttribute('aria-pressed', String(this.showResolved));
  }

  private card(note: Note, place: Place | null): HTMLElement {
    const card = document.createElement('div');
    card.className = 'bt-notes-card';
    card.dataset.note = note.id;
    if (note.resolved) card.dataset.resolved = 'true';
    if (place?.lost) card.dataset.lost = 'true';
    if (note.anchor) {
      const quote = document.createElement('blockquote');
      quote.className = 'bt-notes-quote';
      quote.textContent = note.anchor.quote;
      card.append(quote);
    }
    const body = new NoteBody({
      text: note.body,
      editing: !note.body,
      onSave: (text) => this.h.store.update(note.id, { body: text }),
      onCancel: (wasNew) => { if (wasNew) this.h.remove(note.id); },
      onMode: (editing) => { card.dataset.editing = String(editing); },
      onDone: () => this.h.toEditor(),
    });
    this.bodies.set(note.id, body);
    card.append(body.el);
    const foot = document.createElement('div');
    foot.className = 'bt-notes-meta';
    const where = document.createElement('span');
    where.className = 'bt-notes-where';
    where.textContent = place ? place.label : 'General';
    foot.append(where);
    const action = (name: string, label: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bt-notes-action';
      b.dataset.action = name;
      b.textContent = label;
      return b;
    };
    if (note.resolved) {
      foot.append(action('reopen', 'Reopen'), action('delete', this.armed?.id === note.id ? 'Confirm: delete' : 'Delete'));
    } else {
      if (place && !place.lost) foot.append(action('show', 'Show in manuscript'));
      foot.append(action('resolve', 'Resolve'));
    }
    if (place?.lost) foot.append(action('delete', this.armed?.id === note.id ? 'Confirm: delete' : 'Delete'));
    card.append(foot);
    return card;
  }

  private onClick(e: MouseEvent) {
    const button = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!button) return;
    const id = button.closest<HTMLElement>('[data-note]')?.dataset.note;
    switch (button.dataset.action) {
      case 'new': this.newGeneral(); break;
      case 'resolved': this.showResolved = !this.showResolved; this.render(); break;
      case 'show': if (id) this.h.show(id); break;
      case 'resolve': if (id) this.h.store.update(id, { resolved: true }); break;
      case 'reopen': if (id) this.h.store.update(id, { resolved: false }); break;
      case 'delete':
        if (!id) break;
        if (this.armed?.id === id) { clearTimeout(this.armed.timer); this.armed = null; this.h.remove(id); }
        else {
          if (this.armed) clearTimeout(this.armed.timer);
          this.armed = { id, timer: window.setTimeout(() => { this.armed = null; this.render(); }, ARM_MS) };
          this.render();
        }
        break;
    }
  }
}

function heading(text: string): HTMLElement {
  return Object.assign(document.createElement('h3'), { className: 'bt-notes-section', textContent: text });
}

