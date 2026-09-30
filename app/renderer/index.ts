import { redo, undo } from 'prosemirror-history';
import { Plugin, Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import {
  createManuscriptState,
  docToModel,
  hasFormattableText,
  insertSectionBreak,
  nameScene,
  nameSceneAt,
  sceneDepth,
  schema,
  splitScene,
  toggleBold,
  toggleItalic,
  toggleQuote,
} from '@baretext/editor';
import type { BaretextBridge, MenuCommand, OpenedDocument, ParagraphSpacing } from '../shared/bridge';
import { currentScene, outlineOf, sceneAt, sceneDisplayName } from './outline';
import { Spine } from './spine';
import { FindPanel } from './find';
import { Palette, type PaletteItem, type PaletteView } from './palette';
import { SelectionToolbar } from './toolbar';
import { Typewriter } from './typewriter';

declare global {
  interface Window {
    baretext: BaretextBridge;
    /** Test/debug hook: read-only access to editor state. */
    __baretext?: unknown;
  }
}

const bridge = window.baretext;
const $ = <T extends HTMLElement = HTMLElement>(ref: string) => document.querySelector<T>(`[data-ref="${ref}"]`)!;
const app = document.querySelector<HTMLElement>('.bt-app')!;
const scroller = $('scroller');
const page = $('page');

const AUTOSAVE_MS = 500;
const CARET_SAVE_MS = 2000;

let view: EditorView | null = null;
let filePath: string | null = null;
let saveTimer: number | undefined;
let caretTimer: number | undefined;
let savedDoc: unknown = null;
let saving: Promise<boolean> | null = null;
let lastKeyNav = 0;
/** Reading back: the writer scrolled by hand, so "where you are" follows the scroll, not the caret. */
let reading = false;
let readingHere: ReturnType<typeof currentScene> = null;

// ── current-scene highlight (makes its margin number distinguishable) ──
const currentScenePlugin = new Plugin({
  props: {
    decorations(state) {
      const $h = state.selection.$head;
      for (let d = $h.depth; d > 0; d--) {
        if ($h.node(d).type === schema.nodes.scene) {
          return DecorationSet.create(state.doc, [Decoration.node($h.before(d), $h.after(d), { class: 'bt-current-scene' })]);
        }
      }
      return DecorationSet.empty;
    },
  },
});

// ── status and toast ──
let toastTimer: number | undefined;
function toast(message: string, kind: 'info' | 'error' = 'info') {
  const el = $('toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.dataset.visible = 'false'; }, kind === 'error' ? 8000 : 2400);
}

function setSaveState(state: 'saved' | 'unsaved' | 'saving' | 'error', message = '') {
  const el = $('save-state');
  el.dataset.state = state;
  el.textContent = state === 'error' ? 'not saved' : state === 'saving' || state === 'unsaved' ? '•' : '';
  el.title = message;
}

const numberFormat = new Intl.NumberFormat();
let chromeFrame = 0;
function refreshChrome() {
  if (chromeFrame) return;
  chromeFrame = requestAnimationFrame(() => {
    chromeFrame = 0;
    if (!view) return;
    const state = view.state;
    const outline = outlineOf(state.doc);
    const here = (reading && readingHere) || currentScene(state);
    $('words').textContent = `${numberFormat.format(outline.words)} ${outline.words === 1 ? 'word' : 'words'}`;
    $('title').textContent = state.doc.firstChild!.textContent || 'Untitled';
    $('crumb').textContent = here
      ? `chapter ${here.chapter.number}${here.chapter.title ? ` · ${here.chapter.title.toLowerCase()}` : ''} · ${sceneDisplayName(here.scene).toLowerCase()}`
      : '';
    spine.update(outline, here?.scene.id ?? null, here?.chapter.id ?? null);
  });
}

// ── saving ──
async function saveNow(): Promise<boolean> {
  clearTimeout(saveTimer);
  clearTimeout(caretTimer);
  if (!view || !filePath) return true;
  if (saving) await saving;
  const doc = view.state.doc;
  const path = filePath;
  setSaveState('saving');
  saving = bridge.save(path, docToModel(doc), view.state.selection.head).then(
    (result) => {
      if (result.ok) {
        savedDoc = doc;
        setSaveState(view?.state.doc === doc ? 'saved' : 'unsaved');
        return true;
      }
      setSaveState('error', result.message);
      toast(result.message, 'error');
      return false;
    },
    (e: Error) => {
      setSaveState('error', e.message);
      toast(`Could not save: ${e.message}`, 'error');
      return false;
    },
  );
  const ok = await saving;
  saving = null;
  return ok;
}

function scheduleSave() {
  setSaveState('unsaved');
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveNow(), AUTOSAVE_MS);
}

// ── navigation controller: one path for every "go to scene" ──
function navigate(sceneId: string): boolean {
  if (!view) return false;
  const scene = outlineOf(view.state.doc).chapters.flatMap((c) => c.scenes).find((s) => s.id === sceneId);
  if (!scene) return false; // a deleted target never jumps elsewhere
  // Land on the scene's first line of prose, not in its name.
  const node = view.state.doc.nodeAt(scene.pos)!;
  let firstParagraph = scene.pos + 1;
  node.forEach((child, offset) => {
    if (firstParagraph === scene.pos + 1 && child.type === schema.nodes.scene_heading) firstParagraph = scene.pos + 1 + offset + child.nodeSize;
  });
  const sel = Selection.findFrom(view.state.doc.resolve(firstParagraph), 1, true);
  if (!sel) return false;
  const before = scroller.scrollTop;
  view.dispatch(view.state.tr.setSelection(sel).setMeta('navigation', true));
  if (typewriter.enabled) {
    typewriter.recenter(false);
  } else {
    const dom = view.nodeDOM(scene.pos) as HTMLElement | null;
    if (dom) {
      const top = dom.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTop += top - 64;
    }
  }
  jumpMotion(scroller.scrollTop - before);
  view.focus();
  return true;
}

/**
 * The scroll position is already final; only the page's paint moves. Nearby
 * targets glide into place (FLIP); distant ones slide in a short way and
 * fade up, so crossing half a book never becomes a long, dizzying scroll.
 */
function jumpMotion(delta: number) {
  const root = getComputedStyle(document.documentElement);
  const duration = parseFloat(root.getPropertyValue('--dur-jump')) || 0;
  if (!duration || Math.abs(delta) < 1) return;
  const easing = root.getPropertyValue('--ease-jump').trim() || 'ease-out';
  const near = Math.abs(delta) <= scroller.clientHeight * 1.5;
  const frames = near
    ? [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }]
    : [{ transform: `translateY(${Math.sign(delta) * 32}px)`, opacity: 0.3 }, { transform: 'translateY(0)', opacity: 1 }];
  page.animate(frames, { duration, easing });
}

// ── reading back: the spine and breadcrumb follow a hand scroll ──
function startReading() {
  reading = true;
}
let readingFrame = 0;
scroller.addEventListener('scroll', () => {
  if (!reading || readingFrame) return;
  readingFrame = requestAnimationFrame(() => {
    readingFrame = 0;
    if (!view || !reading) return;
    // The scene at the middle of the window is the one being read.
    const box = scroller.getBoundingClientRect();
    const column = view.dom.getBoundingClientRect();
    const hit = view.posAtCoords({ left: (column.left + column.right) / 2, top: box.top + box.height / 2 });
    if (!hit) return;
    const here = sceneAt(view.state.doc, hit.pos, true);
    if (here && here.scene.id !== readingHere?.scene.id) {
      readingHere = here;
      refreshChrome();
    }
  });
}, { passive: true });
scroller.addEventListener('wheel', startReading, { passive: true });

const spine = new Spine($('spine'), (id) => navigate(id));
const typewriter = new Typewriter(app, scroller, page, () => view);
const toolbar = new SelectionToolbar($('workspace'), scroller, () => view);
const find = new FindPanel($('workspace'), scroller, () => view);
find.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') toolbar.quiet(); }, true);
find.el.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-action="close"]')) toolbar.quiet(); }, true);

// ── editor ──
function dispatch(this: EditorView, tr: Transaction) {
  const before = this.state;
  const next = before.apply(tr);
  this.updateState(next);
  // Writing or moving the caret hands "where you are" back to the caret.
  if (reading && (next.doc !== before.doc || !next.selection.eq(before.selection))) {
    reading = false;
    readingHere = null;
  }
  if (next.doc !== before.doc) {
    scheduleSave();
    typewriter.recenter(true);
  } else if (!next.selection.eq(before.selection)) {
    // Recenter on explicit keyboard navigation only — never on mouse
    // selection, modifier keys, or manual scrolling.
    if (Date.now() - lastKeyNav < 150 && !tr.getMeta('navigation')) typewriter.recenter(true);
    clearTimeout(caretTimer);
    caretTimer = window.setTimeout(() => void saveNow(), CARET_SAVE_MS);
  }
  refreshChrome();
}

function load(doc: OpenedDocument) {
  clearTimeout(saveTimer);
  find.close(); // matches belong to the old document
  filePath = doc.filePath;
  let state: EditorState = createManuscriptState(doc.manuscript, {
    onReject: () => console.warn('[baretext] rejected a change that would have damaged structure'),
  });
  state = state.reconfigure({ plugins: [...state.plugins, currentScenePlugin, toolbar.plugin] });
  if (doc.caret !== null && doc.caret > 0 && doc.caret < state.doc.content.size) {
    const sel = TextSelection.near(state.doc.resolve(doc.caret));
    state = state.apply(state.tr.setSelection(sel));
  }
  savedDoc = state.doc;
  if (view) {
    view.updateState(state);
  } else {
    view = new EditorView(page, {
      state,
      dispatchTransaction: dispatch,
      attributes: { spellcheck: 'false', 'aria-label': 'Manuscript', 'aria-multiline': 'true', role: 'textbox' },
      // In typewriter mode the typewriter owns scrolling.
      handleScrollToSelection: () => typewriter.enabled,
    });
  }
  const name = doc.filePath.split('/').pop() ?? doc.filePath;
  $('filename').textContent = name;
  setSaveState('saved');
  if (doc.importedFrom) {
    const original = doc.importedFrom.split('/').pop();
    toast(`Imported “${original}” as a Baretext copy: “${name}”. The original is untouched.`);
  }
  refreshChrome();
  requestAnimationFrame(() => {
    view?.focus();
    if (typewriter.enabled) typewriter.recenter(false);
    else view?.dispatch(view.state.tr.scrollIntoView());
  });
}

// Clicking any non-text space places the caret on the nearest line (spec §4.4.2).
scroller.addEventListener('mousedown', (e) => {
  if (!view || e.button !== 0) return;
  // The scrollbar: a hand scroll, never a caret placement.
  if (e.target === scroller && e.offsetX >= scroller.clientWidth) { startReading(); return; }
  // An unnamed scene's ornament (or an unnamed first scene's number): name that scene.
  const boundary = (e.target as HTMLElement).closest('.bt-scene-boundary, .bt-num-first');
  if (boundary) {
    e.preventDefault();
    const $at = view.state.doc.resolve(view.posAtDOM(boundary, 0));
    const d = sceneDepth($at);
    if (d >= 0) nameSceneAt($at.before(d))(view.state, view.dispatch);
    view.focus();
    return;
  }
  const target = e.target as HTMLElement;
  const inText = target.closest('.ProseMirror p, .ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror blockquote');
  if (inText && !target.closest('[contenteditable="false"]')) return;
  e.preventDefault();
  const content = view.dom.getBoundingClientRect();
  const left = Math.min(Math.max(e.clientX, content.left + 1), content.right - 1);
  const hit = view.posAtCoords({ left, top: e.clientY });
  const doc = view.state.doc;
  let sel: Selection | null;
  if (hit) sel = Selection.near(doc.resolve(hit.pos));
  else if (e.clientY < content.top) sel = Selection.findFrom(doc.resolve(0), 1, true);
  else sel = Selection.findFrom(doc.resolve(doc.content.size - doc.lastChild!.nodeSize), -1, true);
  if (sel && !(sel instanceof TextSelection)) sel = Selection.findFrom(sel.$from, 1, true) ?? sel;
  if (sel) view.dispatch(view.state.tr.setSelection(sel));
  view.focus();
});

// ── commands ──
function setTypewriter(on: boolean) {
  typewriter.setEnabled(on);
  $('typewriter').dataset.on = String(on);
}
function setParagraphSpacing(spacing: ParagraphSpacing) {
  app.dataset.paragraphSpacing = spacing;
  // The caret's line moved with the layout; keep it centered.
  if (typewriter.enabled) typewriter.recenter(false);
}
function setFocus(on: boolean) {
  app.dataset.focus = String(on);
}

function runCommand(command: MenuCommand) {
  if (!view) return;
  const run = (cmd: (s: EditorState, d?: (tr: Transaction) => void) => boolean) => { cmd(view!.state, view!.dispatch); view!.focus(); };
  switch (command) {
    case 'undo': run(undo); break;
    case 'redo': run(redo); break;
    case 'bold': run(toggleBold); break;
    case 'italic': run(toggleItalic); break;
    case 'split-scene': run(splitScene); break;
    case 'pause': run(insertSectionBreak); break;
    case 'name-scene': run(nameScene); break;
    case 'quote': run(toggleQuote); break;
    case 'link': toolbar.openLink(); break;
    case 'typewriter': setTypewriter(!typewriter.enabled); break;
    case 'focus': setFocus(app.dataset.focus !== 'true'); break;
    case 'save': void saveNow().then((ok) => ok && toast('Saved')); break;
    case 'palette': togglePalette(commandsView()); break;
    case 'goto': togglePalette(jumpView()); break;
    case 'find': palette.close(); find.open(false); break;
    case 'find-replace': palette.close(); find.open(true); break;
    case 'find-next': find.next(1); break;
    case 'find-prev': find.next(-1); break;
  }
}

// ── command palette (⌘K) and jump (⌘⇧O) ──
// Targeted: only what exists and applies right now. Features add their
// commands here as they are built.
const palette = new Palette(document.body);

const SPACINGS: [ParagraphSpacing, string][] = [['full', 'Full line'], ['half', 'Half line'], ['none', 'None, indent first lines']];

function commandsView(): PaletteView {
  return {
    name: 'commands',
    placeholder: 'Type a command',
    items: () => {
      const selection = view ? hasFormattableText(view.state) : false;
      const items: PaletteItem[] = [
        { id: 'goto', group: 'Navigate', label: 'Go to chapter or scene…', keywords: 'jump navigate', keys: '⌘⇧O', keepOpen: true, run: () => palette.open(jumpView()) },
        { id: 'find', group: 'Navigate', label: 'Find…', keywords: 'search text', keys: '⌘F', run: () => runCommand('find') },
        { id: 'find-replace', group: 'Navigate', label: 'Find and replace…', keywords: 'search substitute change', keys: '⌥⌘F', run: () => runCommand('find-replace') },
        { id: 'scene-break', group: 'Insert', label: 'Scene break', keywords: 'split new scene', keys: '⌘↵', run: () => runCommand('split-scene') },
        { id: 'pause', group: 'Insert', label: 'Pause', keywords: 'section break within scene', keys: '⌘⇧↵', run: () => runCommand('pause') },
      ];
      const here = view ? currentScene(view.state) : null;
      if (here) {
        items.push({ id: 'name-scene', group: 'Insert', label: here.scene.name ? 'Rename scene' : 'Name scene', keywords: 'title heading rename scene name', run: () => runCommand('name-scene') });
      }
      if (selection) {
        items.push(
          { id: 'bold', group: 'Format', label: 'Bold', keys: '⌘B', run: () => runCommand('bold') },
          { id: 'italic', group: 'Format', label: 'Italic', keys: '⌘I', run: () => runCommand('italic') },
          { id: 'quote', group: 'Format', label: 'Quote', keywords: 'epigraph blockquote', run: () => runCommand('quote') },
          { id: 'link', group: 'Format', label: 'Link…', keywords: 'url web address', run: () => runCommand('link') },
        );
      }
      items.push(
        { id: 'typewriter', group: 'View', label: 'Typewriter mode', keywords: 'center line', keys: '⌘⇧T', state: typewriter.enabled ? 'on' : 'off', run: () => runCommand('typewriter') },
        { id: 'focus', group: 'View', label: 'Focus mode', keywords: 'hide chrome distraction quiet', keys: '⌘.', state: app.dataset.focus === 'true' ? 'on' : 'off', run: () => runCommand('focus') },
        ...SPACINGS.map(([value, text]): PaletteItem => ({
          id: `spacing-${value}`, group: 'View', label: `Paragraph spacing: ${text}`, keywords: 'gap indent',
          state: app.dataset.paragraphSpacing === value ? 'current' : undefined,
          run: () => { setParagraphSpacing(value); bridge.setPrefs({ paragraphSpacing: value }); },
        })),
        { id: 'new', group: 'File', label: 'New manuscript', keywords: 'create file', keys: '⌘N', run: () => bridge.fileCommand('new') },
        { id: 'open', group: 'File', label: 'Open…', keywords: 'file', keys: '⌘O', run: () => bridge.fileCommand('open') },
        { id: 'save', group: 'File', label: 'Save', keys: '⌘S', run: () => runCommand('save') },
        { id: 'reveal', group: 'File', label: 'Reveal in Finder', keywords: 'show file folder', run: () => { if (filePath) bridge.revealInFinder(filePath); } },
      );
      return items;
    },
  };
}

function jumpView(): PaletteView {
  const doc = view?.state.doc;
  const here = view ? currentScene(view.state) : null;
  return {
    name: 'jump',
    placeholder: 'Go to chapter or scene',
    initialId: here ? `scene-${here.scene.id}` : null,
    back: commandsView,
    items: () => {
      if (!doc) return [];
      const items: PaletteItem[] = [];
      for (const chapter of outlineOf(doc).chapters) {
        const title = chapter.title || 'Untitled';
        const first = chapter.scenes[0];
        items.push({
          id: `chapter-${chapter.id}`, group: 'Chapters', label: `${chapter.number} ${title}`,
          run: () => { if (first) navigate(first.id); },
        });
        for (const scene of chapter.scenes) {
          items.push({
            id: `scene-${scene.id}`, group: 'Chapters', label: `${scene.label} ${sceneDisplayName(scene)}`,
            keywords: title, depth: 1, state: scene.id === here?.scene.id ? 'current' : undefined,
            run: () => navigate(scene.id),
          });
        }
      }
      return items;
    },
  };
}

/** A palette key closes its own view, switches from the other, or opens. */
function togglePalette(next: PaletteView) {
  if (palette.current === next.name) { palette.close(); return; }
  palette.open(next, () => view?.focus());
}

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);
window.addEventListener('keydown', (e) => {
  if (NAV_KEYS.has(e.key)) lastKeyNav = Date.now();
  if (e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyF') { e.preventDefault(); runCommand('find-replace'); return; }
  if (!e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 's' && !e.shiftKey) { e.preventDefault(); runCommand('save'); }
  else if (k === 't' && e.shiftKey) { e.preventDefault(); runCommand('typewriter'); }
  else if (e.key === '.' && !e.shiftKey) { e.preventDefault(); runCommand('focus'); }
  else if (k === 'k' && !e.shiftKey) { e.preventDefault(); runCommand('palette'); }
  else if (k === 'o' && e.shiftKey) { e.preventDefault(); runCommand('goto'); }
  else if (k === 'f' && !e.shiftKey) { e.preventDefault(); runCommand('find'); }
  else if (k === 'g') { e.preventDefault(); runCommand(e.shiftKey ? 'find-prev' : 'find-next'); }
}, true);

// Esc steps out one layer at a time: anything open (toolbar, link field,
// later the palette or find) claims it by stopping the event; only an
// unclaimed Esc reaches here and leaves focus mode. (defaultPrevented is no
// signal: ProseMirror cancels every Esc in the editor.) Never during IME.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.isComposing || app.dataset.focus !== 'true') return;
  e.preventDefault();
  setFocus(false);
});

$('typewriter').addEventListener('click', () => runCommand('typewriter'));
$('filename').addEventListener('click', () => filePath && bridge.revealInFinder(filePath));

bridge.onMenu(runCommand);
bridge.onParagraphSpacing(setParagraphSpacing);
bridge.onDocumentOpened(load);
bridge.onFlushRequest(() => saveNow());

// ── start ──
// Every launch starts in the default mode: typewriter and focus mode are
// per-session and never restored (DECISIONS §8).
app.dataset.focus = 'false';
setParagraphSpacing(bridge.initial.paragraphSpacing);
setTypewriter(false);
bridge.loadInitial().then(load, (e: Error) => toast(`Could not open the manuscript: ${e.message}`, 'error'));

function selectText(text: string, collapseToEnd: boolean): boolean {
  if (!view) return false;
  let from = -1;
  view.state.doc.descendants((node, p) => {
    if (from >= 0) return false;
    const i = node.isText ? node.text!.indexOf(text) : -1;
    if (i >= 0) from = p + i;
    return from < 0;
  });
  if (from < 0) return false;
  const to = from + text.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, collapseToEnd ? to : from, to)));
  view.focus();
  return true;
}

// Read-only hooks for end-to-end tests (assert on model state, not DOM).
window.__baretext = {
  model: () => (view ? docToModel(view.state.doc) : null),
  selection: () => (view ? { from: view.state.selection.from, to: view.state.selection.to, head: view.state.selection.head } : null),
  currentScene: () => (view ? currentScene(view.state)?.scene.id ?? null : null),
  navigate,
  /** Place the caret at the end of a scene's last line. */
  caretToSceneEnd: (sceneId: string) => {
    if (!view) return false;
    const scene = outlineOf(view.state.doc).chapters.flatMap((c) => c.scenes).find((s) => s.id === sceneId);
    if (!scene) return false;
    const end = scene.pos + view.state.doc.nodeAt(scene.pos)!.nodeSize - 1;
    const sel = Selection.findFrom(view.state.doc.resolve(end), -1, true);
    if (sel) view.dispatch(view.state.tr.setSelection(sel));
    view.focus();
    return !!sel;
  },
  /** Place the caret right after the first occurrence of `text` in the prose. */
  caretAfter: (text: string) => selectText(text, true),
  /** Select the first occurrence of `text` in the prose. */
  selectText: (text: string) => selectText(text, false),
  /** Select from the first occurrence of `start` to the end of the first `end` after it. */
  selectRange: (start: string, end: string) => {
    if (!view) return false;
    let from = -1;
    let to = -1;
    view.state.doc.descendants((node, p) => {
      if (to >= 0) return false;
      if (!node.isText) return true;
      if (from < 0) { const i = node.text!.indexOf(start); if (i >= 0) from = p + i; }
      if (from >= 0) { const j = node.text!.indexOf(end); if (j >= 0 && p + j >= from) to = p + j + end.length; }
      return true;
    });
    if (from < 0 || to < 0) return false;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    view.focus();
    return true;
  },
  saveNow,
  isSaved: () => (view ? view.state.doc === savedDoc : true),
  filePath: () => filePath,
  toolbar: () => ({ visible: toolbar.visible, el: toolbar.el.getBoundingClientRect().toJSON() }),
  palette: () => ({ open: palette.isOpen, view: palette.current, timings: { ...palette.timings } }),
  textBetween: (from: number, to: number) => (view ? view.state.doc.textBetween(from, to, '\n') : ''),
  find: () => ({ open: find.isOpen, count: find.el.querySelector('.bt-find-count')!.textContent, ms: find.lastSearchMs }),
};
