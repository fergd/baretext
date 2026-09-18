import test from 'node:test';
import assert from 'node:assert/strict';
import { textToCopy } from '../../src/features/scene-nav/copy.js';
import { getOutline } from '../../src/editor/outline.js';
import { getManuscript } from '../../src/features/scene-nav/model.js';
import { makeView } from './helpers/make-view.js';
globalThis.window = { BaretextEditor: { getOutline, getDoc: v => v.state.doc.toString() } };
const doc = '<!-- BOOK TITLE: Book -->\n\n# One\n\nIntro.\n\n---\n<!-- Named -->\n\n**Scene text.**\n<!-- SCENE GROUP: group-1 -->\n\n# Two\n\nOther chapter.\n\n<!-- COLD STORAGE -->\n\n---\n\nCut text.';
const chapters = getManuscript(makeView(doc));
test('copy scene includes its title and formatting without private metadata or its neighbour', () => {
  assert.equal(textToCopy(doc, chapters, 0, 1), '## Named\n\n**Scene text.**');
});
test('copy chapter includes every scene but excludes the next chapter and cold storage', () => {
  assert.equal(textToCopy(doc, chapters, 0), '# One\n\nIntro.\n\n---\n## Named\n\n**Scene text.**');
  assert.equal(textToCopy(doc, chapters, 1), '# Two\n\nOther chapter.');
});
test('copy works for cold storage, empty chapters, and untitled opening chapters', () => {
  assert.equal(textToCopy(doc, chapters, 2, 0), 'Cut text.');
  for (const text of ['# Empty\n\n# Next\nText', '<!-- BOOK TITLE: Book -->\n\nOpening text.']) {
    const model = getManuscript(makeView(text));
    assert.equal(textToCopy(text, model, 0), text.startsWith('#') ? '# Empty' : 'Opening text.');
  }
});
