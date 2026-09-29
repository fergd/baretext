// Randomized editing: every sequence of user-like actions must keep the
// manuscript valid, saveable, structurally intact (unless the action was a
// structural command), and fully undoable.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { redo, undo, undoDepth } from 'prosemirror-history';
import { Selection, TextSelection, type EditorState } from 'prosemirror-state';
import { Slice } from 'prosemirror-model';
import { validate, verifyRoundTrip } from '@baretext/format';
import {
  backspace,
  deleteAcrossStructure,
  docToModel,
  enter,
  flattenPastedSlice,
  forwardDelete,
  insertSectionBreak,
  removeLink,
  setLink,
  splitScene,
  structureSignature,
  toggleBold,
  toggleItalic,
  toggleQuote,
  withinOneRegion,
} from '../src';
import { harness, sampleManuscript, scene } from './helpers';

type Op =
  | { kind: 'cursor'; at: number }
  | { kind: 'select'; a: number; b: number }
  | { kind: 'type'; text: string }
  | { kind: 'enter' | 'backspace' | 'delete' | 'bold' | 'italic' | 'quote' | 'link' | 'unlink' | 'pause' | 'split' | 'undo' | 'redo' }
  | { kind: 'paste'; a: number; b: number }
  | { kind: 'raw'; a: number; b: number; text: string };

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: unit.map((at): Op => ({ kind: 'cursor', at })) },
  { weight: 2, arbitrary: fc.tuple(unit, unit).map(([a, b]): Op => ({ kind: 'select', a, b })) },
  { weight: 4, arbitrary: fc.constantFrom('a', 'word ', '*', '#', '-', '\n', '—', '漢').map((text): Op => ({ kind: 'type', text })) },
  { weight: 2, arbitrary: fc.constantFrom<Op>({ kind: 'enter' }, { kind: 'backspace' }, { kind: 'delete' }) },
  { weight: 1, arbitrary: fc.constantFrom<Op>({ kind: 'bold' }, { kind: 'italic' }, { kind: 'quote' }, { kind: 'link' }, { kind: 'unlink' }, { kind: 'pause' }, { kind: 'split' }, { kind: 'undo' }, { kind: 'redo' }) },
  { weight: 1, arbitrary: fc.tuple(unit, unit).map(([a, b]): Op => ({ kind: 'paste', a, b })) },
  { weight: 1, arbitrary: fc.tuple(unit, unit, fc.constantFrom('', 'x')).map(([a, b, text]): Op => ({ kind: 'raw', a, b, text })) },
);

const posAt = (state: EditorState, u: number) => Math.floor(u * state.doc.content.size);

function typeText(state: EditorState, text: string): EditorState {
  // What the view does for typed text, including the safe-replace plugin.
  const { $from, $to, empty } = state.selection;
  if (!empty && !withinOneRegion($from, $to)) {
    const tr = deleteAcrossStructure(state);
    return tr ? state.apply(tr.insertText(text)) : state;
  }
  return state.apply(state.tr.insertText(text));
}

function richManuscript() {
  const m = sampleManuscript();
  m.chapters[0]!.scenes[0]!.blocks.splice(1, 0, { type: 'section_break' }, { type: 'quote', paragraphs: [[{ text: 'Quoted.' }], [{ text: 'More.', italic: true }]] });
  m.chapters.push({ id: 'c3', title: '', scenes: [scene('s4', ['', 'Delta.'], ''), scene('s5', ['Epsilon **not bold**'])] });
  return m;
}

describe('editing fuzzer', () => {
  it('keeps every invariant through random editing', () => {
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 40 }), (ops) => {
        const h = harness(richManuscript());
        const original = h.state.doc;
        const cold = JSON.stringify(h.model().coldStorage);

        for (const o of ops) {
          const sigBefore = h.signature();
          let structural = false;
          switch (o.kind) {
            case 'cursor':
              h.state = h.state.apply(h.state.tr.setSelection(Selection.near(h.state.doc.resolve(posAt(h.state, o.at)))));
              break;
            case 'select': {
              const a = Selection.near(h.state.doc.resolve(posAt(h.state, o.a)));
              const b = Selection.near(h.state.doc.resolve(posAt(h.state, o.b)));
              h.state = h.state.apply(h.state.tr.setSelection(TextSelection.between(a.$from, b.$from)));
              break;
            }
            case 'type':
              h.state = typeText(h.state, o.text);
              break;
            case 'enter': h.run(enter); break;
            case 'backspace': h.run(backspace); break;
            case 'delete': h.run(forwardDelete); break;
            case 'bold': h.run(toggleBold); break;
            case 'italic': h.run(toggleItalic); break;
            case 'quote': h.run(toggleQuote); break;
            case 'link': h.run(setLink('example.com')); break;
            case 'unlink': h.run(removeLink); break;
            case 'pause': h.run(insertSectionBreak); break;
            case 'split': h.run(splitScene); structural = true; break;
            case 'undo': h.run(undo); structural = true; break;
            case 'redo': h.run(redo); structural = true; break;
            case 'paste': {
              const a = Math.min(posAt(h.state, o.a), posAt(h.state, o.b));
              const b = Math.max(posAt(h.state, o.a), posAt(h.state, o.b));
              const slice = flattenPastedSlice(h.state.doc.slice(a, b));
              if (slice !== Slice.empty) {
                const { $from, $to, empty } = h.state.selection;
                if (!empty && !withinOneRegion($from, $to)) {
                  const tr = deleteAcrossStructure(h.state);
                  if (tr) h.state = h.state.apply(tr);
                }
                h.state = h.state.apply(h.state.tr.replaceSelection(slice));
              }
              break;
            }
            case 'raw': {
              // Arbitrary low-level edits: the guard must refuse any that touch structure.
              const a = Math.min(posAt(h.state, o.a), posAt(h.state, o.b));
              const b = Math.max(posAt(h.state, o.a), posAt(h.state, o.b));
              try { h.state = h.state.apply(h.state.tr.replaceWith(a, b, o.text ? h.state.schema.text(o.text) : [])); }
              catch { /* invalid replace: nothing applied */ }
              break;
            }
          }

          h.state.doc.check();
          if (!structural) expect(h.signature()).toBe(sigBefore);
          const m = docToModel(h.state.doc);
          expect(validate(m)).toEqual([]);
          expect(() => verifyRoundTrip(m)).not.toThrow();
          expect(JSON.stringify(m.coldStorage)).toBe(cold);
        }

        while (undoDepth(h.state) > 0) h.run(undo);
        expect(h.state.doc.eq(original)).toBe(true);
        expect(structureSignature(h.state.doc)).toBe(structureSignature(original));
      }),
      { numRuns: Number(process.env.FC_RUNS ?? 1500) },
    );
  });
});
