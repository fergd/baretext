import test from 'node:test';
import assert from 'node:assert/strict';
import { launchApp } from './harness.js';
test('rail and corkboard copy scene/chapter without moving the caret or changing the document', async () => {
  const fixtureContent = '# One\n\n## First\n\nAlpha.\n\n## Second\n\nBeta.\n\n# Two\n\nGamma.';
  const app = await launchApp({ fixtureContent });
  try {
    await new Promise(r => setTimeout(r, 350));
    await app.client.evaluate(`window.copied = []; Object.defineProperty(navigator.clipboard, 'writeText', { value: async text => window.copied.push(text), configurable: true }); const row = document.querySelector('.rail-scene-row'); row.focus(); return true;`);
    const before = await app.client.evaluate(`const v=document.querySelector('.cm-content').cmTile.root.view; return v.state.selection.main.head;`);
    await app.client.evaluate(`document.querySelector('.rail-scene-row').showActions(); document.querySelector('.rail-scene-row .copy-scene-btn').click(); document.querySelector('.rail-chapter-row').showActions(); document.querySelector('.rail-chapter-row .copy-chapter-btn').click(); return true;`);
    assert.deepEqual(await app.client.evaluate('return window.copied;'), ['## First\n\nAlpha.', '# One\n\n## First\n\nAlpha.\n\n## Second\n\nBeta.']);
    await app.client.evaluate(`document.querySelector('.rail-corkboard-btn').click(); return true;`);
    await app.client.evaluate(`document.querySelector('#corkboard .copy-scene-btn').click(); document.querySelector('#corkboard .copy-chapter-btn').click(); return true;`);
    const result = await app.client.evaluate(`const v=document.querySelector('.cm-content').cmTile.root.view; return {copied:window.copied,doc:v.state.doc.toString(),cursor:v.state.selection.main.head};`);
    assert.deepEqual(result.copied.slice(2), result.copied.slice(0,2));
    assert.equal(result.doc, fixtureContent);
    assert.equal(result.cursor, before);
    await app.client.evaluate(`Object.defineProperty(navigator.clipboard, 'writeText', {value: async () => {throw new Error('denied');}}); document.querySelector('#corkboard .copy-scene-btn').click(); return true;`);
    assert.match(await app.client.evaluate(`return document.querySelector('#toast').textContent;`), /could not copy scene/);
  } finally { await app.close(); }
});
