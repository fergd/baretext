// The document as an ExportBook (DECISIONS §18): the prose of every chapter,
// optionally Cold Storage, and — when notes are included — where each open
// note's passage starts and ends, numbered in reading order. Scene names
// and every identity stay behind.

import type { Node as PMNode } from 'prosemirror-model';
import { countWords, type ExportBlock, type ExportBook, type ExportItem, type ExportNote, type ExportScene, type Run } from '@baretext/format';
import { anchorsIn } from './notes';
import { schema } from './schema';

export interface ExportNoteInput {
  id: string;
  body: string;
  /** About a passage (false: a general note). */
  anchored: boolean;
}

export interface ExportOptions {
  coldStorage: boolean;
  /** Open notes to include, or null to leave notes out. */
  notes: readonly ExportNoteInput[] | null;
}

export function docToExport(doc: PMNode, o: ExportOptions): ExportBook {
  const wanted = new Map((o.notes ?? []).map((n) => [n.id, n]));
  const ranges = new Map([...anchorsIn(doc)].filter(([id]) => wanted.get(id)?.anchored));
  const startsAt = new Map<number, string[]>();
  const endsAt = new Map<number, string[]>();
  for (const [id, r] of ranges) {
    startsAt.set(r.from, [...(startsAt.get(r.from) ?? []), id]);
    endsAt.set(r.to, [...(endsAt.get(r.to) ?? []), id]);
  }
  const numbers = new Map<string, number>(); // in reading order, as passages start
  let words = 0;

  const items = (block: PMNode, at: number): ExportItem[] => {
    const out: ExportItem[] = [];
    block.forEach((child, offset) => {
      const pos = at + 1 + offset;
      for (const id of startsAt.get(pos) ?? []) {
        if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
        out.push({ note: numbers.get(id)!, edge: 'start' });
      }
      const run: Run = { text: child.text ?? '' };
      for (const m of child.marks) {
        if (m.type === schema.marks.bold) run.bold = true;
        else if (m.type === schema.marks.italic) run.italic = true;
        else if (m.type === schema.marks.link) run.link = m.attrs.href;
      }
      out.push(run);
      for (const id of endsAt.get(pos + child.nodeSize) ?? []) if (numbers.has(id)) out.push({ note: numbers.get(id)!, edge: 'end' });
    });
    words += countWords(block.textContent);
    return out;
  };

  const scene = (node: PMNode, at: number): ExportScene => {
    let name: string | null = null;
    const blocks: ExportBlock[] = [];
    node.forEach((child, offset) => {
      const pos = at + 1 + offset;
      if (child.type === schema.nodes.scene_heading) name = child.textContent;
      else if (child.type === schema.nodes.paragraph) blocks.push({ type: 'paragraph', content: items(child, pos) });
      else if (child.type === schema.nodes.section_break) blocks.push({ type: 'pause' });
      else if (child.type === schema.nodes.quote) {
        const paragraphs: ExportItem[][] = [];
        child.forEach((p, o2) => paragraphs.push(items(p, pos + 1 + o2)));
        blocks.push({ type: 'quote', paragraphs });
      }
    });
    return { name, blocks };
  };

  const book: ExportBook = { title: doc.firstChild!.textContent, chapters: [], coldStorage: [], notes: [], words: 0 };
  doc.forEach((top, offset) => {
    const scenes = (): ExportScene[] => {
      const out: ExportScene[] = [];
      top.forEach((child, o2) => { if (child.type === schema.nodes.scene) out.push(scene(child, offset + 1 + o2)); });
      return out;
    };
    if (top.type === schema.nodes.chapter) book.chapters.push({ title: top.firstChild!.textContent, scenes: scenes() });
    else if (top.type === schema.nodes.cold_storage && o.coldStorage) book.coldStorage = scenes();
  });
  book.words = words;

  // Notes about exported passages, in reading order; then general notes (and
  // any whose passage was deleted). Notes about passages left out stay out.
  const notes: ExportNote[] = [...numbers].map(([id, n]) => {
    const r = ranges.get(id)!;
    return { n, body: wanted.get(id)!.body, quote: doc.textBetween(r.from, r.to, ' ') };
  });
  let n = notes.length;
  for (const note of wanted.values()) {
    if (!note.anchored || !ranges.has(note.id)) notes.push({ n: ++n, body: note.body, quote: null });
  }
  book.notes = notes;
  return book;
}
