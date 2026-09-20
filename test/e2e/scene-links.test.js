import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchApp } from './harness.js';

const fixtureContent = '# One\n\n## A\n\nAlpha prose.\n\n---\n<!-- B -->\n\nBeta prose.\n\n## C\n\nGamma prose.\n\n# Two\n\n## D\n\nDelta prose.\n';
const pause = () => new Promise(r => setTimeout(r, 300));
async function linkFirst(app) {
  await app.client.evaluate(`document.querySelector('.rail-corkboard-btn').click(); document.querySelector('.scene-card .scene-link-btn').click(); document.querySelector('.scene-card[data-ci="0"][data-si="1"]').click(); document.querySelector('.corkboard-back').click(); return true;`);
  await pause();
}
async function railTitles(app) {
  return app.client.evaluate(`return [...document.querySelectorAll('#scene-rail .rail-scene-row')].map(r => r.querySelector('.rail-scene-name').textContent);`);
}
async function drag(app, source, target, offset = 0.5) {
  const rects = await app.client.evaluate(`
    const a = document.querySelector(${JSON.stringify(source)}).getBoundingClientRect();
    const b = document.querySelector(${JSON.stringify(target)}).getBoundingClientRect();
    return {ax:a.left+a.width*.35, ay:a.top+a.height*.65, bx:b.left+b.width*.35, by:b.top+b.height*${offset}};
  `);
  await app.client.realDrag(rects.ax, rects.ay, rects.bx, rects.by);
  await pause();
}

test('linked rail scenes drag together from the second member and survive a cold start', async () => {
  const app = await launchApp({ fixtureContent });
  try {
    await pause();
    const count = await app.client.evaluate(`return document.getElementById('word-count').textContent;`);
    await linkFirst(app);
    assert.equal(await app.client.evaluate(`return document.querySelectorAll('#scene-rail .scene-linked').length;`), 2);
    assert.equal(await app.client.evaluate(`return document.getElementById('word-count').textContent;`), count);
    assert.equal(await app.client.evaluate(`return document.querySelector('.cm-content').innerText.includes('SCENE LINK');`), false);
    fs.writeFileSync('/tmp/baretext-scene-links-rail.png', Buffer.from(await app.client.screenshot(), 'base64'));
    await drag(app, '.rail-scene-row[data-ci="0"][data-si="1"]', '.rail-chapter-row[data-ci="1"]');
    assert.deepEqual(await railTitles(app), ['C', 'D', 'A', 'B']);
    await pause();
    assert.ok(fs.readFileSync(app.fixturePath, 'utf8').includes('<!-- SCENE GROUP:'));
    await app.restart();
    await pause();
    assert.deepEqual(await railTitles(app), ['C', 'D', 'A', 'B']);
    assert.equal(await app.client.evaluate(`return document.querySelectorAll('#scene-rail .scene-linked').length;`), 2);
    assert.deepEqual(app.client.getConsoleMessages().filter(m => m.type === 'error' || m.type === 'exception'), []);
  } finally { await app.close(); }
});

test('corkboard links, moves, unlinks and undoes groups without leaving the board', async () => {
  const app = await launchApp({ fixtureContent });
  try {
    await pause();
    await app.client.evaluate(`window.resizeTo(1500, 950); document.querySelector('.rail-corkboard-btn').click(); return true;`);
    await pause();
    await app.client.evaluate(`document.querySelector('.scene-card .scene-link-btn').click(); document.querySelector('.scene-card[data-ci="0"][data-si="1"]').click(); return true;`);
    await pause();
    assert.equal(await app.client.evaluate(`return document.querySelectorAll('.scene-card.scene-linked').length;`), 2);
    assert.ok(await app.client.evaluate(`return document.querySelector('.scene-card').getBoundingClientRect().width >= 340;`));
    fs.writeFileSync('/tmp/baretext-scene-links-corkboard.png', Buffer.from(await app.client.screenshot(), 'base64'));
    const oldPath = await app.client.evaluate(`return document.querySelector('.scene-connectors path').getAttribute('d');`);
    await app.client.evaluate(`window.resizeTo(700, 950); return true;`);
    await pause();
    const wrapped = await app.client.evaluate(`const path = document.querySelector('.scene-connectors path'); const point = path.getPointAtLength(path.getTotalLength()); const canvas = document.querySelector('.corkboard-canvas').getBoundingClientRect(); const card = document.querySelector('.scene-card[data-si="1"]').getBoundingClientRect(); return { d:path.getAttribute('d'), distance:Math.abs(point.y + canvas.top - card.top), pointerEvents:getComputedStyle(path).pointerEvents };`);
    assert.notEqual(wrapped.d, oldPath);
    assert.ok(wrapped.distance < 1);
    assert.equal(wrapped.pointerEvents, 'none');
    fs.writeFileSync('/tmp/baretext-connectors-wrapped.png', Buffer.from(await app.client.screenshot(), 'base64'));
    await app.client.evaluate(`window.resizeTo(1500, 950); return true;`);
    await pause();
    await drag(app, '.scene-card[data-ci="0"][data-si="1"] .scene-card-synopsis', '.scene-card[data-ci="1"][data-si="0"]');
    assert.deepEqual(await railTitles(app), ['C', 'A', 'B', 'D']);
    await app.client.evaluate(`document.querySelector('.scene-card[data-ci="1"][data-si="0"] .scene-unlink-btn').click(); return true;`);
    assert.equal(await app.client.evaluate(`return document.querySelectorAll('.scene-card.scene-linked').length;`), 0);
    assert.equal(await app.client.evaluate(`return document.querySelectorAll('.scene-connectors path').length;`), 0);
    await app.client.evaluate(`document.querySelector('.corkboard-tool-btn').click(); return true;`);
    await pause();
    assert.equal(await app.client.evaluate(`return document.querySelectorAll('.scene-card.scene-linked').length;`), 2, await app.client.evaluate(`return window.BaretextEditor.getDoc(document.querySelector('.cm-content').cmTile.root.view);`));
    assert.equal(await app.client.evaluate(`return document.getElementById('app').classList.contains('corkboard-open');`), true);
    assert.deepEqual(app.client.getConsoleMessages().filter(m => m.type === 'error' || m.type === 'exception'), []);
  } finally { await app.close(); }
});

test('keyboard reordering preserves groups and outline linking stays on the corkboard', async () => {
  const app = await launchApp({ fixtureContent });
  try {
    await pause();
    await linkFirst(app);
    await app.client.evaluate(`const row = document.querySelector('.rail-scene-row[data-si="1"]'); row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', altKey:true, bubbles:true, cancelable:true})); return true;`);
    assert.deepEqual(await railTitles(app), ['C', 'A', 'B', 'D']);
    await app.client.evaluate(`document.querySelector('.writing-pin').click(); document.querySelector('.writing-spine').dispatchEvent(new MouseEvent('mouseenter')); return true;`);
    const result = await app.client.evaluate(`return { linked: document.querySelectorAll('#scene-rail .scene-linked').length, actions: document.querySelectorAll('#scene-rail .scene-link-btn, .writing-peek .scene-link-btn').length };`);
    assert.deepEqual(result, { linked: 2, actions: 0 });
  } finally { await app.close(); }
});

test('Link enters whole-card selection, supports distant targets and cancels without edits', async () => {
  const app = await launchApp({ fixtureContent });
  try {
    await pause();
    await app.client.evaluate(`window.resizeTo(1500,950); document.querySelector('.rail-corkboard-btn').click(); return true;`);
    await pause();
    await app.client.evaluate(`document.querySelector('.scene-card[data-ci="1"] .scene-link-btn').click(); return true;`);
    assert.deepEqual(await app.client.evaluate(`return {choices:document.querySelectorAll('.link-candidate').length, origins:document.querySelectorAll('.link-origin').length, breadcrumb:getComputedStyle(document.querySelector('.writing-breadcrumb')).display, draggable:document.querySelector('.link-candidate').draggable};`), {choices:3,origins:1,breadcrumb:'none',draggable:false});
    fs.writeFileSync('/tmp/baretext-link-selection.png', Buffer.from(await app.client.screenshot(), 'base64'));
    await app.client.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); return true;`);
    assert.equal(await app.client.evaluate(`return document.getElementById('app').classList.contains('corkboard-open') && !document.querySelector('.scene-link-prompt');`), true);
    assert.deepEqual(await railTitles(app), ['A','B','C','D']);
    await app.client.evaluate(`document.querySelector('.scene-card[data-ci="1"] .scene-link-btn').click(); document.querySelector('.scene-card[data-ci="0"][data-si="0"] .scene-card-synopsis').click(); return true;`);
    assert.deepEqual(await railTitles(app), ['A','B','C','D']);
    assert.equal(await app.client.evaluate(`return document.querySelectorAll('.scene-card.scene-linked').length;`),2);
    await drag(app, '.scene-card[data-ci="1"] .scene-card-synopsis', '.scene-card[data-ci="0"][data-si="2"]');
    assert.deepEqual(await railTitles(app), ['B','A','D','C']);
    assert.deepEqual(app.client.getConsoleMessages().filter(m => m.type === 'error' || m.type === 'exception'), []);
  } finally { await app.close(); }
});

test('creating a scene after a linked scene keeps the original pair and exposes a working footer Unlink', async () => {
  const linkedFixture = fixtureContent.replace('Alpha prose.', 'Alpha prose.\n<!-- SCENE GROUP: group-1 -->').replace('Gamma prose.', 'Gamma prose.\n<!-- SCENE GROUP: group-1 -->');
  const app = await launchApp({ fixtureContent: linkedFixture, extraSettings: { lastCursorPos: linkedFixture.indexOf('Alpha prose.') + 'Alpha prose.'.length } });
  try {
    await pause();
    await app.client.evaluate(`const cm = document.querySelector('.cm-content'); cm.focus(); window.BaretextEditor.insertSceneBreak(cm.cmTile.root.view); cm.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true})); return true;`);
    await pause();
    const linkedTitles = () => app.client.evaluate(`return [...document.querySelectorAll('#scene-rail .scene-linked .rail-scene-name')].map(n=>n.textContent);`);
    assert.deepEqual(await linkedTitles(), ['A','C']);
    assert.equal((await railTitles(app)).length,5, JSON.stringify(app.client.getConsoleMessages()) + fs.readFileSync(app.fixturePath, 'utf8'));
    await app.client.evaluate(`document.querySelector('.rail-corkboard-btn').click(); return true;`);
    await pause();
    await app.client.evaluate(`document.querySelector('.corkboard-tool-btn').click(); return true;`);
    assert.equal((await railTitles(app)).length,4);
    assert.deepEqual(await linkedTitles(), ['A','C']);
    await app.client.evaluate(`document.querySelectorAll('.corkboard-tool-btn')[1].click(); return true;`);
    assert.equal((await railTitles(app)).length,5);
    assert.deepEqual(await linkedTitles(), ['A','C']);
    const point = await app.client.evaluate(`const button = document.querySelector('.scene-link-label .scene-unlink-btn'); button.scrollIntoView({block:'center'}); const r = button.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};`);
    fs.writeFileSync('/tmp/baretext-unlink-footer.png', Buffer.from(await app.client.screenshot(),'base64'));
    await app.client.mouseEvent('mouseMoved',point.x,point.y);
    await app.client.mouseEvent('mousePressed',point.x,point.y,1);
    await app.client.mouseEvent('mouseReleased',point.x,point.y,0);
    await pause();
    assert.deepEqual(await linkedTitles(), []);
    assert.equal(await app.client.evaluate(`return document.querySelectorAll('.scene-connectors path').length;`),0);
    assert.deepEqual(app.client.getConsoleMessages().filter(m=>m.type==='error'||m.type==='exception'),[]);
  } finally { await app.close(); }
});
