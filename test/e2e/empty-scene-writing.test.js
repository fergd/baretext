import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchApp } from './harness.js';
const pause = () => new Promise(r=>setTimeout(r,250));

for (const [label, scene] of [['unnamed','---'], ['named','---\n<!-- New scene -->'], ['heading','## New scene']]) {
  test(`empty ${label} scene before another chapter has a clickable writing line`, async () => {
    const fixtureContent = '# Before\n\nEarlier prose.\n\n# Testing\n\n' + scene + '\n\n# Obituary\n\n## Existing scene\n\nLater prose.\n';
    const app = await launchApp({ fixtureContent });
    try {
      await pause();
      await app.client.evaluate(`document.querySelector('.rail-scene-row[data-ci="1"]').click(); return true;`);
      await pause();
      const target = await app.client.evaluate(`const view=document.querySelector('.cm-content').cmTile.root.view; const pos=view.state.selection.main.head; const r=view.coordsAtPos(pos); return {pos,x:r.left+24,y:(r.top+r.bottom)/2,height:r.bottom-r.top,line:view.state.doc.lineAt(pos).text};`);
      assert.equal(target.line,'');
      assert.ok(target.height >= 14, 'blank writing line must have visible height');
      await app.client.mouseEvent('mouseMoved',target.x,target.y);
      await app.client.mouseEvent('mousePressed',target.x,target.y,1);
      await app.client.mouseEvent('mouseReleased',target.x,target.y,0);
      const result = await app.client.evaluate(`document.execCommand('insertText',false,'A new beginning.'); await new Promise(r=>setTimeout(r,100)); return document.querySelector('.cm-content').cmTile.root.view.state.doc.toString();`);
      assert.equal(result,fixtureContent.slice(0,target.pos)+'A new beginning.'+fixtureContent.slice(target.pos));
      fs.writeFileSync('/tmp/baretext-empty-scene-'+label+'.png',Buffer.from(await app.client.screenshot(),'base64'));
      assert.deepEqual(app.client.getConsoleMessages().filter(m=>m.type==='error'||m.type==='exception'),[]);
    } finally { await app.close(); }
  });
}

test('clicking the empty scene divider focuses its writing line after toolbar focus', async () => {
  const app=await launchApp({fixtureContent:'# Testing\n\n---\n\n# Next\n\nExisting prose.\n'});
  try {
    await pause();
    const point=await app.client.evaluate(`document.querySelector('.rail-scene-row[data-ci="0"]').click(); await new Promise(r=>setTimeout(r,150)); document.querySelector('.writing-pin').focus(); const r=document.querySelector('.cm-scene-break').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};`);
    await app.client.mouseEvent('mouseMoved',point.x,point.y);
    await app.client.mouseEvent('mousePressed',point.x,point.y,1);
    await app.client.mouseEvent('mouseReleased',point.x,point.y,0);
    const text=await app.client.evaluate(`document.execCommand('insertText',false,'Start here.'); await new Promise(r=>setTimeout(r,100)); return document.querySelector('.cm-content').cmTile.root.view.state.doc.toString();`);
    assert.equal(text,'# Testing\n\n---\nStart here.\n# Next\n\nExisting prose.\n');
  } finally { await app.close(); }
});
