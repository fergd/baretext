import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchApp } from './harness.js';

describe('Writing rail design handoff', () => {
  let app;
  before(async () => {
    app = await launchApp({ accentTheme: 'dracula', extraSettings: { railCollapsed: true }, fixtureContent: '<!-- BOOK TITLE: Testing the Spirits -->\n\n# Cold Comforts\n\n## Give Me the Bag\n\nThe waiting room had a rhythm to it. The monitor came in on the one, the vent on the two, and somewhere down the hall a cart with a bad wheel kept time badly.\n\n---\n<!-- Fresh as This Snow -->\n\nA short scene.\n\n# A Miracle in Mesa Springs\n\n## Meeting the Father\n\nHe did not look up. A door opened somewhere behind me and two people laughed at something small, and it was the worst sound I had ever heard.\n\n# The end-ish\n\n<!-- COLD STORAGE -->\n\nNotes for another day.' });
    await app.client.evaluate('window.resizeTo(1400, 950); return true;');
    await new Promise(r => setTimeout(r, 400));
  });
  after(async () => { if (app) await app.close(); });
  test('collapsed spine summons a read-only glass preview and pins a flush column', async () => {
    const result = await app.client.evaluate(`
      const spine = document.querySelector('.writing-spine');
      const before = {width: getComputedStyle(document.getElementById('scene-rail')).width, ticks: spine.querySelectorAll('.writing-tick').length};
      spine.dispatchEvent(new MouseEvent('mouseenter'));
      const peek = document.querySelector('.writing-peek');
      return {...before, hidden: peek.hidden, actions: peek.querySelectorAll('.rail-trailing-controls, .rail-cold-storage-section').length};
    `);
    assert.equal(result.width, '0px'); assert.equal(result.ticks, 4); assert.equal(result.hidden, false); assert.equal(result.actions, 0);
    fs.writeFileSync('/tmp/baretext-rail-peek.png', Buffer.from(await app.client.screenshot(), 'base64'));
    await app.client.evaluate(`document.querySelector('.writing-peek .writing-tool').click(); return true;`);
    await new Promise(r=>setTimeout(r,300));
    assert.deepEqual(await app.client.evaluate(`const rail = document.getElementById('scene-rail'); return {width: getComputedStyle(rail).width, radius: getComputedStyle(rail).borderRadius, peek: document.querySelector('.writing-peek').hidden};`), {width:'320px',radius:'0px',peek:true});
    fs.writeFileSync('/tmp/baretext-rail-pinned.png', Buffer.from(await app.client.screenshot(), 'base64'));
  });
  test('chapter-to-scene adjacency has one tight gap, without extra source blank-line height', async () => {
    const result = await app.client.evaluate(`
      const scroller=document.querySelector('.cm-scroller'); scroller.scrollTop=0;
      await new Promise(r=>setTimeout(r,150));
      const heading=document.querySelector('.cm-heading-1');
      const scene=document.querySelector('.cm-heading-2');
      return {gap:scene.getBoundingClientRect().top-heading.getBoundingClientRect().bottom};
    `);
    assert.ok(Math.abs(result.gap-12)<2, JSON.stringify(result));
  });
  test('a named scene also keeps the tight gap into its prose', async () => {
    const result = await app.client.evaluate(`
      const name=document.querySelector('.cm-scene-name-comment');
      let next=name.nextElementSibling;
      while(next && !next.classList.contains('cm-paragraph-line')) next=next.nextElementSibling;
      return next.getBoundingClientRect().top-name.getBoundingClientRect().bottom;
    `);
    assert.ok(Math.abs(result-12)<2, String(result));
  });
  test('scene metadata is replaced in the DOM and focus keeps actions reachable after mouseleave', async () => {
    const result = await app.client.evaluate(`
      const row = document.querySelector('#scene-rail .rail-scene-row');
      const rest = !!row.querySelector('.rail-trailing-meta') && !row.querySelector('.rail-trailing-controls');
      row.dispatchEvent(new MouseEvent('mouseenter'));
      const hover = !row.querySelector('.rail-trailing-meta') && row.querySelectorAll('.rail-trailing-controls button').length === 3;
      row.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
      row.dispatchEvent(new MouseEvent('mouseleave'));
      const focused = !!row.querySelector('.rail-trailing-controls');
      row.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
      return {rest,hover,focused,restored:!!row.querySelector('.rail-trailing-meta')};
    `);
    assert.deepEqual(result,{rest:true,hover:true,focused:true,restored:true});
  });
  test('archive and restore use the existing manuscript move path', async () => {
    await app.client.evaluate(`const row=document.querySelector('#scene-rail .rail-scene-row'); row.dispatchEvent(new MouseEvent('mouseenter')); row.querySelector('.rail-archive-btn').click(); return true;`);
    await new Promise(r=>setTimeout(r,250));
    assert.equal(await app.client.evaluate(`return document.querySelectorAll('#scene-rail .rail-cold-storage-section .rail-scene-row').length;`),2);
    await app.client.evaluate(`const rows=[...document.querySelectorAll('#scene-rail .rail-cold-storage-section .rail-scene-row')]; const row=rows.find(r=>r.textContent.includes('Give Me the Bag')); row.dispatchEvent(new MouseEvent('mouseenter')); row.querySelector('.rail-archive-btn').click(); return true;`);
    await new Promise(r=>setTimeout(r,250));
    assert.equal(await app.client.evaluate(`return document.querySelectorAll('#scene-rail .rail-cold-storage-section .rail-scene-row').length;`),1);
  });
  test('corkboard includes empty chapters and preserves typewriter across its chrome swap', async () => {
    await app.client.evaluate(`document.getElementById('word-count').click(); return true;`);
    await new Promise(r=>setTimeout(r,300));
    await app.client.evaluate(`document.querySelector('.writing-toolbar .rail-corkboard-btn').click(); return true;`);
    await new Promise(r=>setTimeout(r,250));
    const result = await app.client.evaluate(`return {chapters:document.querySelectorAll('.corkboard-chapter').length,add:document.querySelectorAll('.scene-card-new').length,pin:getComputedStyle(document.querySelector('.writing-pin')).display,tabs:getComputedStyle(document.getElementById('mode-switch')).visibility,tw:getComputedStyle(document.getElementById('tw-status-indicator')).display};`);
    assert.deepEqual(result,{chapters:3,add:3,pin:'none',tabs:'hidden',tw:'none'});
    fs.writeFileSync('/tmp/baretext-rail-corkboard.png', Buffer.from(await app.client.screenshot(),'base64'));
    await app.client.evaluate(`document.querySelector('.writing-toolbar .rail-corkboard-btn').click(); return true;`);
    assert.equal(await app.client.evaluate(`return document.getElementById('tw-status-indicator').classList.contains('tw-on');`),true);
  });
  test('toolbar search opens the existing find interface', async () => {
    await app.client.evaluate(`document.querySelector('.writing-search').click(); return true;`);
    assert.notEqual(await app.client.evaluate(`return getComputedStyle(document.querySelector('.find-panel')).display;`),'none');
    assert.deepEqual(app.client.getConsoleMessages().filter(m=>m.type==='error'||m.type==='exception'),[]);
  });
  test('ticks and floating outline rows navigate without pinning, including earlier chapters', async () => {
    await app.client.evaluate(`
      document.querySelector('.writing-search').click();
      document.querySelector('.writing-pin').click();
      return true;
    `);
    await new Promise(r=>setTimeout(r,300));
    const point = await app.client.evaluate(`const r=[...document.querySelectorAll('.writing-tick')].find(b=>b.title.includes('Meeting the Father')).getBoundingClientRect(); return {x:r.left+8,y:r.top+r.height/2};`);
    await app.client.mouseEvent('mouseMoved',point.x,point.y);
    await app.client.mouseEvent('mousePressed',point.x,point.y,1);
    await app.client.mouseEvent('mouseReleased',point.x,point.y,0);
    await new Promise(r=>setTimeout(r,250));
    assert.equal(await app.client.evaluate(`return document.querySelector('#scene-rail .rail-scene-row.active').getAttribute('aria-label');`),'Meeting the Father');
    const result = await app.client.evaluate(`
      document.querySelector('.writing-spine').dispatchEvent(new MouseEvent('mouseenter'));
      const chapters=document.querySelectorAll('.peek-chapter-row').length;
      const first=[...document.querySelectorAll('.peek-scene-row')].find(b=>b.textContent.includes('Fresh as This Snow'));
      first.click();
      return {chapters,active:document.querySelector('#scene-rail .rail-scene-row.active').getAttribute('aria-label'),collapsed:document.documentElement.dataset.railCollapsed};
    `);
    assert.deepEqual(result,{chapters:3,active:'Fresh as This Snow',collapsed:'1'});
    assert.deepEqual(app.client.getConsoleMessages().filter(m=>m.type==='error'||m.type==='exception'),[]);
  });

  // The peek/glass panel was originally spec'd read-only (no hover-action
  // icons) -- the user asked for the same archive/rename/delete hover swap
  // the pinned rail already has, even while un-anchored. These two tests
  // cover that parity: the DOM-swap mechanics, and that each action button
  // actually drives the same manuscript-mutation path the pinned rail uses.
  test('peek rows swap word count for archive/rename/delete on hover, same as the pinned rail', async () => {
    await app.client.evaluate(`
      if (document.documentElement.dataset.railCollapsed !== '1') document.querySelector('.writing-pin').click();
      return true;
    `);
    await new Promise(r=>setTimeout(r,300));
    const result = await app.client.evaluate(`
      document.querySelector('.writing-spine').dispatchEvent(new MouseEvent('mouseenter'));
      const row = [...document.querySelectorAll('.peek-scene-row')].find(r=>r.textContent.includes('Fresh as This Snow'));
      const rest = !!row.querySelector('.peek-dim') && !row.querySelector('.rail-trailing-controls');
      row.dispatchEvent(new MouseEvent('mouseenter'));
      const hover = !row.querySelector('.peek-dim') && row.querySelectorAll('.rail-trailing-controls button').length === 3;
      row.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
      row.dispatchEvent(new MouseEvent('mouseleave'));
      const focused = !!row.querySelector('.rail-trailing-controls');
      row.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
      return {rest,hover,focused,restored:!!row.querySelector('.peek-dim')};
    `);
    assert.deepEqual(result,{rest:true,hover:true,focused:true,restored:true});
    assert.deepEqual(app.client.getConsoleMessages().filter(m=>m.type==='error'||m.type==='exception'),[]);
  });

  test('peek rename and archive drive the same rename/reorder path as the pinned rail', async () => {
    await app.client.evaluate(`
      if (document.documentElement.dataset.railCollapsed !== '1') document.querySelector('.writing-pin').click();
      return true;
    `);
    await new Promise(r=>setTimeout(r,300));
    await app.client.evaluate(`
      document.querySelector('.writing-spine').dispatchEvent(new MouseEvent('mouseenter'));
      const row = [...document.querySelectorAll('.peek-scene-row')].find(r=>r.textContent.includes('Fresh as This Snow'));
      row.dispatchEvent(new MouseEvent('mouseenter'));
      row.querySelector('.rail-edit-btn').click();
      const input = row.querySelector('.inline-rename-input');
      input.value = 'Renamed From Peek';
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));
      return true;
    `);
    await new Promise(r=>setTimeout(r,250));
    assert.equal(await app.client.evaluate(`return !!document.querySelector('#scene-rail .rail-scene-row[aria-label="Renamed From Peek"]');`), true);

    await app.client.evaluate(`
      document.querySelector('.writing-spine').dispatchEvent(new MouseEvent('mouseenter'));
      const row = [...document.querySelectorAll('.peek-scene-row')].find(r=>r.textContent.includes('Renamed From Peek'));
      row.dispatchEvent(new MouseEvent('mouseenter'));
      row.querySelector('.rail-archive-btn').click();
      return true;
    `);
    await new Promise(r=>setTimeout(r,250));
    assert.equal(await app.client.evaluate(`return !!document.querySelector('#scene-rail .rail-cold-storage-section .rail-scene-row[aria-label="Renamed From Peek"]');`), true);
    assert.deepEqual(app.client.getConsoleMessages().filter(m=>m.type==='error'||m.type==='exception'),[]);
  });

});
