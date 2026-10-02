// Notes (spec §9): stored beside the manuscript in "<name>.notes.json",
// never in the manuscript itself. Shared by the main process (file) and the
// window (notes area). Anything malformed in the file is dropped, never trusted.

export interface SavedNoteAnchor {
  /** Scene id (manuscript or Cold Storage). */
  scene: string;
  /** The anchored passage, paragraphs joined by "\n". */
  quote: string;
  /** Where the passage starts in its scene's prose. */
  offset: number;
}

export interface Note {
  id: string;
  body: string;
  /** null: a general note, about the book rather than a passage. */
  anchor: SavedNoteAnchor | null;
  resolved: boolean;
  created: number;
  updated: number;
}

export interface NotesFile {
  v: 1;
  notes: Note[];
}

const ID = /^[a-z0-9]{1,32}$/;

function validAnchor(a: unknown): a is SavedNoteAnchor {
  const x = a as SavedNoteAnchor;
  return !!x && typeof x === 'object' && typeof x.scene === 'string' && ID.test(x.scene) &&
    typeof x.quote === 'string' && x.quote.length > 0 && x.quote.length <= 10_000 && Number.isInteger(x.offset) && x.offset >= 0;
}

/** The well-formed notes in `raw` (a parsed notes file); everything else is left out. */
export function validNotes(raw: unknown): Note[] {
  const list = (raw as NotesFile | null)?.notes;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Note[] = [];
  for (const n of list) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string' || !ID.test(n.id) || seen.has(n.id)) continue;
    if (typeof n.body !== 'string' || (n.anchor !== null && !validAnchor(n.anchor))) continue;
    seen.add(n.id);
    out.push({
      id: n.id, body: n.body, anchor: n.anchor ? { scene: n.anchor.scene, quote: n.anchor.quote, offset: n.anchor.offset } : null,
      resolved: n.resolved === true,
      created: Number.isFinite(n.created) ? n.created : 0,
      updated: Number.isFinite(n.updated) ? n.updated : 0,
    });
  }
  return out;
}

/** "Novel.md" → "Novel.notes.json" (beside it). */
export function notesPathFor(manuscriptPath: string): string {
  return manuscriptPath.replace(/\.(md|markdown|txt)$/i, '') + '.notes.json';
}
