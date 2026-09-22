import test from 'node:test';
import assert from 'node:assert/strict';
import { launchApp } from './harness.js';

for (const mode of ['editor', 'sprinter']) {
  test(`typewriter glides onto the next line in ${mode}`, async () => {
    const app = await launchApp({fixtureContent: '# Chapter\n\n' + 'A quiet paragraph for writing.\n\n'.repeat(25), extraSettings:{typewriter:true}});
    try {
      if (mode === 'sprinter') await app.client.evaluate(`
        document.querySelector('.mode-tab[data-mode="sprinter"]').click();
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        return true;
      `);
      await app.client.evaluate(`
        const v=document.querySelector('.cm-content').cmTile.root.view;
        const pos=v.state.doc.toString().indexOf('A quiet paragraph') + 'A quiet paragraph for writing.'.length;
        window.BaretextEditor.setCursorPos(v,pos); v.focus();
        return true;
      `);
      await new Promise(r=>setTimeout(r,350));
      await app.client.evaluate(`
        window.motionSamples=[];
        window.motionRecording=true;
        function sample(){ if(!window.motionRecording)return; window.motionSamples.push(document.querySelector('.cm-scroller').scrollTop); requestAnimationFrame(sample); }
        requestAnimationFrame(sample); return true;
      `);
      await app.client.pressEnter();
      await new Promise(r=>setTimeout(r,450));
      const result=await app.client.evaluate(`
        window.motionRecording=false;
        const v=document.querySelector('.cm-content').cmTile.root.view;
        const caret=v.coordsAtPos(v.state.selection.main.head);
        const area=v.scrollDOM.getBoundingClientRect();
        return {samples:window.motionSamples,delta:Math.abs((caret.top+caret.bottom-area.top-area.bottom)/2)};
      `);
      const rounded=[...new Set(result.samples.map(n=>Math.round(n)))];
      assert.ok(rounded.length >= 4, 'line change should animate through intermediate positions: '+JSON.stringify(result));
      assert.ok(result.delta < 8, 'caret must settle at the center: '+JSON.stringify(result));
      assert.deepEqual(app.client.getConsoleMessages().filter(m=>m.type==='error'||m.type==='exception'),[]);
    } finally { await app.close(); }
  });
}
