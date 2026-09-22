import test from 'node:test';
import assert from 'node:assert/strict';
import { launchApp } from './harness.js';
const pause=()=>new Promise(r=>setTimeout(r,220));
const fixture=Array.from({length:8},(_,i)=>`# Chapter ${i+1}\n\n## Scene ${i+1}\n\n${('Paragraph for scene '+(i+1)+'.\n\n').repeat(30)}`).join('');
for(const typewriter of [false,true]) test(`repeated rail/corkboard navigation and passive clicks stay anchored (typewriter ${typewriter})`, async()=>{
  const app=await launchApp({fixtureContent:fixture,extraSettings:{typewriter}});
  try {
    await pause();
    for(const ci of [6,1,5,0,7,2]) {
      await app.client.evaluate(`document.querySelector('.rail-scene-row[data-ci="${ci}"]').click(); return true;`);
      await pause();
      const result=await app.client.evaluate(`const v=document.querySelector('.cm-content').cmTile.root.view; const p=v.state.selection.main.head; const r=v.coordsAtPos(p), s=v.scrollDOM.getBoundingClientRect(); return {line:v.state.doc.lineAt(p).text,top:r.top,bottom:r.bottom,min:s.top,max:s.bottom,scroll:v.scrollDOM.scrollTop};`);
      assert.equal(result.line,'Paragraph for scene '+(ci+1)+'.');
      assert.ok(result.top>=result.min && result.bottom<=result.max);
      await app.client.evaluate(`document.querySelector('.mode-tab[data-mode="corkboard"]').click(); return true;`);
      await pause();
      await app.client.evaluate(`document.querySelector('.mode-tab[data-mode="editor"]').click(); return true;`);
      await pause();
      const after=await app.client.evaluate(`const v=document.querySelector('.cm-content').cmTile.root.view; return {scroll:v.scrollDOM.scrollTop,line:v.state.doc.lineAt(v.state.selection.main.head).text};`);
      assert.equal(after.line,result.line);
      assert.ok(Math.abs(after.scroll-result.scroll)<4,`return changed viewport by ${after.scroll-result.scroll}`);
    }
    const passive=await app.client.evaluate(`const v=document.querySelector('.cm-content').cmTile.root.view; v.scrollDOM.scrollTop+=170; await new Promise(r=>setTimeout(r,80)); const before=v.scrollDOM.scrollTop; v.scrollDOM.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); v.contentDOM.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true})); await new Promise(r=>setTimeout(r,80)); return {before,after:v.scrollDOM.scrollTop};`);
    assert.ok(Math.abs(passive.after-passive.before)<4,'passive gestures must not recenter');
    assert.deepEqual(app.client.getConsoleMessages().filter(m=>m.type==='error'||m.type==='exception'),[]);
  } finally {await app.close();}
});

test('moving a scene preserves its selection and undo restores the document',async()=>{
 const app=await launchApp({fixtureContent:'# C\n\n## A\n\nAlpha body.\n\n## B\n\nBeta body.'});
 try {
  const result=await app.client.evaluate(`const v=document.querySelector('.cm-content').cmTile.root.view; const api=window.BaretextEditor; const before=api.getDoc(v); const p=before.indexOf('Alpha'); v.dispatch({selection:{anchor:p+5,head:p}}); api.setDoc(v,'# C\\n\\n## B\\n\\nBeta body.\\n\\n## A\\n\\nAlpha body.'); const selection=v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to); const backwards=v.state.selection.main.anchor>v.state.selection.main.head; api.undo(v); return {before,after:api.getDoc(v),selection,backwards};`);
  assert.equal(result.selection,'Alpha');assert.equal(result.backwards,true);assert.equal(result.after,result.before);
 } finally {await app.close();}
});

test('a rail click resolves the current scene after an edit, and selection updates keep row DOM intact', async()=>{
 const app=await launchApp({fixtureContent:'# Chapter\n\n## A\n\nAlpha.\n\n## B\n\nBeta.'});
 try {
  await pause();
  const result=await app.client.evaluate(`const v=document.querySelector('.cm-content').cmTile.root.view; const api=window.BaretextEditor; const row=document.querySelector('.rail-scene-row[data-si="1"]'); const before=api.getDoc(v); api.setDoc(v,before.replace('## A','## Inserted\\n\\nNew text.\\n\\n## A')); row.click(); return v.state.doc.lineAt(v.state.selection.main.head).text;`);
  assert.equal(result,'Beta.');
  await pause();
  const same=await app.client.evaluate(`const row=document.querySelector('.rail-scene-row[data-si="1"]'); const v=document.querySelector('.cm-content').cmTile.root.view; const pos=v.state.doc.toString().indexOf('Alpha.'); v.dispatch({selection:{anchor:pos}}); await new Promise(r=>setTimeout(r,250)); return row===document.querySelector('.rail-scene-row[data-si="1"]') && row.classList.contains('active');`);
  assert.equal(same,true);
 } finally {await app.close();}
});

test('leaving cold storage for a manuscript scene performs the requested jump',async()=>{
 const app=await launchApp({fixtureContent:fixture+'\n<!-- COLD STORAGE -->\n\n---\n\nParked writing.',extraSettings:{typewriter:true}});
 try {
  await pause();
  await app.client.evaluate(`document.querySelector('.rail-scene-row[data-ci="8"]').click(); return true;`);
  await pause();
  await app.client.evaluate(`document.querySelector('.rail-scene-row[data-ci="5"]').click(); return true;`);
  await pause();
  const result=await app.client.evaluate(`const v=document.querySelector('.cm-content').cmTile.root.view; const r=v.coordsAtPos(v.state.selection.main.head),s=v.scrollDOM.getBoundingClientRect();return {line:v.state.doc.lineAt(v.state.selection.main.head).text,cold:window.BaretextEditor.getColdStorageView(v),delta:Math.abs((r.top+r.bottom-s.top-s.bottom)/2)};`);
  assert.equal(result.line,'Paragraph for scene 6.');assert.equal(result.cold,null);assert.ok(result.delta<8);
 } finally {await app.close();}
});
