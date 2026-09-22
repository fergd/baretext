import assert from 'node:assert/strict';
import test from 'node:test';
import { summarySource } from '../../src/features/scene-nav/corkboard.js';

test('AI summary source excludes scene title metadata so renaming preserves the cache key', () => {
  const before = {
    stableId: 'outline-4',
    type: 'h2',
    rawText: '## Before Dawn\n\nThe station emptied before sunrise.\n\nShe waited alone.',
  };
  const after = {
    ...before,
    rawText: '## The Last Platform\n\nThe station emptied before sunrise.\n\nShe waited alone.',
  };
  assert.equal(summarySource(before), summarySource(after));
  assert.equal(summarySource(after), 'The station emptied before sunrise.\n\nShe waited alone.');
});
