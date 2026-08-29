import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { safeCaretLine } from '../../src/editor/scene-breaks.js';

function docFor(text) {
  return EditorState.create({ doc: text }).doc;
}

test('clicking an unnamed marker line lands on the first real content line after it', () => {
  const doc = docFor('# One\n\nFirst.\n\n---\n\nSecond.');
  const markerLineNum = doc.lineAt(doc.toString().indexOf('---')).number;
  const target = safeCaretLine(doc, markerLineNum);
  assert.equal(doc.line(target).text, 'Second.');
});

test('clicking a named marker\'s comment line lands on the first real content line after it', () => {
  const doc = docFor('# One\n\nFirst.\n\n---\n<!-- Confrontation -->\n\nSecond.');
  const commentLineNum = doc.lineAt(doc.toString().indexOf('<!--')).number;
  const target = safeCaretLine(doc, commentLineNum);
  assert.equal(doc.line(target).text, 'Second.');
});

test('clicking a named marker\'s OWN line (not the comment) also lands past the whole preamble', () => {
  const doc = docFor('# One\n\nFirst.\n\n---\n<!-- Confrontation -->\n\nSecond.');
  const markerLineNum = doc.lineAt(doc.toString().indexOf('---')).number;
  const target = safeCaretLine(doc, markerLineNum);
  assert.equal(doc.line(target).text, 'Second.');
});

test('clicking a still-empty scene\'s marker lands on the blank line right after it, not on the marker', () => {
  const doc = docFor('# One\n\nFirst.\n\n---\n\n');
  const markerLineNum = doc.lineAt(doc.toString().indexOf('---')).number;
  const target = safeCaretLine(doc, markerLineNum);
  assert.equal(doc.line(target).text, '');
  assert.notEqual(doc.line(target).text.trim(), '---');
});

test('clicking a still-empty NAMED scene\'s comment lands on the blank line right after it', () => {
  const doc = docFor('# One\n\nFirst.\n\n---\n<!-- New Scene -->\n\n');
  const commentLineNum = doc.lineAt(doc.toString().indexOf('<!--')).number;
  const target = safeCaretLine(doc, commentLineNum);
  assert.equal(doc.line(target).text, '');
});

test('does not overshoot past this scene into the next chapter\'s heading', () => {
  const doc = docFor('# One\n\nFirst.\n\n---\n\n# Two\n\nMore.');
  const markerLineNum = doc.lineAt(doc.toString().indexOf('---')).number;
  const target = safeCaretLine(doc, markerLineNum);
  assert.equal(doc.line(target).text, '');
  assert.notEqual(doc.line(target).text, '# Two');
});
