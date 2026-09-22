import test from 'node:test';
import assert from 'node:assert/strict';
import { launchApp } from './harness.js';
const pause = () => new Promise(r=>setTimeout(r,350));
const fixtureContent = '# First\n\n## Opening\n\nFirst prose.\n\n' + ('More paragraphs for scrolling.\n\n'.repeat(30)) + '# Second\n\n## Later\n\nLater prose.\n\n' + ('More ending prose.\n\n'.repeat(25));

async function centered(app) {
  await pause();
  const delta = await app.client.evaluate(`const view = document.querySelector('.cm-content').cmTile.root.view; const r = view.coordsAtPos(view.state.selection.main.head); const scroller = document.querySelector('.cm-scroller').getBoundingClientRect(); return Math.abs((r.top+r.bottom)/2 - (scroller.top+scroller.bottom)/2);`);
  assert.ok(delta < 8, 'cursor is centered, delta=' + delta);
}

test('typewriter centers chapter, scene, floating outline and corkboard navigation', async () => {
  const app = await launchApp({ fixtureContent, extraSettings: { typewriter:true } });
  try {
    await pause();
    await app.client.evaluate(`document.querySelector('.rail-scene-row[data-ci="1"]').click(); return true;`);
    await centered(app);
    await app.client.evaluate(`document.querySelector('.rail-chapter-row[data-ci="0"]').click(); return true;`);
    await centered(app);
    await app.client.evaluate(`document.querySelector('.writing-pin').click(); document.querySelector('.writing-spine').dispatchEvent(new MouseEvent('mouseenter')); [...document.querySelectorAll('.peek-scene-row')].find(r=>r.textContent.includes('Later')).click(); return true;`);
    await centered(app);
    await app.client.evaluate(`document.querySelector('.mode-tab[data-mode="corkboard"]').click(); document.querySelector('.scene-card .corkboard-edit-btn[aria-label^="Open "]').click(); return true;`);
    await centered(app);
    assert.deepEqual(app.client.getConsoleMessages().filter(m=>m.type==='error'||m.type==='exception'), []);
  } finally { await app.close(); }
});
