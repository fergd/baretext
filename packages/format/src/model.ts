// The manuscript model shared by the editor, the save pipeline, and the
// serializer/parser. Plain data only — no editor or file-syntax knowledge.

export interface Run {
  text: string;
  bold?: true;
  italic?: true;
  link?: string;
}

export type Block =
  | { type: 'paragraph'; content: Run[] }
  | { type: 'section_break' }
  | { type: 'quote'; paragraphs: Run[][] };

export interface Scene {
  id: string;
  /** null = unnamed scene (shown as a boundary); '' = named but blank. */
  name: string | null;
  /** Link-group id shared by linked scenes, or null. */
  link: string | null;
  /** Cold Storage only: where the scene was moved from, so Restore can put it back. */
  origin?: SceneOrigin;
  blocks: Block[];
}

export interface SceneOrigin {
  /** The chapter it came from (it may no longer exist). */
  chapter: string;
  /** Its position among that chapter's scenes. */
  index: number;
}

export function isOrigin(v: unknown): v is SceneOrigin {
  const o = v as SceneOrigin;
  return !!o && typeof o === 'object' && typeof o.chapter === 'string' && ID_PATTERN.test(o.chapter) && Number.isInteger(o.index) && o.index >= 0;
}

export interface Chapter {
  id: string;
  title: string;
  scenes: Scene[];
}

export interface Manuscript {
  title: string;
  chapters: Chapter[];
  coldStorage: Scene[];
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const ID_PATTERN = /^[a-z0-9]{1,32}$/;

export function newId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return id;
}

export function emptyParagraph(): Block {
  return { type: 'paragraph', content: [] };
}

export function newScene(name: string | null = null): Scene {
  return { id: newId(), name, link: null, blocks: [emptyParagraph()] };
}

export function newChapter(title = ''): Chapter {
  return { id: newId(), title, scenes: [newScene()] };
}

export function emptyManuscript(title = ''): Manuscript {
  return { title, chapters: [newChapter()], coldStorage: [] };
}

function sameMarks(a: Run, b: Run): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.link === b.link;
}

/** Canonical runs: no empty runs, adjacent identical marks merged, no false flags. */
export function normalizeRuns(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const run: Run = { text: r.text };
    if (r.bold) run.bold = true;
    if (r.italic) run.italic = true;
    if (r.link) run.link = r.link;
    const prev = out[out.length - 1];
    if (prev && sameMarks(prev, run)) prev.text += run.text;
    else out.push(run);
  }
  return out;
}

function canonicalBlock(b: Block): Block {
  switch (b.type) {
    case 'paragraph':
      return { type: 'paragraph', content: normalizeRuns(b.content) };
    case 'section_break':
      return { type: 'section_break' };
    case 'quote':
      return { type: 'quote', paragraphs: b.paragraphs.map(normalizeRuns) };
  }
}

function canonicalScene(s: Scene): Scene {
  const out: Scene = { id: s.id, name: s.name, link: s.link, blocks: s.blocks.map(canonicalBlock) };
  if (s.origin) out.origin = { chapter: s.origin.chapter, index: s.origin.index };
  return out;
}

/** Structural invariants every saved or edited manuscript must satisfy. */
export function validate(m: Manuscript): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const checkId = (id: string, what: string) => {
    if (!ID_PATTERN.test(id)) errors.push(`${what} has invalid id ${JSON.stringify(id)}`);
    else if (ids.has(id)) errors.push(`${what} has duplicate id ${id}`);
    ids.add(id);
  };
  const checkLine = (text: string, what: string) => {
    if (/[\n\r]/.test(text)) errors.push(`${what} contains a line break`);
  };
  const checkScene = (s: Scene, where: string) => {
    checkId(s.id, `scene in ${where}`);
    if (s.name !== null) checkLine(s.name, `scene name in ${where}`);
    if (s.link !== null && !ID_PATTERN.test(s.link)) errors.push(`scene ${s.id} has invalid link group`);
    if (s.blocks.length === 0) errors.push(`scene ${s.id} has no blocks`);
    if (s.origin !== undefined && (where !== 'cold storage' || !isOrigin(s.origin))) errors.push(`scene ${s.id} has an invalid origin`);
    for (const b of s.blocks) {
      if (b.type === 'quote' && b.paragraphs.length === 0) errors.push(`scene ${s.id} has an empty quote`);
      const paras = b.type === 'paragraph' ? [b.content] : b.type === 'quote' ? b.paragraphs : [];
      for (const p of paras) for (const r of p) checkLine(r.text, `text in scene ${s.id}`);
    }
  };
  checkLine(m.title, 'book title');
  if (m.chapters.length === 0) errors.push('manuscript has no chapters');
  for (const c of m.chapters) {
    checkId(c.id, 'chapter');
    checkLine(c.title, `chapter ${c.id} title`);
    if (c.scenes.length === 0) errors.push(`chapter ${c.id} has no scenes`);
    for (const s of c.scenes) checkScene(s, `chapter ${c.id}`);
  }
  for (const s of m.coldStorage) checkScene(s, 'cold storage');
  return errors;
}

/**
 * Deterministic canonical form (runs normalized). Throws if structural
 * invariants are violated — callers must never save an invalid manuscript.
 */
export function canonicalize(m: Manuscript): Manuscript {
  const errors = validate(m);
  if (errors.length) throw new Error(`Invalid manuscript: ${errors.join('; ')}`);
  return {
    title: m.title,
    chapters: m.chapters.map((c) => ({ id: c.id, title: c.title, scenes: c.scenes.map(canonicalScene) })),
    coldStorage: m.coldStorage.map(canonicalScene),
  };
}

/** Fill missing structure (used when reading hand-edited or imported files). */
export function repair(m: Manuscript): Manuscript {
  const fixScene = (s: Scene): Scene => ({
    ...s,
    blocks: s.blocks.length
      ? s.blocks.map((b) => (b.type === 'quote' && b.paragraphs.length === 0 ? { type: 'quote', paragraphs: [[]] } : b))
      : [emptyParagraph()],
  });
  const chapters = m.chapters.map((c) => ({
    ...c,
    scenes: c.scenes.length ? c.scenes.map(fixScene) : [newScene()],
  }));
  return { title: m.title, chapters: chapters.length ? chapters : [newChapter()], coldStorage: m.coldStorage.map(fixScene) };
}

/** Plain text of a run list (for word counts, AI input, search). */
export function runsText(runs: readonly Run[]): string {
  return runs.map((r) => r.text).join('');
}

export function sceneText(s: Scene): string {
  const parts: string[] = [];
  for (const b of s.blocks) {
    if (b.type === 'paragraph') parts.push(runsText(b.content));
    else if (b.type === 'quote') for (const p of b.paragraphs) parts.push(runsText(p));
  }
  return parts.join('\n');
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

/** Words in the manuscript's prose (as the status bar counts): scene text, not names or cold storage. */
export function manuscriptWords(m: Manuscript): number {
  let n = 0;
  for (const c of m.chapters) for (const s of c.scenes) n += countWords(sceneText(s));
  return n;
}

/** Every word of prose the file holds: the manuscript and Cold Storage (what the save guard protects). */
export function fileWords(m: Manuscript): number {
  let n = manuscriptWords(m);
  for (const s of m.coldStorage) n += countWords(sceneText(s));
  return n;
}
