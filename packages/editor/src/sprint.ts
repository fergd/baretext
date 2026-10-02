// A sprint's page: a clean slate, separate from the manuscript (DECISIONS
// §21). Its own small schema — prose only: paragraphs, pauses, quotes, bold,
// italic, links — so nothing on it can be a chapter, scene or title. When the
// sprint ends, its writing goes into the book as one new scene (or into Cold
// Storage), as a single undoable change; until then the manuscript is never
// touched.

import { Schema, type Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Command, type Plugin } from 'prosemirror-state';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo, closeHistory } from 'prosemirror-history';
import { inputRules, InputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { countWords, newId, type Block, type Run } from '@baretext/format';
import { nodeToRuns, sceneToNode } from './convert';
import { schema } from './schema';
import { markStructural } from './structure';
import { chapterPos, sceneSlot } from './outline-commands';

const spec = schema.spec;
export const sprintSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: spec.nodes.get('paragraph')!,
    section_break: spec.nodes.get('section_break')!,
    quote: spec.nodes.get('quote')!,
    text: spec.nodes.get('text')!,
  },
  marks: spec.marks.remove('note'),
});

const s = sprintSchema;

function runsToNodes(runs: readonly Run[]): PMNode[] {
  return runs.filter((r) => r.text).map((r) => {
    const marks = [];
    if (r.bold) marks.push(s.marks.bold!.create());
    if (r.italic) marks.push(s.marks.italic!.create());
    if (r.link) marks.push(s.marks.link!.create({ href: r.link }));
    return s.text(r.text, marks);
  });
}

/** A sprint page holding `blocks` (a blank one when there are none). */
export function sprintDoc(blocks: readonly Block[] = []): PMNode {
  const content = blocks.map((b) => {
    switch (b.type) {
      case 'paragraph': return s.nodes.paragraph.create(null, runsToNodes(b.content));
      case 'section_break': return s.nodes.section_break.create();
      case 'quote': return s.nodes.quote.create(null, (b.paragraphs.length ? b.paragraphs : [[]]).map((p) => s.nodes.paragraph.create(null, runsToNodes(p))));
    }
  });
  if (!content.length || content[content.length - 1]!.type !== s.nodes.paragraph) content.push(s.nodes.paragraph.create());
  const doc = s.nodes.doc.create(null, content);
  doc.check();
  return doc;
}

/** The page's writing as manuscript blocks (empty paragraphs at either end dropped). */
export function sprintBlocks(doc: PMNode): Block[] {
  const blocks: Block[] = [];
  doc.forEach((node) => {
    if (node.type === s.nodes.paragraph) blocks.push({ type: 'paragraph', content: nodeToRuns(node) });
    else if (node.type === s.nodes.section_break) blocks.push({ type: 'section_break' });
    else if (node.type === s.nodes.quote) {
      const paragraphs: Run[][] = [];
      node.forEach((p) => { paragraphs.push(nodeToRuns(p)); });
      blocks.push({ type: 'quote', paragraphs });
    }
  });
  const blank = (b: Block) => b.type === 'paragraph' && b.content.every((r) => !r.text.trim());
  while (blocks.length && blank(blocks[0]!)) blocks.shift();
  while (blocks.length && blank(blocks[blocks.length - 1]!)) blocks.pop();
  return blocks;
}

export const sprintWords = (doc: PMNode) => countWords(doc.textBetween(0, doc.content.size, ' ', ' '));

const emDash = new InputRule(/--$/, '—');

/** A pause (section break) where the caret is, with a paragraph after it to keep writing in. */
export const insertSprintPause: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (dispatch) {
    const at = $from.after(1);
    const tr = state.tr.insert(at, [s.nodes.section_break.create(), s.nodes.paragraph.create()]);
    tr.setSelection(TextSelection.create(tr.doc, at + 2));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

export function sprintPlugins(): Plugin[] {
  return [
    inputRules({ rules: [emDash] }),
    keymap({
      'Mod-b': toggleMark(s.marks.bold!),
      'Mod-i': toggleMark(s.marks.italic!),
      'Mod-z': undo,
      'Shift-Mod-z': redo,
      'Mod-y': redo,
      'Shift-Mod-Enter': insertSprintPause,
      // A sprint page has no scenes or chapters to break into.
      'Mod-Enter': () => true,
      'Alt-Mod-Enter': () => true,
    }),
    keymap(baseKeymap),
    history({ newGroupDelay: 500 }),
  ];
}

/** A sprint page's editor state, the caret at the end of its writing. */
export function createSprintState(blocks: readonly Block[] = []): EditorState {
  const state = EditorState.create({ doc: sprintDoc(blocks), plugins: sprintPlugins() });
  return state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
}

/** Where a sprint's writing goes in the book. */
export type SprintPlacement = { to: 'chapter'; chapterId: string } | { to: 'end' } | { to: 'cold' };

/**
 * Put a sprint's writing into the book as one new, unnamed scene: at the
 * end of a chapter, at the end of the book (its last chapter), or in Cold
 * Storage, unnamed unless `name` is given. One undo step; the caret goes to the end of the new scene (in
 * the book) or stays where it was (Cold Storage). Returns false, changing
 * nothing, when there is nothing to place or the chapter is gone.
 */
export const placeSprint = (blocks: readonly Block[], where: SprintPlacement, name: string | null = null): Command => (state, dispatch) => {
  if (!blocks.length) return false;
  const doc = state.doc;
  let chapterAt = -1;
  if (where.to === 'chapter') chapterAt = chapterPos(doc, where.chapterId);
  else if (where.to === 'end') doc.forEach((n, pos) => { if (n.type === schema.nodes.chapter) chapterAt = pos; });
  if (where.to !== 'cold' && chapterAt < 0) return false;
  if (dispatch) {
    const scene = sceneToNode({ id: newId(), name, link: null, blocks: [...blocks] });
    const at = where.to === 'cold'
      ? doc.content.size - 1 // the end of Cold Storage
      : sceneSlot(doc, chapterAt, doc.nodeAt(chapterAt)!.childCount - 1);
    const tr = state.tr.insert(at, scene);
    if (where.to !== 'cold') tr.setSelection(TextSelection.near(tr.doc.resolve(at + scene.nodeSize - 1), -1));
    dispatch(closeHistory(markStructural(tr)).scrollIntoView());
  }
  return true;
};
