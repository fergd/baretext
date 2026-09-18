import test from 'node:test';
import assert from 'node:assert/strict';
import { launchApp } from './harness.js';

test('sprints return to Editor on cancel, manual end, and timer completion', async () => {
  const fixtureContent = '# Chapter\n\nWriting to review.';
  const app = await launchApp({fixtureContent, mode:'sprinter'});
  try {
    assert.equal(await app.client.evaluate(`return document.documentElement.dataset.mode;`), 'editor');
    await app.client.evaluate(`window.sprintTicks=[]; const original=window.setInterval; window.setInterval=(fn, ms, ...args)=>{ if(ms===1000) window.sprintTicks.push(fn); return original(fn,ms,...args); }; return true;`);
    for (const action of ['cancel','end','complete']) {
      await app.client.evaluate(`document.querySelector('.mode-tab[data-mode="sprinter"]').click(); return true;`);
      assert.equal(await app.client.evaluate(`return document.querySelector('.sprint-chip-status') === null;`),true);
      if (action === 'cancel') {
        await app.client.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); return true;`);
      } else {
        await app.client.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); return true;`);
        assert.equal(await app.client.evaluate(`return document.documentElement.dataset.mode;`),'sprinter');
        if (action === 'end') {
          await app.client.evaluate(`[...document.querySelectorAll('.sprint-pill')].find(b=>b.textContent==='end').click(); return true;`);
        } else {
          await app.client.evaluate(`const tick=window.sprintTicks.at(-1); for(let i=0;i<1500;i++) tick(); return true;`);
        }
      }
      const result=await app.client.evaluate(`const v=document.querySelector('.cm-content').cmTile.root.view; return {mode:document.documentElement.dataset.mode,text:v.state.doc.toString(),panel:!!document.querySelector('.sprint-panel')};`);
      assert.equal(result.mode,'editor',action);
      assert.equal(result.text,fixtureContent);
      assert.equal(result.panel,false);
    }
    assert.deepEqual(app.client.getConsoleMessages().filter(m=>m.type==='error'||m.type==='exception'),[]);
  } finally { await app.close(); }
});
