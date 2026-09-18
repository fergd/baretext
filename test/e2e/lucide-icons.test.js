import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchApp } from './harness.js';

test('Lucide icons load locally in the editor, corkboard, and sprint controls', async () => {
  const app=await launchApp({fixtureContent:'# Chapter\n\n## Opening\n\nSome words for the writing surface.\n\n## Next scene\n\nMore words.'});
  try {
    await new Promise(r=>setTimeout(r,300));
    for (const surface of ['editor','corkboard','sprinter']) {
      await app.client.evaluate(`
        if (${JSON.stringify(surface)} === 'corkboard') document.querySelector('.rail-corkboard-btn').click();
        if (${JSON.stringify(surface)} === 'sprinter') { document.querySelector('.rail-corkboard-btn').click(); document.querySelector('.mode-tab[data-mode="sprinter"]').click(); }
        return true;
      `);
      const icons=await app.client.evaluate(`
        const icons=[...document.querySelectorAll('.lucide')].filter(el=>el.getBoundingClientRect().width>0);
        return await Promise.all(icons.map(async el=>{
          const style=getComputedStyle(el), mask=style.webkitMaskImage;
          const url=mask.startsWith('url("') ? mask.slice(5,-2) : null;
          const loaded=url ? await new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(true);img.onerror=()=>resolve(false);img.src=url;}) : false;
          return {name:el.className,mask,loaded,local:url?.startsWith('file:'),height:el.getBoundingClientRect().height};
        }));
      `);
      assert.ok(icons.length>0, surface + ' has visible icons');
      for(const icon of icons) assert.ok(icon.loaded && icon.local && icon.height>0,JSON.stringify(icon));
      fs.writeFileSync('/tmp/baretext-lucide-'+surface+'.png',Buffer.from(await app.client.screenshot(),'base64'));
    }
    assert.deepEqual(app.client.getConsoleMessages().filter(m=>m.type==='error'||m.type==='exception'),[]);
  } finally {await app.close();}
});
