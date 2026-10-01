import { describe, expect, it } from 'vitest';
import { AllSelection, TextSelection } from 'prosemirror-state';
import { backspace } from '../src';
import { harness } from './helpers';

// sampleManuscript ends with cold storage (k1 "Cut."), which is never shown
// or selectable. Select All must still select the whole manuscript.
describe('select all', () => {
  it('selects the whole manuscript, stopping before cold storage (not collapsing to a caret)', () => {
    const h = harness();
    h.state = h.state.apply(h.state.tr.setSelection(new AllSelection(h.state.doc)));
    const { from, to, empty } = h.state.selection;
    expect(empty).toBe(false);
    expect(h.state.doc.textBetween(from, to, '\n')).toMatch(/^Book[\s\S]*Gamma\.$/);
    expect(h.state.selection).toBeInstanceOf(TextSelection);
  });

  it('then Backspace clears the prose but keeps every chapter, scene and parked scene', () => {
    const h = harness();
    const signature = h.signature();
    h.state = h.state.apply(h.state.tr.setSelection(new AllSelection(h.state.doc)));
    h.run(backspace);
    expect(h.model().chapters.flatMap((c) => c.scenes.flatMap((s) => s.blocks.map((b) => JSON.stringify(b))))).not.toContain('Alpha');
    expect(h.text()).not.toMatch(/Alpha|Beta|Gamma/);
    expect(h.signature()).toBe(signature);
    expect(h.model().coldStorage[0]!.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Cut.' }] }]);
  });

  it('a selection that reaches into cold storage is trimmed, keeping its direction', () => {
    const h = harness();
    const start = h.at('Beta');
    const end = h.state.doc.content.size - 2; // inside cold storage
    h.state = h.state.apply(h.state.tr.setSelection(TextSelection.create(h.state.doc, end, start)));
    const sel = h.state.selection;
    expect(sel.head).toBe(start); // backwards selection stays backwards
    expect(h.state.doc.textBetween(sel.from, sel.to, '\n')).toMatch(/^Beta only\.[\s\S]*Gamma\.$/);
  });
});
