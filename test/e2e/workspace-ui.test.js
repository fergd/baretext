import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchApp } from './harness.js';

test('workspace tabs, contextual controls, and focused sprint states', async () => {
  const app = await launchApp({ fixtureContent: '<!-- BOOK TITLE: The Quiet Hours -->\n\n# A place to begin\n\n## Before the rain\n\nThe street was quiet. Light settled across the desk, and she began to write.\n\n---\n\nAnother scene waits here.', extraSettings: { railCollapsed: true } });
  const evaluate = code => app.client.evaluate(code);
  const shot = async name => {
    await new Promise(r=>setTimeout(r,180));
    fs.writeFileSync(`/tmp/baretext-ui-${name}.png`, Buffer.from(await app.client.screenshot(), 'base64'));
  };
  try {
    await evaluate(`window.resizeTo(1100,800); await new Promise(r=>setTimeout(r,300)); document.querySelector('.cm-scroller').scrollTop=0; return true;`);
    const initial = await evaluate(`
      const tabs=[...document.querySelectorAll('.mode-tab')];
      return {labels:tabs.map(b=>b.textContent),top:document.getElementById('mode-switch').closest('nav')?.id,history:!!document.querySelector('.corkboard-toolbar'),finder:document.getElementById('file-name').textContent};
    `);
    assert.deepEqual(initial, {labels:['Manuscript','Sprinter','Corkboard','Notes'],top:'workspace-bar',history:false,finder:'Show in Finder'});
    await shot('manuscript');
    await evaluate(`document.getElementById('tw-status-indicator').click(); document.querySelector('[data-mode="corkboard"].mode-tab').click(); await new Promise(r=>setTimeout(r,150)); return true;`);
    assert.deepEqual(await evaluate(`return {selected:document.querySelector('.mode-tab[aria-selected="true"]').dataset.mode, views:document.querySelectorAll('#context-view-controls button').length, tw:getComputedStyle(document.getElementById('tw-status-indicator')).display};`), {selected:'corkboard',views:2,tw:'none'});
    await shot('corkboard');
    await evaluate(`document.querySelector('#context-view-controls button').click(); return true;`);
    assert.ok(await evaluate(`return !!document.querySelector('.outline-table');`));
    await shot('outline');
    await evaluate(`document.querySelector('.mode-tab[data-mode="editor"]').click(); document.getElementById('hide-ui-toggle').click(); return true;`);
    assert.deepEqual(await evaluate(`return {tabs:getComputedStyle(document.getElementById('workspace-bar')).display,reveal:getComputedStyle(document.getElementById('reveal-ui')).display,tw:document.getElementById('tw-status-indicator').getAttribute('aria-pressed')};`), {tabs:'none',reveal:'flex',tw:'true'});
    await evaluate(`document.getElementById('reveal-ui').click(); document.querySelector('.mode-tab[data-mode="sprinter"]').click(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); return true;`);
    assert.deepEqual(await evaluate(`return {tabs:getComputedStyle(document.getElementById('workspace-bar')).display,panel:getComputedStyle(document.querySelector('.sprint-panel')).display,status:document.querySelector('.sprint-status').textContent};`), {tabs:'none',panel:'none',status:'Sprinting…'});
    await shot('sprinting');
    await evaluate(`document.querySelector('.sprint-reveal').click(); return true;`);
    assert.deepEqual(await evaluate(`return {tabs:getComputedStyle(document.getElementById('workspace-bar')).display,status:document.querySelector('.sprint-status').textContent};`), {tabs:'flex',status:'Sprinting paused…'});
    await shot('paused');
    const delta = await evaluate(`const v=document.querySelector('.cm-content').cmTile.root.view; const caret=v.coordsAtPos(v.state.selection.main.head); const area=v.scrollDOM.getBoundingClientRect(); return Math.abs((caret.top+caret.bottom-area.top-area.bottom)/2);`);
    assert.ok(delta < 8, 'paused sprint keeps its caret centered: ' + delta);
    await evaluate(`document.querySelector('.mode-tab[data-mode="corkboard"]').click(); document.querySelector('.mode-tab[data-mode="sprinter"]').click(); return true;`);
    assert.equal(await evaluate(`return document.querySelector('.sprint-status').textContent;`), 'Sprinting paused…');
    await evaluate(`document.querySelector('.sprint-status').click(); return true;`);
    await evaluate(`document.querySelector('.sprint-reveal').click(); document.querySelector('.sprint-status').click(); return true;`);
    assert.equal(await evaluate(`return getComputedStyle(document.querySelector('.sprint-panel')).display;`),'block');
    await evaluate(`[...document.querySelectorAll('.sprint-pill')].find(b=>b.textContent==='end').click(); window.resizeTo(500,700); await new Promise(r=>setTimeout(r,150)); return true;`);
    assert.equal(await evaluate(`return document.documentElement.dataset.mode;`),'editor');
    const bounds=await evaluate(`const bar=document.getElementById('statusbar'); return {scroll:bar.scrollWidth,width:bar.clientWidth};`);
    assert.ok(bounds.scroll <= bounds.width,JSON.stringify(bounds));
    await shot('narrow');
    assert.deepEqual(app.client.getConsoleMessages().filter(m=>m.type==='error'||m.type==='exception'),[]);
  } finally { await app.close(); }
});
