import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import type { Manuscript, Scene } from '@baretext/format';
import { createManuscriptState, docToModel, structureSignature } from '../src';

export function scene(id: string, paragraphs: string[], name: string | null = null): Scene {
  return { id, name, link: null, blocks: paragraphs.map((t) => ({ type: 'paragraph', content: t ? [{ text: t }] : [] })) };
}

/** Book: chapter c1 "One" with scenes s1 (unnamed), s2 (named "Two"); chapter c2 "Next" with s3. */
export function sampleManuscript(): Manuscript {
  return {
    title: 'Book',
    chapters: [
      { id: 'c1', title: 'One', scenes: [scene('s1', ['Alpha first.', 'Alpha last.']), scene('s2', ['Beta only.'], 'Two')] },
      { id: 'c2', title: 'Next', scenes: [scene('s3', ['Gamma.'])] },
    ],
    coldStorage: [scene('k1', ['Cut.'])],
  };
}

export interface Harness {
  state: EditorState;
  rejected: number;
  run(cmd: Command): boolean;
  /** Position just before/after `needle` inside the text (first match). */
  at(needle: string, offset?: number): number;
  cursor(pos: number): void;
  select(from: number, to: number): void;
  model(): Manuscript;
  signature(): string;
  text(): string;
}

export function harness(m: Manuscript = sampleManuscript()): Harness {
  const h: Harness = {
    rejected: 0,
    state: undefined as unknown as EditorState,
    run(cmd) {
      return cmd(h.state, (tr) => { h.state = h.state.apply(tr); });
    },
    at(needle, offset = 0) {
      let found = -1;
      h.state.doc.descendants((node, pos) => {
        if (found >= 0) return false;
        if (node.isText && node.text!.includes(needle)) { found = pos + node.text!.indexOf(needle) + offset; return false; }
        return true;
      });
      if (found < 0) throw new Error(`text not found: ${needle}`);
      return found;
    },
    cursor(pos) {
      h.state = h.state.apply(h.state.tr.setSelection(TextSelection.create(h.state.doc, pos)));
    },
    select(from, to) {
      h.state = h.state.apply(h.state.tr.setSelection(TextSelection.create(h.state.doc, from, to)));
    },
    model: () => docToModel(h.state.doc),
    signature: () => structureSignature(h.state.doc),
    text: () => h.state.doc.textBetween(0, h.state.doc.content.size, '\n', ' '),
  };
  h.state = createManuscriptState(m, { onReject: () => { h.rejected++; } });
  return h;
}
