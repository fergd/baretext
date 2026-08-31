import { getManuscript, findActiveScene } from './model.js';
import { reorderScenes } from './reorder.js';
import { el, btn, icon, injectStyle as injectStyleTag } from '../../dom.js';
import { makeDeleteButton, beginEdit } from './ui-helpers.js';

let ctx = null;
let boardEl = null;
let open = false;
let dragSource = null; // { chapterIndex, sceneIndex } while a card drag is in progress
const aiSummaries = new Map(); // scene rawText -> generated summary
const summaryLoading = new Set(); // scene rawText currently in flight
const summaryErrors = new Map(); // scene rawText -> most recent summary error
let namingState = null; // { key, loading, titles, error }
let aiStatus = null; // safe configuration metadata; never contains the API key
let titleStyleExamples = '';

function injectStyle() {
  injectStyleTag('corkboard-style', `
#corkboard { font-family: var(--font-mono); }
.corkboard-toolbar {
  height: 42px; flex: none; background: var(--bg-alt); border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between; padding: 0 20px;
}
.corkboard-toolbar-left { display: flex; align-items: center; gap: 10px; }
.corkboard-toolbar-left .ti-layout-grid { font-size: 15px; color: var(--syntax-2, var(--accent)); }
.corkboard-label { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--syntax-2, var(--accent)); font-weight: 600; }
.corkboard-meta { font-size: 12px; color: var(--text-dimmer); }
.corkboard-ai-status { all: unset; cursor: pointer; font-size: 10px; color: var(--text-dimmer); white-space: nowrap; }
.corkboard-ai-status.ready { color: var(--syntax-2, var(--accent)); }
.corkboard-ai-status:hover, .corkboard-ai-status:focus-visible { color: var(--text); }
.corkboard-back {
  all: unset; box-sizing: border-box; cursor: pointer; padding: 4px 6px; margin: -4px -6px;
  display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-dim);
}
.corkboard-back:hover { color: var(--text); }
.corkboard-back kbd { background: var(--kbd-bg); border: 1px solid var(--kbd-border); border-bottom-width: 2px; border-radius: 4px; padding: 1px 6px; font-size: 10px; color: var(--text-dim); }
.corkboard-toolbar-right { display: flex; align-items: center; gap: 16px; }
.corkboard-tool-btn {
  all: unset; box-sizing: border-box; cursor: pointer; padding: 4px 6px; margin: -4px -6px;
  display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-dim);
  transition: color .15s ease;
}
.corkboard-tool-btn:hover { color: var(--syntax-2, var(--accent)); }
.corkboard-tool-btn.loading, .corkboard-ai-btn.loading { color: var(--syntax-2, var(--accent)); opacity: .72; }
.corkboard-ai-btn { color: var(--syntax-2, var(--accent)); }
.corkboard-ai-text-btn {
  all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
  color: var(--text-dim); font-family: var(--font-mono); font-size: 10px; line-height: 1;
}
.corkboard-ai-text-btn:hover, .corkboard-ai-text-btn:focus-visible { color: var(--syntax-2, var(--accent)); }
.corkboard-ai-text-btn.loading { color: var(--syntax-2, var(--accent)); opacity: .72; }
.corkboard-ai-text-btn:disabled { cursor: default; }
.corkboard-body { flex: 1; overflow: auto; padding: 22px 26px; }
.corkboard-chapter { margin-bottom: 24px; }
.corkboard-chapter-header { display: flex; align-items: center; gap: 11px; margin-bottom: 13px; }
.corkboard-chapter-header .ti-chevron-down { font-size: 15px; color: var(--text-dim); cursor: pointer; }
.corkboard-chapter-title-group { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.corkboard-chapter-num { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--syntax-2, var(--accent)); font-weight: 700; white-space: nowrap; }
.corkboard-chapter-title-text { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-dim); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.corkboard-chapter-title-text.placeholder { font-style: italic; opacity: .55; font-weight: 600; }
.corkboard-edit-btn {
  all: unset; box-sizing: border-box; position: relative;
  font-size: 12px; color: var(--text-dimmer); opacity: .5; cursor: pointer; flex-shrink: 0;
  transition: opacity .12s ease, color .12s ease;
}
.corkboard-edit-btn::before { content: ''; position: absolute; inset: -8px; }
/* Rename/delete/open are core scene-management actions -- hover-only
   visibility would make them permanently unreachable by keyboard, touch, or
   screen reader. Stay visually quiet by default, come to full strength on
   hover AND :focus-within (so tabbing to a button inside a card reveals it
   too, not just mouse hover). */
.corkboard-chapter-header:hover .corkboard-edit-btn, .scene-card:hover .corkboard-edit-btn,
.corkboard-chapter-header:focus-within .corkboard-edit-btn, .scene-card:focus-within .corkboard-edit-btn { opacity: 1; }
.corkboard-edit-btn:hover { color: var(--syntax-2, var(--accent)); }
.corkboard-delete-btn {
  all: unset; box-sizing: border-box; position: relative;
  font-size: 12px; color: var(--text-dimmer); opacity: .5; cursor: pointer; flex-shrink: 0;
  padding: 2px 5px; border-radius: 4px; display: flex; align-items: center; gap: 4px;
  transition: opacity .12s ease, color .12s ease, background .12s ease;
}
.corkboard-delete-btn::before { content: ''; position: absolute; inset: -6px; }
.corkboard-chapter-header:hover .corkboard-delete-btn, .scene-card:hover .corkboard-delete-btn,
.corkboard-chapter-header:focus-within .corkboard-delete-btn, .scene-card:focus-within .corkboard-delete-btn { opacity: 1; }
.corkboard-delete-btn:hover { color: #e05c5c; }
.corkboard-delete-btn.confirm {
  opacity: 1; color: #e05c5c; font-weight: 600;
  background: color-mix(in srgb, #e05c5c 15%, transparent);
}
.corkboard-chapter-rule { flex: 1; height: 1px; background: var(--border); }
.corkboard-chapter-meta { font-size: 11px; color: var(--text-dimmer); letter-spacing: .04em; white-space: nowrap; }
.corkboard-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; padding-left: 26px; }
.scene-card {
  background: var(--bg-alt); border: 1px solid var(--border); border-radius: var(--radius-card, 10px);
  padding: 13px; display: flex; flex-direction: column; gap: 7px; min-height: 120px; cursor: grab;
  user-select: none;
}
.scene-card:hover { border-color: color-mix(in srgb, var(--syntax-2, var(--accent)) 50%, var(--border)); }
.scene-card.active { border-color: var(--syntax-2, var(--accent)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--syntax-2, var(--accent)) 12%, transparent); }
.scene-card.draft { opacity: .7; }
.scene-card.dragging { opacity: .35; cursor: grabbing; }
.scene-card.drag-over { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent); }
.corkboard-grid.drag-over-grid { background: var(--wash-accent); border-radius: var(--radius-card, 10px); }
.scene-card .scene-card-title { font-size: 13px; color: var(--text); font-weight: 700; display: flex; align-items: baseline; gap: 4px; }
.scene-card.draft .scene-card-title { color: var(--text-dim); }
.scene-card-title-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-card-ai-actions { display: flex; align-items: center; gap: 12px; min-height: 14px; }
.scene-card .scene-card-synopsis { font-size: 11px; line-height: 1.55; color: var(--text-dim); flex: 1; }
.scene-card .scene-card-synopsis.ai { color: var(--text); }
.scene-card .scene-card-synopsis.error, .ai-title-state.error { color: #e05c5c; }
.scene-card-summary-label { font-size: 9px; line-height: 1; color: var(--syntax-2, var(--accent)); letter-spacing: .12em; text-transform: uppercase; }
.scene-card.draft .scene-card-synopsis { font-style: italic; color: var(--text-dimmer); }
.scene-card .scene-card-meta { font-size: 10px; color: var(--text-dimmer); letter-spacing: .05em; }
.inline-rename-input {
  flex: 1; min-width: 0; background: color-mix(in srgb, var(--bg) 55%, transparent);
  border: 1px solid var(--syntax-2, var(--accent)); border-radius: 4px; padding: 2px 6px;
  color: var(--text); font-family: var(--font-mono); font-size: 12px; outline: none;
}
.scene-card-new {
  all: unset; box-sizing: border-box; width: 100%; cursor: pointer;
  border: 1px dashed color-mix(in srgb, var(--text-dim) 50%, transparent); border-radius: var(--radius-card, 10px);
  padding: 13px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; min-height: 120px; color: var(--text-dim);
}
.scene-card-new:hover { color: var(--text); border-color: var(--text-dim); }
.scene-card-new .ti-plus { font-size: 18px; }
.scene-card-new span { font-size: 11px; }
.ai-title-suggestions {
  display: flex; flex-wrap: wrap; gap: 6px; margin: 1px 0 10px 26px;
}
.scene-card .ai-title-suggestions { margin: 0; }
.ai-title-suggestion, .ai-title-state {
  all: unset; box-sizing: border-box; font-family: var(--font-mono); font-size: 10px;
  line-height: 1.35; color: var(--text-dim);
}
.ai-title-suggestion {
  cursor: pointer; padding: 4px 7px; border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px); background: var(--bg);
}
.ai-title-suggestion:hover, .ai-title-suggestion:focus-visible {
  color: var(--text); border-color: var(--syntax-2, var(--accent));
}
.ai-title-state { color: var(--text-dimmer); padding: 4px 0; }
`);
}

function scenePayload(scenes) {
  return scenes.map((scene) => ({ id: scene.id, text: scene.rawText }));
}

function storeSummaryResult(result, scenes) {
  if (!result || !result.summaries) return;
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  Object.entries(result.summaries).forEach(([id, summary]) => {
    const scene = byId.get(id);
    if (scene && summary) aiSummaries.set(scene.rawText, summary);
  });
}

async function loadCachedSummaries(scenes) {
  const cached = await ctx.api.aiCachedSummaries(scenePayload(scenes));
  storeSummaryResult({ summaries: cached }, scenes);
  if (open) render();
}

async function summarizeScenes(scenes) {
  const eligible = scenes.filter((scene) => scene.rawText.trim());
  if (!eligible.length) { ctx.showToast('nothing to summarize'); return; }
  const previous = new Map(eligible.map((scene) => [scene.rawText, aiSummaries.get(scene.rawText)]));
  eligible.forEach((scene) => { summaryLoading.add(scene.rawText); summaryErrors.delete(scene.rawText); });
  render();
  const result = await ctx.api.aiSummarizeScenes(scenePayload(eligible));
  eligible.forEach((scene) => summaryLoading.delete(scene.rawText));
  if (!result.ok) {
    eligible.forEach((scene) => summaryErrors.set(scene.rawText, result.error));
    ctx.showToast(result.error, { icon: 'ti-alert-triangle', tone: 'error' });
  }
  else {
    storeSummaryResult(result, eligible);
    const changed = eligible.filter((scene) => previous.get(scene.rawText) !== aiSummaries.get(scene.rawText));
    if (changed.length) {
      ctx.showToast(changed.length === 1 ? 'AI summary added' : `${changed.length} AI summaries added`, {
        icon: 'ti-sparkles',
        actionLabel: 'undo',
        onAction: async () => {
          await ctx.api.aiRemoveCachedSummaries(scenePayload(changed));
          changed.forEach((scene) => {
            const oldValue = previous.get(scene.rawText);
            if (oldValue === undefined) aiSummaries.delete(scene.rawText);
            else aiSummaries.set(scene.rawText, oldValue);
          });
          if (open) render();
        },
      });
    }
  }
  if (open) render();
}

function titleContext(chapters, chapterIndex, sceneIndex = null) {
  const chapter = chapters[chapterIndex];
  const scenes = chapter ? chapter.scenes : [];
  const existingTitles = chapters
    .flatMap((item) => [item.title, ...item.scenes.map((scene) => scene.title)])
    .filter((title) => title && !/^Scene \d+$/.test(title));
  const context = {
    bookTitle: ctx.editor.getBookTitle(ctx.view) || '',
    chapterTitle: chapter && chapter.title || '',
    existingTitles,
  };
  if (sceneIndex !== null) {
    context.previousSceneTitle = sceneIndex > 0 ? scenes[sceneIndex - 1].title : '';
    context.nextSceneTitle = sceneIndex + 1 < scenes.length ? scenes[sceneIndex + 1].title : '';
  } else {
    context.sceneTitles = scenes.map((scene) => scene.title).filter(Boolean);
    context.previousChapterTitle = chapterIndex > 0 ? chapters[chapterIndex - 1].title : '';
    context.nextChapterTitle = chapterIndex + 1 < chapters.length ? chapters[chapterIndex + 1].title : '';
  }
  return context;
}

async function suggestTitles(key, target, kind, text, context) {
  namingState = { key, loading: true, titles: [], error: null };
  render();
  const result = await ctx.api.aiSuggestTitles({ kind, currentTitle: target.title, text, context, styleExamples: titleStyleExamples });
  if (!result.ok) {
    namingState = { key, loading: false, titles: [], error: result.error };
    ctx.showToast(result.error, { icon: 'ti-alert-triangle', tone: 'error' });
  } else {
    namingState = { key, loading: false, titles: result.titles || [], error: null };
  }
  if (open) render();
}

function titleSuggestions(key, target) {
  if (!namingState || namingState.key !== key) return null;
  const row = el('div', 'ai-title-suggestions');
  if (namingState.loading) row.appendChild(el('span', 'ai-title-state', 'thinking…'));
  else if (namingState.error) row.appendChild(el('span', 'ai-title-state error', namingState.error));
  else namingState.titles.forEach((title) => {
    const choice = btn('ai-title-suggestion', title);
    choice.addEventListener('click', (e) => {
      e.stopPropagation();
      namingState = null;
      ctx.renameTitle(target, title);
      ctx.showToast('AI name applied', {
        icon: 'ti-sparkles',
        actionLabel: 'undo',
        onAction: () => { ctx.editor.undo(ctx.view); ctx.refreshNav(); },
      });
    });
    row.appendChild(choice);
  });
  return row;
}

function jumpTo(scene) {
  // Same reasoning as rail.js's jumpTo -- a chapter's own position isn't
  // actually reachable while Cold Storage scene view is hiding everything
  // outside the isolated scene. No-ops if scene view isn't active. (Cold
  // Storage itself never appears in the corkboard, so this only matters if
  // scene view was left active from the rail before opening the corkboard.)
  ctx.exitColdStorageScene();
  ctx.editor.setCursorPos(ctx.view, scene.contentPos);
  ctx.editor.scrollToTop(ctx.view, scene.pos);
  close();
  ctx.refreshNav();
}

export function render() {
  if (!boardEl) return;
  const chapters = getManuscript(ctx.view);
  const cursorPos = ctx.editor.getCursorPos(ctx.view);
  const active = findActiveScene(chapters, cursorPos);
  // Cold Storage (see model.js) isn't a chapter — the corkboard doesn't
  // have a bucket-column UI for it yet, so it's left out of both the count
  // and the render loop below rather than showing up as a mislabeled,
  // ordinary-looking chapter column. Its scenes stay reachable from the
  // rail regardless.
  const totalScenes = chapters.reduce((sum, c) => (c.coldStorage ? sum : sum + c.scenes.length), 0);

  boardEl.innerHTML = '';

  const toolbar = el('div', 'corkboard-toolbar');
  const left = el('div', 'corkboard-toolbar-left');
  left.append(icon('ti-layout-grid'), el('span', 'corkboard-label', 'corkboard'), el('span', 'corkboard-meta', totalScenes + ' scenes'));
  if (aiStatus) {
    const statusText = aiStatus.configured ? 'ai · ready' : 'ai · key not detected';
    const status = btn('corkboard-ai-status' + (aiStatus.configured ? ' ready' : ''), statusText);
    status.title = aiStatus.configured ? `${aiStatus.provider} · ${aiStatus.model} · open settings` : 'set up a personal API key';
    status.addEventListener('click', ctx.openAiSettings);
    left.appendChild(status);
  }

  const right = el('div', 'corkboard-toolbar-right');
  const undoBtn = btn('corkboard-tool-btn');
  undoBtn.appendChild(icon('ti-arrow-back-up'));
  undoBtn.appendChild(document.createTextNode(' undo'));
  undoBtn.title = 'undo (⌘Z)';
  undoBtn.addEventListener('click', () => { ctx.editor.undo(ctx.view); ctx.refreshNav(); });
  const redoBtn = btn('corkboard-tool-btn');
  redoBtn.appendChild(icon('ti-arrow-forward-up'));
  redoBtn.appendChild(document.createTextNode(' redo'));
  redoBtn.title = 'redo (⌘⇧Z)';
  redoBtn.addEventListener('click', () => { ctx.editor.redo(ctx.view); ctx.refreshNav(); });

  const allScenes = chapters.flatMap((chapter) => chapter.coldStorage ? [] : chapter.scenes);
  const summarizeAllBtn = btn('corkboard-tool-btn' + (summaryLoading.size ? ' loading' : ''));
  summarizeAllBtn.appendChild(icon('ti-sparkles'));
  summarizeAllBtn.appendChild(document.createTextNode(summaryLoading.size ? ' summarizing…' : ' summarize all'));
  summarizeAllBtn.title = 'generate summaries for all scene cards';
  summarizeAllBtn.disabled = summaryLoading.size > 0;
  summarizeAllBtn.addEventListener('click', () => summarizeScenes(allScenes));

  const back = btn('corkboard-back');
  const kbd = document.createElement('kbd');
  kbd.textContent = 'esc';
  back.append(kbd, document.createTextNode(' back to writing'));
  back.addEventListener('click', () => close());

  // Keep undo/redo first: beyond matching the visual action hierarchy, some
  // keyboard/E2E affordances intentionally target the first toolbar action.
  right.append(undoBtn, redoBtn, summarizeAllBtn, back);
  toolbar.append(left, right);
  boardEl.appendChild(toolbar);

  const body = el('div', 'corkboard-body');
  chapters.forEach((chapter, ci) => {
    if (chapter.coldStorage) return;
    const section = el('div', 'corkboard-chapter');
    const header = el('div', 'corkboard-chapter-header');
    const chapterWords = chapter.scenes.reduce((sum, s) => sum + s.wordCount, 0);

    const chHasTitle = chapter.title.trim() !== '';
    // The number badge already reads "Chapter N" in full — echoing that
    // again as the title when there isn't one yet would just duplicate it,
    // so this gets its own distinct placeholder wording instead.
    const chLabel = chHasTitle ? chapter.title : 'Chapter ' + chapter.number;
    const chTitleText = el('span', 'corkboard-chapter-title-text' + (chHasTitle ? '' : ' placeholder'), chHasTitle ? chapter.title : 'untitled');
    const chEditBtn = btn('corkboard-edit-btn');
    chEditBtn.appendChild(icon('ti-pencil'));
    chEditBtn.title = 'rename chapter';
    chEditBtn.setAttribute('aria-label', 'Rename ' + chLabel);
    chEditBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    chEditBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      beginEdit(chTitleText, chapter.title, (newTitle) => ctx.renameTitle(chapter, newTitle), render);
    });
    const chAiKey = 'chapter:' + chapter.pos;
    const chAiBtn = btn('corkboard-ai-text-btn' + (namingState && namingState.key === chAiKey && namingState.loading ? ' loading' : ''));
    chAiBtn.append(icon('ti-sparkles'), document.createTextNode('suggest name'));
    chAiBtn.title = 'suggest chapter names';
    chAiBtn.setAttribute('aria-label', 'Suggest names for ' + chLabel);
    chAiBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    chAiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = chapter.scenes.map((scene) => scene.rawText).join('\n\n---\n\n');
      suggestTitles(chAiKey, chapter, 'chapter', text, titleContext(chapters, ci));
    });
    const chDeleteBtn = makeDeleteButton('corkboard-delete-btn', chLabel, () => ctx.deleteChapter(ci, chapters));
    const chTitleGroup = el('div', 'corkboard-chapter-title-group');
    chTitleGroup.append(el('span', 'corkboard-chapter-num', 'Chapter ' + chapter.number), chTitleText, chAiBtn, chEditBtn, chDeleteBtn);

    header.append(
      icon('ti-chevron-down'),
      chTitleGroup,
      el('span', 'corkboard-chapter-rule'),
      el('span', 'corkboard-chapter-meta', chapter.scenes.length + ' scenes · ' + chapterWords + ' words')
    );
    section.appendChild(header);
    const chapterSuggestions = titleSuggestions(chAiKey, chapter);
    if (chapterSuggestions) section.appendChild(chapterSuggestions);

    const grid = el('div', 'corkboard-grid');
    chapter.scenes.forEach((scene, si) => {
      const isActive = !!(active && active.chapterIndex === ci && active.sceneIndex === si);
      const card = el('div', 'scene-card' + (isActive ? ' active' : '') + (scene.isDraft ? ' draft' : ''));

      const titleTextSpan = el('span', 'scene-card-title-text', scene.title);
      const editBtn = btn('corkboard-edit-btn');
      editBtn.appendChild(icon('ti-pencil'));
      editBtn.title = 'rename scene';
      editBtn.setAttribute('aria-label', 'Rename ' + scene.title);
      editBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        beginEdit(titleTextSpan, scene.title, (newTitle) => ctx.renameTitle(scene, newTitle), render);
      });
      const sceneAiKey = 'scene:' + scene.rawText;
      const nameBtn = btn('corkboard-ai-text-btn' + (namingState && namingState.key === sceneAiKey && namingState.loading ? ' loading' : ''));
      nameBtn.append(icon('ti-sparkles'), document.createTextNode('suggest name'));
      nameBtn.title = 'suggest scene names';
      nameBtn.setAttribute('aria-label', 'Suggest names for ' + scene.title);
      nameBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      nameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        suggestTitles(sceneAiKey, scene, 'scene', scene.rawText, titleContext(chapters, ci, si));
      });
      const summaryBtn = btn('corkboard-ai-text-btn' + (summaryLoading.has(scene.rawText) ? ' loading' : ''));
      summaryBtn.append(icon('ti-sparkles'), document.createTextNode(summaryLoading.has(scene.rawText) ? 'summarizing…' : 'summary'));
      summaryBtn.title = 'summarize scene';
      summaryBtn.setAttribute('aria-label', 'Summarize ' + scene.title);
      summaryBtn.disabled = summaryLoading.has(scene.rawText);
      summaryBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      summaryBtn.addEventListener('click', (e) => { e.stopPropagation(); summarizeScenes([scene]); });
      // Explicit, deliberate navigation control — double-click also jumps,
      // but this is the discoverable version so no interaction with a card
      // (editing, dragging, adding) ever navigates away by surprise.
      const openBtn = btn('corkboard-edit-btn');
      openBtn.appendChild(icon('ti-arrow-up-right'));
      openBtn.title = 'open in manuscript';
      openBtn.setAttribute('aria-label', 'Open ' + scene.title + ' in manuscript');
      openBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      openBtn.addEventListener('click', (e) => { e.stopPropagation(); jumpTo(scene); });
      const deleteBtn = makeDeleteButton('corkboard-delete-btn', scene.title, () => ctx.deleteScene(ci, si, chapters));
      const titleRow = el('div', 'scene-card-title');
      titleRow.append(el('span', undefined, (si + 1) + ' · '), titleTextSpan, editBtn, openBtn, deleteBtn);
      const aiActions = el('div', 'scene-card-ai-actions');
      aiActions.append(nameBtn, summaryBtn);

      const generatedSummary = aiSummaries.get(scene.rawText);
      const summaryError = summaryErrors.get(scene.rawText);
      const synopsis = el('div', 'scene-card-synopsis' + (generatedSummary ? ' ai' : '') + (summaryError ? ' error' : ''),
        summaryLoading.has(scene.rawText) ? 'summarizing…' : summaryError || generatedSummary || (scene.isDraft ? (scene.synopsis || 'empty') : scene.synopsis));

      card.append(
        titleRow,
        aiActions,
        ...(generatedSummary ? [el('div', 'scene-card-summary-label', 'ai summary')] : []),
        synopsis,
        el('div', 'scene-card-meta', scene.isDraft ? 'draft' : scene.wordCount + ' words')
      );
      const sceneSuggestions = titleSuggestions(sceneAiKey, scene);
      if (sceneSuggestions) card.appendChild(sceneSuggestions);
      card.title = 'double-click to jump to this scene · drag to reorder';
      card.addEventListener('dblclick', (e) => { e.preventDefault(); jumpTo(scene); });

      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        dragSource = { chapterIndex: ci, sceneIndex: si };
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', scene.id);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        dragSource = null;
      });
      card.addEventListener('dragover', (e) => {
        if (!dragSource) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', () => { card.classList.remove('drag-over'); });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (!dragSource) return;
        const moved = reorderScenes(chapters, {
          fromChapterIndex: dragSource.chapterIndex,
          fromSceneIndex: dragSource.sceneIndex,
          toChapterIndex: ci,
          toSceneIndex: si,
        });
        dragSource = null;
        if (moved !== null) { ctx.setDoc(moved); ctx.refreshNav(); }
      });

      grid.appendChild(card);
    });

    const newTile = btn('scene-card-new');
    newTile.append(icon('ti-plus'), el('span', undefined, 'new scene'));
    newTile.setAttribute('aria-label', 'Add a scene to ' + chLabel);
    newTile.addEventListener('click', () => ctx.addNewScene(ci, chapters));
    grid.appendChild(newTile);

    // Catch-all "append to end of this chapter" drop zone for anywhere in
    // the grid that isn't a card itself (cards handle their own precise
    // reorder-before-this-card drop above). Originally required
    // `e.target === grid` exactly, which only matches the grid's own bare
    // background pixels -- any bubbled target inside it (the dashed "new
    // scene" tile, its icon/label, or just a stray text node) failed the
    // check and silently swallowed the drop, which is exactly what a real
    // mouse-driven drag onto an empty chapter's "new scene" tile hits most
    // of the time (confirmed live: dragover fired but never preventDefault-
    // ed, so the browser rejected the drop and no 'drop' event ever came).
    // closest('.scene-card') is the correct exclusion instead: bail only
    // when a card (which has its own handler) is actually under the pointer.
    grid.addEventListener('dragover', (e) => {
      if (!dragSource || e.target.closest('.scene-card')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      grid.classList.add('drag-over-grid');
    });
    grid.addEventListener('dragleave', (e) => {
      if (!e.target.closest('.scene-card')) grid.classList.remove('drag-over-grid');
    });
    grid.addEventListener('drop', (e) => {
      if (e.target.closest('.scene-card')) return;
      e.preventDefault();
      grid.classList.remove('drag-over-grid');
      if (!dragSource) return;
      const moved = reorderScenes(chapters, {
        fromChapterIndex: dragSource.chapterIndex,
        fromSceneIndex: dragSource.sceneIndex,
        toChapterIndex: ci,
        toSceneIndex: chapter.scenes.length,
      });
      dragSource = null;
      if (moved !== null) { ctx.setDoc(moved); ctx.refreshNav(); }
    });

    section.appendChild(grid);
    body.appendChild(section);
  });
  boardEl.appendChild(body);
}

export function isOpen() { return open; }

export function toggle() {
  if (open) close(); else show();
}

export function show() {
  open = true;
  document.getElementById('content-row').style.display = 'none';
  boardEl.style.display = 'flex';
  render();
  ctx.api.aiStatus().then((status) => {
    aiStatus = status;
    if (open) render();
  });
  ctx.api.aiTitlePreferences().then((preferences) => {
    titleStyleExamples = preferences.styleExamples || '';
  });
  const chapters = getManuscript(ctx.view);
  loadCachedSummaries(chapters.flatMap((chapter) => chapter.coldStorage ? [] : chapter.scenes));
}

export function close() {
  open = false;
  boardEl.style.display = 'none';
  document.getElementById('content-row').style.display = 'flex';
  ctx.focusEditor();
}

export function mount(localCtx) {
  ctx = localCtx;
  injectStyle();
  boardEl = document.getElementById('corkboard');
  open = false;
}

export function unmount() {
  if (open) close();
  boardEl = null;
  ctx = null;
  namingState = null;
  summaryLoading.clear();
  summaryErrors.clear();
  aiStatus = null;
  titleStyleExamples = '';
}
