// A note's text, written and read the way a comment is in Google Docs
// (DECISIONS §16): while writing, a text box with Cancel and Save (↵ saves,
// ⇧↵ adds a line, Esc cancels); once saved, plain text — click it to edit.
// Used by the margin cards and the notes panel alike.

export interface NoteBodyOptions {
  text: string;
  /** Open in writing mode (a new note, or "edit"). */
  editing: boolean;
  /** Saved text (never empty). */
  onSave(text: string): void;
  /** Writing was cancelled: `wasNew` when nothing had been saved yet. */
  onCancel(wasNew: boolean): void;
  /** Writing started or stopped (cards show Resolve only when not writing). */
  onMode?(editing: boolean): void;
  /** Writing finished from the keyboard or a button (not by clicking away): where the caret goes next. */
  onDone?(): void;
}

export class NoteBody {
  readonly el: HTMLElement;
  private saved: string;
  private editing = false;

  constructor(private readonly o: NoteBodyOptions) {
    this.saved = o.text;
    this.el = document.createElement('div');
    this.el.className = 'bt-note-content';
    if (o.editing || !o.text) this.edit(); else this.read();
  }

  get isEditing(): boolean {
    return this.editing;
  }

  /** Put the caret in the text box (writing mode). */
  focus() {
    if (!this.editing) this.edit();
    const box = this.el.querySelector('textarea');
    box?.focus({ preventScroll: true });
    if (box) box.setSelectionRange(box.value.length, box.value.length);
  }

  /** Read mode: the saved text; clicking it starts editing. */
  private read() {
    this.editing = false;
    const text = document.createElement('p');
    text.className = 'bt-note-text';
    text.textContent = this.saved;
    text.title = 'Click to edit';
    text.tabIndex = 0;
    text.addEventListener('click', () => this.focus());
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); this.focus(); } });
    this.el.replaceChildren(text);
    this.o.onMode?.(false);
  }

  /** Writing mode: a text box with Cancel and Save. */
  private edit() {
    this.editing = true;
    const box = document.createElement('textarea');
    box.className = 'bt-note-input';
    box.rows = 1;
    box.placeholder = 'Note';
    box.setAttribute('aria-label', 'Note');
    box.value = this.saved;
    const buttons = document.createElement('div');
    buttons.className = 'bt-note-buttons';
    const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'bt-note-cancel', textContent: 'Cancel' });
    const save = Object.assign(document.createElement('button'), { type: 'button', className: 'bt-note-save', textContent: 'Save' });
    const sync = () => { save.disabled = !box.value.trim(); };
    sync();
    box.addEventListener('input', sync);
    box.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the manuscript's and panels' keys stay out of it
      if (e.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.commit(box.value); this.o.onDone?.(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.cancel(); this.o.onDone?.(); }
    });
    // Clicking away keeps what was written (saved), or lets an empty new note go.
    box.addEventListener('blur', (e) => {
      if (this.el.contains(e.relatedTarget as Node)) return; // Save / Cancel
      queueMicrotask(() => { if (this.editing && document.activeElement !== box) this.commit(box.value); });
    });
    for (const b of [cancel, save]) b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the box focused
    cancel.addEventListener('click', () => { this.cancel(); this.o.onDone?.(); });
    save.addEventListener('click', () => { this.commit(box.value); this.o.onDone?.(); });
    buttons.append(cancel, save);
    this.el.replaceChildren(box, buttons);
    this.o.onMode?.(true);
  }

  private commit(value: string) {
    const text = value.replace(/\s+$/, '');
    if (!text.trim()) { this.cancel(); return; }
    this.saved = text;
    this.o.onSave(text);
    this.read();
  }

  private cancel() {
    const wasNew = !this.saved;
    if (wasNew) { this.editing = false; this.o.onCancel(true); return; }
    this.o.onCancel(false);
    this.read();
  }
}
