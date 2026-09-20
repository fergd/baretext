// Provider-neutral AI service. Renderer features talk to these task-shaped
// methods over IPC; the active provider is an implementation detail. Scene
// summaries use a content-addressed local cache so unchanged prose is never
// resent merely because the corkboard was reopened or scenes were reordered.

const crypto = require('crypto');
const fs = require('fs');
const { createOpenAIProvider } = require('./ai-providers/openai');

const CACHE_VERSION = 1;
// Bump this whenever the summary instructions change so stale summaries are
// regenerated instead of being silently reused from the content-addressed cache.
const SUMMARY_PROMPT_VERSION = 2;
const MAX_SCENES_PER_BATCH = 100;
const MAX_SCENE_CHARS = 24000;
const MAX_NAMING_CHARS = 32000;

let cachePath = null;
let cache = { version: CACHE_VERSION, summaries: {} };
let provider = null;

function summaryKey(text) {
  return crypto.createHash('sha256').update(`summary:${SUMMARY_PROMPT_VERSION}\n${text}`).digest('hex');
}

function init({ filePath, apiKey = process.env.OPENAI_API_KEY, model = process.env.BARETEXT_AI_MODEL, namingModel = process.env.BARETEXT_AI_NAMING_MODEL } = {}) {
  cachePath = filePath || null;
  cache = { version: CACHE_VERSION, summaries: {} };
  if (cachePath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (parsed && parsed.version === CACHE_VERSION && parsed.summaries) cache = parsed;
    } catch { /* first launch or invalid cache: start clean */ }
  }
  provider = createOpenAIProvider({ apiKey, model: model || undefined, namingModel: namingModel || undefined });
}

function configure({ apiKey, model = process.env.BARETEXT_AI_MODEL, namingModel = process.env.BARETEXT_AI_NAMING_MODEL } = {}) {
  provider = createOpenAIProvider({ apiKey, model: model || undefined, namingModel: namingModel || undefined });
}

function saveCache() {
  if (!cachePath) return;
  try { fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8'); }
  catch (e) { console.error('AI cache save failed:', e.message); }
}

function cleanScenes(scenes) {
  if (!Array.isArray(scenes)) return [];
  return scenes.slice(0, MAX_SCENES_PER_BATCH).map((scene) => ({
    id: String(scene && scene.id || ''),
    text: String(scene && scene.text || '').slice(0, MAX_SCENE_CHARS),
  })).filter((scene) => scene.id && scene.text.trim());
}

function getCachedSummaries(scenes) {
  const result = {};
  for (const scene of cleanScenes(scenes)) {
    const hit = cache.summaries[summaryKey(scene.text)];
    if (hit && typeof hit.summary === 'string') result[scene.id] = hit.summary;
  }
  return result;
}

function removeCachedSummaries(scenes) {
  for (const scene of cleanScenes(scenes)) delete cache.summaries[summaryKey(scene.text)];
  saveCache();
}

function saveSummary(scene) {
  const text = String(scene && scene.text || '');
  if (!text.trim()) return;
  const key = summaryKey(text);
  const summary = String(scene && scene.summary || '').trim();
  if (summary) cache.summaries[key] = { summary, updatedAt: new Date().toISOString() };
  else delete cache.summaries[key];
  saveCache();
}

async function summarizeScenes(scenes) {
  const cleaned = cleanScenes(scenes);
  const summaries = getCachedSummaries(cleaned);
  const missing = cleaned.filter((scene) => !summaries[scene.id]);
  if (!missing.length) return { summaries, cached: true };
  if (!provider || !provider.configured) throw new Error('Set OPENAI_API_KEY before using Baretext AI');

  const generated = await provider.summarizeScenes(missing);
  const byId = new Map(missing.map((scene) => [scene.id, scene]));
  for (const item of generated.summaries || []) {
    const scene = byId.get(String(item.id));
    const summary = String(item.summary || '').trim();
    if (!scene || !summary) continue;
    summaries[scene.id] = summary;
    cache.summaries[summaryKey(scene.text)] = { summary, updatedAt: new Date().toISOString() };
  }
  saveCache();
  return { summaries, cached: false };
}

async function suggestTitles(payload) {
  if (!provider || !provider.configured) throw new Error('Set OPENAI_API_KEY before using Baretext AI');
  const kind = payload && payload.kind === 'chapter' ? 'chapter' : 'scene';
  const result = await provider.suggestTitles({
    kind,
    currentTitle: String(payload && payload.currentTitle || '').slice(0, 300),
    text: String(payload && payload.text || '').slice(0, MAX_NAMING_CHARS),
    context: payload && typeof payload.context === 'object' ? payload.context : {},
    styleExamples: String(payload && payload.styleExamples || '').slice(0, 2000),
  });
  return { titles: (result.titles || []).map((title) => String(title).trim()).filter(Boolean).slice(0, 3) };
}

function status() {
  return { configured: !!(provider && provider.configured), provider: provider && provider.id, model: provider && provider.model };
}

module.exports = { init, configure, status, getCachedSummaries, removeCachedSummaries, saveSummary, summarizeScenes, suggestTitles, summaryKey };
