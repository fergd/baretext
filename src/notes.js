import { getManuscript, findActiveScene } from './features/scene-nav/model.js';

let ctx = null;
let notes = [];
let open = false;
let activeNoteId = null;
let saveTimer = null;

const rail = () => document.getElementById('notes-rail');
const list = () => document.getElementById('notes-list');

function sceneForNote(note) {
  const chapters = getManuscript(ctx.view);
  for (let ci = 0; ci < chapters.length; ci++) {
    for (let si = 0; si < chapters[ci].scenes.length; si++) {
      const scene = chapters[ci].scenes[si];
      if ((scene.stableId || scene.id) === note.sceneId) return { scene, ci, si };
    }
  }
  return null;
}

function activeScene() {
  return findActiveScene(getManuscript(ctx.view), ctx.editor.getCursorPos(ctx.view));
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!ctx.state.filePath) return;
    const result = await ctx.api.notesSave(ctx.state.filePath, notes);
    if (!result?.ok) ctx.showToast(result?.error || 'notes could not be saved', { tone: 'error' });
  }, 180);
}

function noteCountMap() {
  const counts = new Map();
  notes.filter(n => !n.resolved).forEach((n) => counts.set(n.sceneId, (counts.get(n.sceneId) || 0) + 1));
  return counts;
}

function addCount(el, count) {
  el.querySelector('.note-count')?.remove();
  if (!count) return;
  el.appendChild(Object.assign(document.createElement('span'), { className: 'note-count', textContent: String(count) }));
}

function paintCounts() {
  const counts = noteCountMap();
  const chapters = getManuscript(ctx.view);
  document.querySelectorAll('.rail-scene-row[data-ci][data-si], .scene-card[data-ci][data-si], .outline-scene-row[data-ci][data-si]').forEach((el) => {
    const scene = chapters[Number(el.dataset.ci)]?.scenes[Number(el.dataset.si)];
    addCount(el.querySelector('.rail-scene-name, .scene-card-title-text, .outline-scene') || el, scene ? counts.get(scene.stableId || scene.id) || 0 : 0);
  });
}

function render() {
  if (!ctx || !open) return;
  const current = activeScene();
  const currentId = current && (getManuscript(ctx.view)[current.chapterIndex]?.scenes[current.sceneIndex]?.stableId || getManuscript(ctx.view)[current.chapterIndex]?.scenes[current.sceneIndex]?.id);
  const visible = notes.filter(n => !n.resolved && (!currentId || n.sceneId === currentId));
  document.getElementById('notes-context').textContent = currentId ? 'Notes for the current scene' : 'All open notes';
  list().innerHTML = '';
  document.getElementById('notes-empty').hidden = visible.length > 0;
  visible.forEach((note) => {
    const card = document.createElement('article');
    card.className = 'notes-card' + (note.id === activeNoteId ? ' active' : '');
    const quote = document.createElement('blockquote');
    quote.className = 'notes-quote';
    quote.textContent = `“${note.quote}”`;
    const input = document.createElement('textarea');
    input.className = 'notes-input'; input.placeholder = 'Write a note…'; input.value = note.text || '';
    input.addEventListener('input', () => { note.text = input.value; saveSoon(); });
    input.addEventListener('focus', () => { activeNoteId = note.id; card.classList.add('active'); });
    const footer = document.createElement('div'); footer.className = 'notes-card-footer';
    const scene = sceneForNote(note);
    footer.appendChild(document.createTextNode(scene ? scene.scene.title || 'untitled scene' : 'scene moved'));
    const actions = document.createElement('span'); actions.className = 'notes-card-actions';
    const jump = document.createElement('button'); jump.className = 'notes-action'; jump.textContent = 'open';
    jump.addEventListener('click', () => { if (scene) { ctx.editor.navigate(ctx.view, scene.scene.contentPos, { align: ctx.state.typewriter ? 'center' : 'start', scrollPos: scene.scene.pos }); ctx.focusEditor(); } });
    const resolve = document.createElement('button'); resolve.className = 'notes-action'; resolve.textContent = 'resolve';
    resolve.addEventListener('click', () => { note.resolved = true; saveSoon(); render(); paintCounts(); });
    actions.append(jump, resolve); footer.appendChild(actions); card.append(quote, input, footer); list().appendChild(card);
  });
  paintCounts();
}

export async function load(filePath) {
  notes = filePath ? (await ctx.api.notesLoad(filePath)) || [] : [];
  render(); paintCounts();
}

export function toggle() { open ? close() : show(); }
export function show() { open = true; document.getElementById('app').classList.add('notes-open'); rail().classList.add('open'); rail().setAttribute('aria-hidden', 'false'); document.getElementById('notes-toggle').setAttribute('aria-pressed', 'true'); render(); }
export function close() { open = false; document.getElementById('app').classList.remove('notes-open'); rail().classList.remove('open'); rail().setAttribute('aria-hidden', 'true'); document.getElementById('notes-toggle').setAttribute('aria-pressed', 'false'); }
export function refresh() { render(); paintCounts(); }

export function addFromSelection() {
  const selection = ctx.view.state.selection.main;
  if (selection.empty) { ctx.showToast('select text first'); return false; }
  const chapters = getManuscript(ctx.view);
  const target = findActiveScene(chapters, selection.from);
  if (!target) { ctx.showToast('select text inside a scene'); return false; }
  const scene = chapters[target.chapterIndex].scenes[target.sceneIndex];
  const quote = ctx.view.state.sliceDoc(selection.from, selection.to).trim();
  if (!quote) { ctx.showToast('select text first'); return false; }
  const note = { id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, sceneId: scene.stableId || scene.id, quote: quote.slice(0, 1000), from: selection.from, to: selection.to, text: '', resolved: false, createdAt: new Date().toISOString() };
  notes.unshift(note); activeNoteId = note.id; saveSoon(); show(); render();
  requestAnimationFrame(() => list().querySelector('.notes-input')?.focus());
  return true;
}

export function mount(localCtx) {
  ctx = localCtx;
  document.getElementById('notes-toggle').addEventListener('click', toggle);
  document.getElementById('notes-close').addEventListener('click', close);
  ctx.editor.subscribe(ctx.view, (update) => {
    if (update.docChanged || update.selectionSet) requestAnimationFrame(refresh);
  });
}
