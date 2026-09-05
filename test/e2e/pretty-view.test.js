import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchApp } from './harness.js';

const fixtureContent = `# Pretty Title

An ordinary anchor paragraph keeps the page steady.

This has **bold words**, *italic words*, \`code words\`, and a [visible link](https://example.com/path).

- A bullet item
1. An ordered item

## Last Scene

The editable ending is where a writer naturally keeps typing.
`;

describe('Pretty and Markdown editing surfaces', () => {
  let app;

  before(async () => {
    app = await launchApp({ fixtureContent, mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  async function selectWithFind(text) {
    return app.client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'f', metaKey: true, bubbles: true, cancelable: true,
      }));
      await new Promise(r => setTimeout(r, 30));
      const input = document.querySelector('.find-input');
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true,
      }));
      await new Promise(r => setTimeout(r, 50));
      return true;
    `);
  }

  async function toggleView() {
    return app.client.evaluate(`
      const content = document.querySelector('.cm-content');
      content.focus();
      content.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'm', code: 'KeyM', metaKey: true, shiftKey: true,
        bubbles: true, cancelable: true,
      }));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.getElementById('editor-host').dataset.editorView;
    `);
  }

  test('Pretty view never changes its text or geometry when the caret moves', async () => {
    await selectWithFind('ordinary anchor');
    const before = await app.client.evaluate(`
      const content = document.querySelector('.cm-content');
      const lines = [...content.querySelectorAll('.cm-line')];
      return {
        mode: document.getElementById('editor-host').dataset.editorView,
        text: content.innerText,
        heights: lines.map(line => line.getBoundingClientRect().height),
        scrollHeight: document.querySelector('.cm-scroller').scrollHeight,
      };
    `);

    await selectWithFind('Pretty Title');
    const after = await app.client.evaluate(`
      const content = document.querySelector('.cm-content');
      const lines = [...content.querySelectorAll('.cm-line')];
      return {
        text: content.innerText,
        heights: lines.map(line => line.getBoundingClientRect().height),
        scrollHeight: document.querySelector('.cm-scroller').scrollHeight,
      };
    `);

    assert.equal(before.mode, 'pretty');
    assert.equal(after.text, before.text);
    assert.deepEqual(after.heights, before.heights);
    assert.equal(after.scrollHeight, before.scrollHeight);
    assert.ok(!after.text.includes('# Pretty Title'));
    assert.ok(!after.text.includes('**'));
    assert.ok(!after.text.includes('https://example.com/path'));
  });

  test('Markdown view exposes source and returning to Pretty conceals it again', async () => {
    assert.equal(await toggleView(), 'markdown');
    const markdown = await app.client.evaluate(`return document.querySelector('.cm-content').innerText;`);
    assert.ok(markdown.includes('# Pretty Title'));
    assert.ok(markdown.includes('**bold words**'));
    assert.ok(markdown.includes('[visible link](https://example.com/path)'));

    assert.equal(await toggleView(), 'pretty');
    const pretty = await app.client.evaluate(`return document.querySelector('.cm-content').innerText;`);
    assert.ok(pretty.includes('Pretty Title'));
    assert.ok(!pretty.includes('# Pretty Title'));
    assert.ok(!pretty.includes('**'));
  });

  test('typing in Pretty edits the source without stripping its Markdown', async () => {
    const point = await app.client.evaluate(`
      const lines = [...document.querySelectorAll('.cm-line')];
      const line = lines.find(candidate => candidate.textContent.includes('naturally keeps typing'));
      line.scrollIntoView({ block: 'center' });
      await new Promise(r => requestAnimationFrame(r));
      const rect = line.getBoundingClientRect();
      const textNode = [...line.childNodes].find(node => node.nodeType === Node.TEXT_NODE) || line.lastChild;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const textRect = range.getBoundingClientRect();
      return { x: textRect.right - 1, y: textRect.top + textRect.height / 2 };
    `);
    await app.client.mouseEvent('mousePressed', point.x, point.y, 1);
    await app.client.mouseEvent('mouseReleased', point.x, point.y, 0);
    const editResult = await app.client.evaluate(`
      const content = document.querySelector('.cm-content');
      const activeBefore = document.activeElement === content;
      const inserted = document.execCommand('insertText', false, ' More writing.');
      await new Promise(r => setTimeout(r, 500));
      return { activeBefore, inserted, text: content.innerText, selection: window.getSelection().toString() };
    `);

    const deadline = Date.now() + 5000;
    while (!fs.readFileSync(app.fixturePath, 'utf8').includes(' More writing.') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const saved = fs.readFileSync(app.fixturePath, 'utf8');
    assert.equal(editResult.activeBefore, true);
    assert.equal(editResult.inserted, true);
    assert.ok(saved.includes(' More writing.'));
    assert.ok(saved.includes('**bold words**'));
    assert.ok(saved.includes('[visible link](https://example.com/path)'));

    assert.equal(await toggleView(), 'markdown');
    const markdown = await app.client.evaluate(`return document.querySelector('.cm-content').innerText;`);
    assert.ok(markdown.includes('**bold words**'));
    assert.ok(markdown.includes(' More writing.'));
    assert.equal(await toggleView(), 'pretty');
  });
});
