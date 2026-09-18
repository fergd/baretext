import test from 'node:test';
import assert from 'node:assert/strict';
import { launchApp } from './harness.js';

for (const typewriter of [false, true]) {
  test(`Enter leaves a visible writable paragraph beside headings (typewriter ${typewriter})`, async () => {
    const fixtureContent = '# Chapter\n\n## Scene\n\nFirst paragraph.\n\n# Next chapter\n\nOther writing.';
    const app = await launchApp({ fixtureContent, mode: 'editor', extraSettings: { typewriter } });
    try {
      for (const anchor of ['## Scene', 'First paragraph.', 'Fir', '# Next chapter']) {
        const before = await app.client.evaluate(`
          const view = document.querySelector('.cm-content').cmTile.root.view;
          const doc = view.state.doc.toString();
          const pos = doc.indexOf(${JSON.stringify(anchor)}) + ${anchor.length};
          window.BaretextEditor.setCursorPos(view, pos); view.focus();
          return { doc, pos };
        `);
        await app.client.pressEnter();
        await new Promise(r => setTimeout(r, 100));
        const blank = await app.client.evaluate(`
          const v = document.querySelector('.cm-content').cmTile.root.view;
          const pos = v.state.selection.main.head;
          const block = v.lineBlockAt(pos);
          return { doc: v.state.doc.toString(), pos, height: block.height };
        `);
        assert.equal(blank.doc, before.doc.slice(0, before.pos) + '\n' + before.doc.slice(before.pos));
        assert.equal(blank.pos, before.pos + 1);
        assert.ok(blank.height >= 14, 'Enter must create a visible text line, not a hidden spacer');
        await app.client.insertText('A fresh paragraph.');
        await new Promise(r => setTimeout(r, 100));
        const after = await app.client.evaluate(`return document.querySelector('.cm-content').cmTile.root.view.state.doc.toString();`);
        assert.equal(after, before.doc.slice(0, before.pos) + '\nA fresh paragraph.' + before.doc.slice(before.pos));
      }
      assert.deepEqual(app.client.getConsoleMessages().filter(m => m.type === 'error' || m.type === 'exception'), []);
    } finally { await app.close(); }
  });
}
