import test from 'node:test';
import assert from 'node:assert/strict';
import { launchApp } from './harness.js';

test('outline view lays out editable summaries and copies Google Sheets rows', async () => {
  const app = await launchApp({
    fixtureContent: '# Chapter One\n\n## Opening\n\nThe first scene.\n\n---\n\nThe second scene.',
    mode: 'editor',
  });
  try {
    const result = await app.client.evaluate(`
      document.querySelector('.rail-corkboard-btn').click();
      await new Promise(r => setTimeout(r, 120));
      const tools = [...document.querySelectorAll('.corkboard-tool-btn')];
      tools.find(button => button.textContent.includes('outline')).click();
      await new Promise(r => setTimeout(r, 80));
      let copied = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
      [...document.querySelectorAll('.corkboard-tool-btn')].find(button => button.textContent.includes('copy for Sheets')).click();
      await new Promise(r => setTimeout(r, 40));
      return {
        label: document.querySelector('.corkboard-label')?.textContent,
        chapterBadge: document.querySelector('.outline-chapter-badge')?.textContent,
        summary: document.querySelector('tbody .outline-summary')?.textContent,
        textareas: document.querySelectorAll('.outline-summary-input').length,
        copied,
      };
    `);
    assert.equal(result.label, 'outline');
    assert.equal(result.chapterBadge, '1');
    assert.match(result.summary, /first scene/i);
    assert.equal(result.textareas, 0);
    assert.match(result.copied, /Chapter\tScene\tSummary\tWords/);
    assert.match(result.copied, /The first scene\./);
    assert.deepEqual(app.client.getConsoleMessages().filter(m => m.type === 'error' || m.type === 'exception'), []);
  } finally {
    await app.close();
  }
});
