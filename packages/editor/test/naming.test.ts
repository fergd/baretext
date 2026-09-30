import { describe, expect, it } from 'vitest';
import { undo } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';
import { backspace, docToModel, nameScene, nameSceneAt, schema } from '../src';
import { harness } from './helpers';

// sampleManuscript: c1 "One" → s1 (unnamed: "Alpha first.", "Alpha last."), s2 "Two" ("Beta only.");
// c2 "Next" → s3 (unnamed: "Gamma."); cold storage k1.
const names = (h: ReturnType<typeof harness>) => h.model().chapters.map((c) => c.scenes.map((s) => s.name));
const head = (h: ReturnType<typeof harness>) => h.state.selection.$head;
const scenePos = (h: ReturnType<typeof harness>, text: string) => {
  const $p = h.state.doc.resolve(h.at(text));
  for (let d = $p.depth; d > 0; d--) if ($p.node(d).type === schema.nodes.scene) return $p.before(d);
  throw new Error('no scene');
};

describe('naming scenes', () => {
  it('Name scene on an unnamed scene adds an empty name with the caret in it', () => {
    const h = harness();
    h.cursor(h.at('Alpha last.', 3));
    expect(h.run(nameScene)).toBe(true);
    expect(names(h)).toEqual([['', 'Two'], [null]]);
    expect(head(h).parent.type).toBe(schema.nodes.scene_heading);
    expect(h.rejected).toBe(0);
    // Typing names it; the prose is untouched.
    h.state = h.state.apply(h.state.tr.insertText('Dawn'));
    expect(names(h)).toEqual([['Dawn', 'Two'], [null]]);
    expect(docToModel(h.state.doc).chapters[0]!.scenes[0]!.blocks).toHaveLength(2);
  });

  it('on a named scene it selects the name (rename)', () => {
    const h = harness();
    h.cursor(h.at('Beta'));
    h.run(nameScene);
    const { from, to } = h.state.selection;
    expect(h.state.doc.textBetween(from, to)).toBe('Two');
    h.state = h.state.apply(h.state.tr.insertText('Dusk'));
    expect(names(h)).toEqual([[null, 'Dusk'], [null]]);
  });

  it('names a given scene (clicking its ornament), wherever the caret is', () => {
    const h = harness();
    h.cursor(h.at('Alpha'));
    h.run(nameSceneAt(scenePos(h, 'Gamma.')));
    expect(names(h)).toEqual([[null, 'Two'], ['']]);
    expect(head(h).parent.type).toBe(schema.nodes.scene_heading);
  });

  it('Backspace in an empty name turns it back into an unnamed scene', () => {
    const h = harness();
    h.cursor(h.at('Gamma.'));
    h.run(nameScene);
    h.run(backspace);
    expect(names(h)).toEqual([[null, 'Two'], [null]]);
    expect(head(h).parent.textContent).toBe('Gamma.');
    expect(head(h).parentOffset).toBe(0);
    // In a name with text, Backspace is left to ordinary text deletion.
    h.cursor(h.at('Two', 3));
    expect(h.run(backspace)).toBe(false);
    expect(names(h)).toEqual([[null, 'Two'], [null]]);
  });

  it('leaving a name empty drops it; leaving a filled name keeps it', () => {
    const h = harness();
    h.cursor(h.at('Gamma.'));
    h.run(nameScene);
    h.cursor(h.at('Alpha'));
    expect(names(h)).toEqual([[null, 'Two'], [null]]);
    expect(h.state.selection.$head.parent.textContent).toBe('Alpha first.');

    h.cursor(h.at('Gamma.'));
    h.run(nameScene);
    h.state = h.state.apply(h.state.tr.insertText('Night'));
    h.cursor(h.at('Alpha'));
    expect(names(h)).toEqual([[null, 'Two'], ['Night']]);
  });

  it('is undoable, and never names outside a chapter scene', () => {
    const h = harness();
    const original = h.state.doc;
    h.cursor(h.at('Gamma.'));
    h.run(nameScene);
    h.run(undo);
    expect(h.state.doc.eq(original)).toBe(true);

    h.cursor(h.at('Book')); // book title
    expect(h.run(nameScene)).toBe(false);
    let coldScene = -1;
    h.state.doc.forEach((n, off) => { if (n.type === schema.nodes.cold_storage) coldScene = off + 1; });
    expect(h.run(nameSceneAt(coldScene))).toBe(false);
    expect(h.state.doc.eq(original)).toBe(true);
    expect(h.rejected).toBe(0);
  });
});
