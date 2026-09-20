import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ai from '../../src/ai.js';
import openai from '../../src/ai-providers/openai.js';

function responseWith(value) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }),
  };
}

test('OpenAI adapter keeps credentials server-side and requests strict structured output', async () => {
  let request;
  const provider = openai.createOpenAIProvider({
    apiKey: 'test-secret',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return responseWith({ summaries: [{ id: 's1', summary: 'Mara finds the letter and leaves before dawn.' }] });
    },
  });

  const result = await provider.summarizeScenes([{ id: 's1', text: 'Mara opened the letter.' }]);
  assert.equal(result.summaries[0].id, 's1');
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret');
  assert.equal(request.body.model, 'gpt-5.6-luna');
  assert.equal(request.body.store, false);
  assert.equal(request.body.text.format.type, 'json_schema');
  assert.equal(request.body.text.format.strict, true);
});

test('scene summaries are cached by content and survive service reinitialization', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-ai-test-'));
  const cachePath = path.join(dir, 'ai-cache.json');
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    calls++;
    return responseWith({ summaries: [{ id: 'scene-1', summary: 'A storm traps Lena in the empty station.' }] });
  };

  try {
    ai.init({ filePath: cachePath, apiKey: 'test-key' });
    const first = await ai.summarizeScenes([{ id: 'scene-1', text: 'The storm sealed the station.' }]);
    assert.equal(first.summaries['scene-1'], 'A storm traps Lena in the empty station.');
    assert.equal(calls, 1);

    const second = await ai.summarizeScenes([{ id: 'moved-scene', text: 'The storm sealed the station.' }]);
    assert.equal(second.summaries['moved-scene'], 'A storm traps Lena in the empty station.');
    assert.equal(second.cached, true);
    assert.equal(calls, 1, 'unchanged scene prose should not be sent again');

    ai.init({ filePath: cachePath, apiKey: null });
    assert.deepEqual(ai.getCachedSummaries([{ id: 'after-relaunch', text: 'The storm sealed the station.' }]), {
      'after-relaunch': 'A storm traps Lena in the empty station.',
    });
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an AI summary can be removed from the persistent cache for undo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-ai-undo-test-'));
  const cachePath = path.join(dir, 'ai-cache.json');
  const originalFetch = global.fetch;
  global.fetch = async () => responseWith({ summaries: [{ id: 'scene-1', summary: 'The door opens.' }] });
  try {
    const scene = { id: 'scene-1', text: 'She opened the door.' };
    ai.init({ filePath: cachePath, apiKey: 'test-key' });
    await ai.summarizeScenes([scene]);
    assert.equal(ai.getCachedSummaries([scene])['scene-1'], 'The door opens.');
    ai.removeCachedSummaries([scene]);
    assert.deepEqual(ai.getCachedSummaries([scene]), {});
    ai.init({ filePath: cachePath, apiKey: null });
    assert.deepEqual(ai.getCachedSummaries([scene]), {});
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an outline summary edit is persisted in the same local cache', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-ai-outline-test-'));
  const cachePath = path.join(dir, 'ai-cache.json');
  const scene = { text: 'A quiet room at dawn.' };
  try {
    ai.init({ filePath: cachePath, apiKey: null });
    ai.saveSummary({ ...scene, summary: 'The room is empty at sunrise.' });
    assert.deepEqual(ai.getCachedSummaries([{ id: 'scene-1', text: scene.text }]), {
      'scene-1': 'The room is empty at sunrise.',
    });
    ai.saveSummary({ ...scene, summary: '' });
    assert.deepEqual(ai.getCachedSummaries([{ id: 'scene-1', text: scene.text }]), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('title suggestions return exactly the provider titles without applying one', async () => {
  const originalFetch = global.fetch;
  let requestBody;
  global.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return responseWith({ concrete: 'Black Ice', dramatic: 'Before Dawn', thematic: 'The Last Platform' });
  };
  try {
    ai.init({ apiKey: 'test-key' });
    const result = await ai.suggestTitles({
      kind: 'scene', currentTitle: '', text: 'A station in a storm.',
      context: { chapterTitle: 'Winter', existingTitles: ['Night Train'] },
      styleExamples: 'Black Water\nThe Crossing',
    });
    assert.deepEqual(result.titles, ['Black Ice', 'Before Dawn', 'The Last Platform']);
    assert.equal(requestBody.model, 'gpt-5.6-terra');
    assert.equal(requestBody.reasoning.effort, 'low');
    assert.deepEqual(requestBody.text.format.schema.required, ['concrete', 'dramatic', 'thematic']);
    const input = JSON.parse(requestBody.input);
    assert.equal(input.context.chapterTitle, 'Winter');
    assert.equal(input.styleExamples, 'Black Water\nThe Crossing');
  } finally {
    global.fetch = originalFetch;
  }
});

test('AI tasks fail clearly when no personal API key is configured', async () => {
  ai.init({ apiKey: null });
  await assert.rejects(
    ai.summarizeScenes([{ id: 's1', text: 'Some prose.' }]),
    /OPENAI_API_KEY/,
  );
});
