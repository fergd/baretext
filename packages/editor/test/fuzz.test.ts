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
  findMatches,
  insertSectionBreak,
  nameScene,
  replaceAll,
  removeLink,
  rename,
  addChapter,
  moveChapter,
  moveScene,
  deleteChapter,
  deleteScene,
  moveToColdStorage,
  restoreFromColdStorage,
  openParked,
  closeParked,
  parkedKey,
  addNoteAnchor,
  removeNoteAnchor,
  addScene,
  BOOK_TITLE,
  setLink,
  splitScene,
  splitChapter,
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
  | { kind: 'enter' | 'backspace' | 'delete' | 'bold' | 'italic' | 'quote' | 'link' | 'unlink' | 'pause' | 'name' | 'split' | 'split-chapter' | 'undo' | 'redo' }
  | { kind: 'paste'; a: number; b: number }
  | { kind: 'raw'; a: number; b: number; text: string }
  | { kind: 'replace'; query: string; text: string }
  | { kind: 'rename'; target: number; name: string }
  | { kind: 'add'; what: 'scene' | 'chapter' | 'chapter-after'; target: number }
  | { kind: 'move'; what: 'scene' | 'chapter'; a: number; b: number; index: number }
  | { kind: 'remove'; what: 'scene' | 'chapter'; a: number }
  | { kind: 'park'; a: number }
  | { kind: 'unpark'; a: number; b: number; index: number; home: boolean }
  | { kind: 'open'; a: number }
  | { kind: 'close' }
  | { kind: 'note'; a: number; b: number; id: string }
  | { kind: 'unnote'; id: string };

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: unit.map((at): Op => ({ kind: 'cursor', at })) },
  { weight: 2, arbitrary: fc.tuple(unit, unit).map(([a, b]): Op => ({ kind: 'select', a, b })) },
  { weight: 4, arbitrary: fc.constantFrom('a', 'word ', '*', '#', '-', '\n', '—', '漢').map((text): Op => ({ kind: 'type', text })) },
  { weight: 2, arbitrary: fc.constantFrom<Op>({ kind: 'enter' }, { kind: 'backspace' }, { kind: 'delete' }) },
  { weight: 1, arbitrary: fc.constantFrom<Op>({ kind: 'bold' }, { kind: 'italic' }, { kind: 'quote' }, { kind: 'link' }, { kind: 'unlink' }, { kind: 'pause' }, { kind: 'name' }, { kind: 'split' }, { kind: 'split-chapter' }, { kind: 'undo' }, { kind: 'redo' }) },
  { weight: 1, arbitrary: fc.tuple(unit, unit).map(([a, b]): Op => ({ kind: 'paste', a, b })) },
  { weight: 1, arbitrary: fc.tuple(unit, unit, fc.constantFrom('', 'x')).map(([a, b, text]): Op => ({ kind: 'raw', a, b, text })) },
  { weight: 1, arbitrary: fc.tuple(fc.constantFrom<'scene' | 'chapter'>('scene', 'chapter'), unit).map(([what, a]): Op => ({ kind: 'remove', what, a })) },
  { weight: 1, arbitrary: unit.map((a): Op => ({ kind: 'park', a })) },
  { weight: 1, arbitrary: fc.tuple(unit, unit, fc.integer({ min: 0, max: 5 }), fc.boolean()).map(([a, b, index, home]): Op => ({ kind: 'unpark', a, b, index, home })) },
  { weight: 2, arbitrary: unit.map((a): Op => ({ kind: 'open', a })) },
  { weight: 1, arbitrary: fc.constant<Op>({ kind: 'close' }) },
  { weight: 2, arbitrary: fc.tuple(unit, unit, fc.constantFrom('n1', 'n2', 'n3')).map(([a, b, id]): Op => ({ kind: 'note', a, b, id })) },
  { weight: 1, arbitrary: fc.constantFrom('n1', 'n2', 'n3').map((id): Op => ({ kind: 'unnote', id })) },
  { weight: 2, arbitrary: fc.tuple(fc.constantFrom<'scene' | 'chapter'>('scene', 'chapter'), unit, unit, fc.integer({ min: 0, max: 5 })).map(([what, a, b, index]): Op => ({ kind: 'move', what, a, b, index })) },
  { weight: 1, arbitrary: fc.tuple(fc.constantFrom<'scene' | 'chapter' | 'chapter-after'>('scene', 'chapter', 'chapter-after'), unit).map(([what, target]): Op => ({ kind: 'add', what, target })) },
  { weight: 1, arbitrary: fc.tuple(unit, fc.constantFrom('', '  ', 'Dawn', 'Two', 'a\nb', ' x ')).map(([target, name]): Op => ({ kind: 'rename', target, name })) },
  { weight: 1, arbitrary: fc.tuple(fc.constantFrom('a', 'l', 'ph', '.', 'Alpha'), fc.constantFrom('', 'Z', 'xyz')).map(([query, text]): Op => ({ kind: 'replace', query, text })) },
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
        let cold = JSON.stringify(h.model().coldStorage);

        for (const o of ops) {
          const sigBefore = h.signature();
          // Leaving a just-started empty scene name drops it (by design);
          // otherwise ordinary edits never change structure.
          const $was = h.state.selection.$head;
          let structural = $was.parent.type.name === 'scene_heading' && $was.parent.content.size === 0;
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
            case 'name': h.run(nameScene); structural = true; break;
            case 'split': h.run(splitScene); structural = true; break;
            case 'split-chapter': h.run(splitChapter); structural = true; break;
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
            case 'replace': {
              const tr = replaceAll(h.state, findMatches(h.state.doc, o.query, { limit: Infinity }), o.text);
              if (tr) h.state = h.state.apply(tr);
              break;
            }
            case 'rename': {
              // Any target, including a parked scene (which must be refused).
              const ids = [BOOK_TITLE, 'k1', ...docToModel(h.state.doc).chapters.flatMap((c) => [c.id, ...c.scenes.map((x) => x.id)])];
              const id = ids[Math.min(ids.length - 1, Math.floor(o.target * ids.length))]!;
              h.run(rename(id, o.name));
              structural = true;
              const want = o.name.replace(/\s+/g, ' ').trim();
              const after = docToModel(h.state.doc);
              if (id === BOOK_TITLE) expect(after.title).toBe(want);
              const ch = after.chapters.find((c) => c.id === id);
              if (ch) expect(ch.title).toBe(want);
              const sc = after.chapters.flatMap((c) => c.scenes).find((x) => x.id === id);
              if (sc) expect(sc.name).toBe(want || null);
              break;
            }
            case 'add': {
              const chapters = docToModel(h.state.doc).chapters;
              const chapter = chapters[Math.min(chapters.length - 1, Math.floor(o.target * chapters.length))]!;
              const scenesBefore = chapters.reduce((n, c) => n + c.scenes.length, 0);
              h.run(o.what === 'scene' ? addScene(chapter.id) : addChapter(o.what === 'chapter' ? undefined : chapter.id));
              structural = true;
              const after = docToModel(h.state.doc).chapters;
              expect(after.reduce((n, c) => n + c.scenes.length, 0)).toBe(scenesBefore + 1);
              expect(after.length).toBe(chapters.length + (o.what === 'scene' ? 0 : 1));
              break;
            }
            case 'move': {
              const before = docToModel(h.state.doc);
              const pick = <T,>(xs: T[], u: number) => xs[Math.min(xs.length - 1, Math.floor(u * xs.length))]!;
              const scenesOf = (mm: typeof before) => mm.chapters.flatMap((c) => c.scenes).map((x) => JSON.stringify(x)).sort();
              if (o.what === 'scene') h.run(moveScene(pick(before.chapters.flatMap((c) => c.scenes), o.a).id, pick(before.chapters, o.b).id, o.index));
              else h.run(moveChapter(pick(before.chapters, o.a).id, o.index));
              structural = true;
              const after = docToModel(h.state.doc);
              // Nothing lost, duplicated or altered: the same scenes, word for word.
              expect(scenesOf(after)).toEqual(scenesOf(before));
              expect(after.chapters.map((c) => c.title).sort()).toEqual(before.chapters.map((c) => c.title).sort());
              expect(after.chapters.every((c) => c.scenes.length > 0)).toBe(true);
              break;
            }
            case 'remove': {
              const before = docToModel(h.state.doc);
              const pick = <T,>(xs: T[], u: number) => xs[Math.min(xs.length - 1, Math.floor(u * xs.length))]!;
              const gone = o.what === 'scene' ? [pick(before.chapters.flatMap((c) => c.scenes), o.a).id] : pick(before.chapters, o.a).scenes.map((x) => x.id);
              if (o.what === 'scene') h.run(deleteScene(gone[0]!));
              else h.run(deleteChapter(pick(before.chapters, o.a).id));
              structural = true;
              const after = docToModel(h.state.doc);
              // Every scene not deleted is still there, word for word; the only new
              // scene allowed is the empty one left in an emptied chapter or book.
              const scenes = (mm: typeof before) => new Map(mm.chapters.flatMap((c) => c.scenes).map((x) => [x.id, JSON.stringify(x)]));
              const was = scenes(before);
              const now = scenes(after);
              for (const [id, json] of was) if (!gone.includes(id)) expect(now.get(id)).toBe(json);
              const added = [...now.keys()].filter((id) => !was.has(id));
              expect(added.length).toBeLessThanOrEqual(1);
              for (const id of added) expect(JSON.parse(now.get(id)!).blocks).toEqual([{ type: 'paragraph', content: [] }]);
              for (const id of gone) expect(now.has(id)).toBe(false);
              expect(after.chapters.length).toBeGreaterThan(0);
              expect(after.chapters.every((c) => c.scenes.length > 0)).toBe(true);
              break;
            }
            case 'park': {
              const scenes = docToModel(h.state.doc).chapters.flatMap((c) => c.scenes);
              h.run(moveToColdStorage(scenes[Math.min(scenes.length - 1, Math.floor(o.a * scenes.length))]!.id));
              structural = true;
              break;
            }
            case 'unpark': {
              const m0 = docToModel(h.state.doc);
              if (!m0.coldStorage.length) break;
              const id = m0.coldStorage[Math.min(m0.coldStorage.length - 1, Math.floor(o.a * m0.coldStorage.length))]!.id;
              const chapter = m0.chapters[Math.min(m0.chapters.length - 1, Math.floor(o.b * m0.chapters.length))]!.id;
              h.run(o.home ? restoreFromColdStorage(id) : restoreFromColdStorage(id, chapter, o.index));
              structural = true;
              break;
            }
            case 'open': {
              const parked = docToModel(h.state.doc).coldStorage;
              if (parked.length) h.run(openParked(parked[Math.min(parked.length - 1, Math.floor(o.a * parked.length))]!.id));
              break;
            }
            case 'close': h.run(closeParked(posAt(h.state, 0.3))); break;
            case 'note': {
              // Anchoring a note never changes the manuscript (only bookkeeping marks).
              const a = Math.min(posAt(h.state, o.a), posAt(h.state, o.b));
              const b = Math.max(posAt(h.state, o.a), posAt(h.state, o.b));
              try { h.state = h.state.apply(h.state.tr.setSelection(TextSelection.create(h.state.doc, a, b))); } catch { break; }
              structural = true; // moving the caret may drop a just-started empty scene name (by design)
              const before = JSON.stringify(docToModel(h.state.doc));
              h.run(addNoteAnchor(o.id));
              expect(JSON.stringify(docToModel(h.state.doc))).toBe(before);
              break;
            }
            case 'unnote': {
              const before = JSON.stringify(docToModel(h.state.doc));
              h.run(removeNoteAnchor(o.id));
              expect(JSON.stringify(docToModel(h.state.doc))).toBe(before);
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
          // Cold Storage changes only through commands (structural ops, undo/redo),
          // or in the text of the one scene open on the page.
          const open = parkedKey.getState(h.state);
          const others = (json: string) => JSON.stringify((JSON.parse(json) as Array<{ id: string }>).filter((x) => x.id !== open));
          if (!structural) expect(others(JSON.stringify(m.coldStorage))).toBe(others(cold));
          cold = JSON.stringify(m.coldStorage);
          // The selection is never inside Cold Storage, except in the open scene.
          const coldAt = h.state.doc.content.size - h.state.doc.lastChild!.nodeSize;
          if (!open) expect(h.state.selection.to).toBeLessThanOrEqual(coldAt);
        }

        while (undoDepth(h.state) > 0) h.run(undo);
        // Note anchors are bookkeeping, not undo steps: compare the manuscript itself.
        expect(docToModel(h.state.doc)).toEqual(docToModel(original));
        expect(structureSignature(h.state.doc)).toBe(structureSignature(original));
      }),
      { numRuns: Number(process.env.FC_RUNS ?? 1500) },
    );
  });
});
