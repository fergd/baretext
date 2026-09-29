import { describe, expect, it } from 'vitest';
import { redo, undo } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';
import { canonicalize, validate } from '@baretext/format';
import {
  backspace,
  docToModel,
  enter,
  forwardDelete,
  modelToDoc,
  schema,
  splitScene,
  toggleBold,
  toggleItalic,
} from '../src';
import { harness, sampleManuscript, scene } from './helpers';

const sceneTexts = (h: ReturnType<typeof harness>) =>
  h.model().chapters.map((c) => c.scenes.map((s) => s.blocks.map((b) => (b.type === 'paragraph' ? b.content.map((r) => r.text).join('') : `[${b.type}]`))));

describe('model ⇄ document', () => {
  it('round-trips the manuscript, including cold storage and identities', () => {
    const m = sampleManuscript();
    expect(docToModel(modelToDoc(m))).toEqual(canonicalize(m));
  });

  it('gives a scene ending in a section break a writable last line', () => {
    const m = sampleManuscript();
    m.chapters[0]!.scenes[0]!.blocks.push({ type: 'section_break' });
    const back = docToModel(modelToDoc(m));
    expect(back.chapters[0]!.scenes[0]!.blocks.at(-1)).toEqual({ type: 'paragraph', content: [] });
  });
});

describe('Enter', () => {
  it('splits a paragraph within its scene', () => {
    const h = harness();
    h.cursor(h.at('first.'));
    h.run(enter);
    expect(sceneTexts(h)[0]![0]).toEqual(['Alpha ', 'first.', 'Alpha last.']);
    expect(h.signature()).toBe(harness().signature());
  });

  it('at the end of a scene adds a paragraph to that scene, never a new scene', () => {
    const h = harness();
    h.cursor(h.at('Alpha last.', 'Alpha last.'.length));
    h.run(enter);
    expect(sceneTexts(h)[0]![0]).toEqual(['Alpha first.', 'Alpha last.', '']);
    expect(sceneTexts(h)[0]![1]).toEqual(['Beta only.']);
    // The caret is on the new, visible, writable line.
    expect(h.state.selection.$from.parent.type).toBe(schema.nodes.paragraph);
    expect(h.state.selection.$from.parent.content.size).toBe(0);
  });

  it('in a title moves to the first paragraph and never splits the title', () => {
    const h = harness();
    const before = h.state.doc;
    h.cursor(h.at('One', 1));
    h.run(enter);
    expect(h.state.doc.eq(before)).toBe(true);
    expect(h.state.selection.$from.parent.textContent).toBe('Alpha first.');
  });

  it('in a scene name moves to its first paragraph', () => {
    const h = harness();
    h.cursor(h.at('Two', 1));
    h.run(enter);
    expect(h.model().chapters[0]!.scenes[1]!.name).toBe('Two');
    expect(h.state.selection.$from.parent.textContent).toBe('Beta only.');
  });
});

describe('Backspace and Delete at boundaries', () => {
  it('Backspace at the start of a scene never merges scenes', () => {
    const h = harness();
    const before = h.state.doc;
    h.cursor(h.at('Gamma.'));
    expect(h.run(backspace)).toBe(true);
    expect(h.state.doc.eq(before)).toBe(true);
  });

  it('Backspace at the start of the paragraph after a scene name never pulls prose into the name', () => {
    const h = harness();
    const before = h.state.doc;
    h.cursor(h.at('Beta only.'));
    h.run(backspace);
    expect(h.state.doc.eq(before)).toBe(true);
  });

  it('Backspace at the start of a title does nothing', () => {
    const h = harness();
    const before = h.state.doc;
    h.cursor(h.at('Next'));
    h.run(backspace);
    expect(h.state.doc.eq(before)).toBe(true);
  });

  it('Delete at the end of a scene never merges with the next scene', () => {
    const h = harness();
    const before = h.state.doc;
    h.cursor(h.at('Alpha last.', 'Alpha last.'.length));
    expect(h.run(forwardDelete)).toBe(true);
    expect(h.state.doc.eq(before)).toBe(true);
  });

  it('Delete at the end of a title never pulls content into it', () => {
    const h = harness();
    const before = h.state.doc;
    h.cursor(h.at('Two', 3));
    h.run(forwardDelete);
    expect(h.state.doc.eq(before)).toBe(true);
  });

  it('Backspace between paragraphs of one scene joins them', () => {
    const h = harness();
    h.cursor(h.at('Alpha last.'));
    h.run(backspace);
    expect(sceneTexts(h)[0]![0]).toEqual(['Alpha first.Alpha last.']);
  });

  it('Backspace after a section break removes the break, not text', () => {
    const m = sampleManuscript();
    m.chapters[0]!.scenes[0]!.blocks.splice(1, 0, { type: 'section_break' });
    const h = harness(m);
    h.cursor(h.at('Alpha last.'));
    h.run(backspace);
    expect(sceneTexts(h)[0]![0]).toEqual(['Alpha first.', 'Alpha last.']);
  });

  it('mid-line Backspace is left to the browser (native deletion)', () => {
    const h = harness();
    h.cursor(h.at('first.', 2));
    expect(h.run(backspace)).toBe(false);
  });
});

describe('selections spanning structure', () => {
  it('delete removes the selected text but keeps every chapter and scene', () => {
    const h = harness();
    const sig = h.signature();
    h.select(h.at('first.'), h.at('Gamma', 2));
    h.run(backspace);
    expect(h.signature()).toBe(sig);
    expect(h.rejected).toBe(0);
    const m = h.model();
    expect(validate(m)).toEqual([]);
    expect(m.chapters[0]!.scenes[0]!.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Alpha ' }] }]);
    // The selection covered the whole name: its text goes, the named scene stays.
    expect(m.chapters[0]!.scenes[1]!.name).toBe('');
    expect(m.chapters[0]!.scenes[1]!.blocks).toEqual([{ type: 'paragraph', content: [] }]);
    expect(m.chapters[1]!.title).toBe('');
    expect(m.chapters[1]!.scenes[0]!.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'mma.' }] }]);
    expect(h.state.selection.from).toBe(h.at('Alpha ', 6));
  });

  it('a raw transaction that deletes across scenes is rejected by the guard', () => {
    const h = harness();
    const before = h.state.doc;
    const tr = h.state.tr.delete(h.at('first.'), h.at('Beta', 2));
    h.state = h.state.apply(tr);
    expect(h.state.doc.eq(before)).toBe(true);
    expect(h.rejected).toBe(1);
  });

  it('Enter over a cross-scene selection clears it and splits, keeping scenes', () => {
    const h = harness();
    const sig = h.signature();
    h.select(h.at('last.'), h.at('Beta', 2));
    h.run(enter);
    expect(h.signature()).toBe(sig);
    expect(sceneTexts(h)[0]![0]).toEqual(['Alpha first.', 'Alpha ', '']);
  });
});

describe('split scene (⌘↵)', () => {
  it('splits at the caret into a new scene with a fresh identity; one undo step', () => {
    const h = harness();
    const before = h.state.doc;
    h.cursor(h.at('first.'));
    h.run(splitScene);
    const m = h.model();
    expect(m.chapters[0]!.scenes.map((s) => s.id).slice(0, 1)).toEqual(['s1']);
    expect(m.chapters[0]!.scenes).toHaveLength(3);
    expect(m.chapters[0]!.scenes[1]!.id).not.toBe('s1');
    expect(sceneTexts(h)[0]).toEqual([['Alpha '], ['first.', 'Alpha last.'], ['Beta only.']]);
    expect(h.state.selection.$from.parent.textContent).toBe('first.');
    expect(h.state.selection.$from.parentOffset).toBe(0);
    h.run(undo);
    expect(h.state.doc.eq(before)).toBe(true);
    h.run(redo);
    expect(h.model().chapters[0]!.scenes).toHaveLength(3);
  });

  it('at the start of a paragraph splits between blocks without leaving an empty line', () => {
    const h = harness();
    h.cursor(h.at('Alpha last.'));
    h.run(splitScene);
    expect(sceneTexts(h)[0]).toEqual([['Alpha first.'], ['Alpha last.'], ['Beta only.']]);
  });

  it('at the end of a scene creates a new scene with an empty first line', () => {
    const h = harness();
    h.cursor(h.at('Alpha last.', 'Alpha last.'.length));
    h.run(splitScene);
    expect(sceneTexts(h)[0]).toEqual([['Alpha first.', 'Alpha last.'], [''], ['Beta only.']]);
    expect(h.state.selection.$from.parent.content.size).toBe(0);
  });

  it('does nothing in a title', () => {
    const h = harness();
    const before = h.state.doc;
    h.cursor(h.at('One', 1));
    h.run(splitScene);
    expect(h.state.doc.eq(before)).toBe(true);
  });
});

describe('marks', () => {
  it('toggles bold on a selection and continues it while typing at the end', () => {
    const h = harness();
    h.select(h.at('Alpha first.'), h.at('Alpha first.', 5));
    h.run(toggleBold);
    h.cursor(h.at('Alpha', 5));
    h.state = h.state.apply(h.state.tr.insertText('!'));
    const runs = h.model().chapters[0]!.scenes[0]!.blocks[0];
    expect(runs).toEqual({ type: 'paragraph', content: [{ text: 'Alpha!', bold: true }, { text: ' first.' }] });
  });

  it('toggles cleanly on a partly formatted selection', () => {
    const h = harness();
    h.select(h.at('Alpha first.'), h.at('Alpha first.', 5));
    h.run(toggleItalic);
    h.select(h.at('Alpha'), h.at('first.', 6));
    h.run(toggleItalic);
    expect(h.model().chapters[0]!.scenes[0]!.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'Alpha first.', italic: true }] });
    h.run(toggleItalic);
    expect(h.model().chapters[0]!.scenes[0]!.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'Alpha first.' }] });
  });

  it('with no selection sets the style for what is typed next', () => {
    const h = harness();
    h.cursor(h.at('first.', 6));
    h.run(toggleBold);
    h.state = h.state.apply(h.state.tr.insertText('X'));
    expect(h.model().chapters[0]!.scenes[0]!.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'Alpha first.' }, { text: 'X', bold: true }] });
  });

  it('never applies marks inside titles', () => {
    const h = harness();
    const before = h.state.doc;
    h.select(h.at('One'), h.at('One', 3));
    expect(h.run(toggleBold)).toBe(true);
    expect(h.state.doc.eq(before)).toBe(true);
  });
});

describe('cold storage', () => {
  it('is unreachable by selection searches', () => {
    const h = harness();
    const end = TextSelection.atEnd(h.state.doc);
    expect(end.$from.parent.textContent).not.toBe('Cut.');
    expect(h.model().coldStorage[0]).toEqual(scene('k1', ['Cut.']));
  });
});
