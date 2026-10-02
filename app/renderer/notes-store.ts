// The notes of the open manuscript (spec §9): bodies and states here, anchors
// as marks in the document (editor/notes.ts). Loaded with the manuscript,
// saved beside it shortly after any change — including edits that move a
// note's passage, so the file always knows where to find it again.

import type { EditorView } from 'prosemirror-view';
import { anchorsIn, applyAnchors, describeAnchor, locateAnchor } from '@baretext/editor';
import { newId } from '@baretext/format';
import type { BaretextBridge } from '../shared/bridge';
import type { Note, SavedNoteAnchor } from '../shared/notes';

const SAVE_MS = 500;

export class NotesStore {
  private notes: Note[] = [];
  private filePath: string | null = null;
  private timer: number | undefined;
  private chain: Promise<boolean> = Promise.resolve(true);
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly bridge: BaretextBridge,
    private readonly getView: () => EditorView | null,
    private readonly onError: (message: string) => void,
  ) {}

  /** Every note, in creation order. */
  get all(): readonly Note[] {
    return this.notes;
  }

  get(id: string): Note | undefined {
    return this.notes.find((n) => n.id === id);
  }

  /** An anchored note whose passage is no longer in the manuscript ("the passage was deleted"). */
  isLost(note: Note): boolean {
    const view = this.getView();
    return !!note.anchor && !!view && !anchorsIn(view.state.doc).has(note.id);
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private changed() {
    for (const cb of this.listeners) cb();
  }

  /** A manuscript opened: read its notes and put their anchors back on the text. */
  async load(filePath: string) {
    clearTimeout(this.timer);
    this.filePath = filePath;
    this.notes = [];
    this.changed();
    const notes = await this.bridge.loadNotes(filePath).catch((e: Error) => { this.onError(`Couldn’t read the notes: ${e.message}`); return [] as Note[]; });
    const view = this.getView();
    if (this.filePath !== filePath || !view) return; // another file opened meanwhile
    this.notes = notes;
    const ranges = notes.flatMap((n) => {
      const r = n.anchor ? locateAnchor(view.state.doc, n.anchor) : null;
      return r ? [{ id: n.id, ...r }] : [];
    });
    if (ranges.length) view.dispatch(applyAnchors(view.state, ranges));
    this.changed();
  }

  /** A new note: general (no anchor), or about a passage whose anchor mark carries `id`. */
  create(anchor: SavedNoteAnchor | null, id = newId()): Note {
    const now = Date.now();
    const note: Note = { id, body: '', anchor, resolved: false, created: now, updated: now };
    this.notes.push(note);
    this.changed();
    this.schedule();
    return note;
  }

  update(id: string, patch: Partial<Pick<Note, 'body' | 'resolved'>>) {
    const note = this.get(id);
    if (!note) return;
    Object.assign(note, patch, { updated: Date.now() });
    this.changed();
    this.schedule();
  }

  remove(id: string) {
    this.notes = this.notes.filter((n) => n.id !== id);
    this.changed();
    this.schedule();
  }

  /** The manuscript changed: passages may have moved; save their new places soon. */
  textChanged() {
    if (this.notes.some((n) => n.anchor)) this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), SAVE_MS);
  }

  /** Save now (after any save under way). */
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    const run = this.chain.then(() => this.save());
    this.chain = run.catch(() => false);
    return run;
  }

  private async save(): Promise<boolean> {
    const view = this.getView();
    const filePath = this.filePath;
    if (!view || !filePath) return true;
    // Each anchored note's passage as it is now (a deleted one keeps its last known place).
    const anchors = anchorsIn(view.state.doc);
    for (const n of this.notes) {
      const a = anchors.get(n.id);
      if (a) n.anchor = describeAnchor(view.state.doc, a);
    }
    const result = await this.bridge.saveNotes(filePath, this.notes).catch((e: Error) => ({ ok: false, message: e.message }));
    if (!result.ok) this.onError(`Notes not saved: ${result.message ?? 'unknown error'}. They are safe in the window.`);
    return result.ok;
  }
}
