// The window: wires the editor to the surfaces around it (spine, outline,
// palette, find, toolbar, panels, saving) and routes every command — menu,
// shortcut or palette — through runCommand. Features live in their own
// modules; this file only connects them.

import { redo, undo } from 'prosemirror-history';
import { Plugin, Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import {
  createManuscriptState,
  docToModel,
  insertSectionBreak,
  nameScene,
  nameSceneAt,
  rename,
  addChapter,
  addScene,
  moveChapter,
  moveScene,
  deleteChapter,
  deleteScene,
  closeParked,
  moveToColdStorage,
  openParked,
  parkedKey,
  restoreFromColdStorage,
  addNoteAnchor,
  anchorsIn,
  describeAnchor,
  removeNoteAnchor,
  restoreManuscript,
  sceneDepth,
  schema,
  splitScene,
  splitChapter,
  toggleBold,
  toggleItalic,
  toggleQuote,
  bookSetupOf,
} from '@baretext/editor';
import type { AppearancePrefs, BaretextBridge, MenuCommand, OpenedDocument } from '../shared/bridge';
import { currentScene, outlineOf, sceneAt, sceneDisplayName } from './outline';
import { Spine } from './spine';
import { OutlinePanel, type OutlinePresence } from './outline-panel';
import { FindPanel } from './find';
import { HistoryPanel } from './history';
import { AppearancePanel, readAppearance, sampleFrom, setAppearance } from './appearance';
import { BookActions } from './book-actions';
import { Status } from './status';
import { PageEdits } from './page-edits';
import { BookViews } from './views';
import { Sprinter } from './sprinter';
import { Palette, type PaletteView } from './palette';
import { commandsView, jumpView, type CommandContext } from './palette-commands';
import { SelectionToolbar } from './toolbar';
import { Typewriter } from './typewriter';
import { Saver } from './saving';
import { installTestHooks } from './test-hooks';
import { NotesStore } from './notes-store';
import { MarginNotes } from './margin-notes';
import { NotesPanel } from './notes-panel';
import type { Motion } from './sidebar-motion';
import { newId } from '@baretext/format';
import { SNOWFLAKE } from './icons';
import { cssNumber, cssValue, numberFormat } from './dom';

declare global {
  interface Window {
    baretext: BaretextBridge;
  }
}

const bridge = window.baretext;
// The saved theme, before anything paints.
document.documentElement.dataset.theme = bridge.initial.theme;
const $ = <T extends HTMLElement = HTMLElement>(ref: string) => document.querySelector<T>(`[data-ref="${ref}"]`)!;
const app = document.querySelector<HTMLElement>('.bt-app')!;
const scroller = $('scroller');
const page = $('page');

let view: EditorView | null = null;
let filePath: string | null = null;
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

// ── changes to the book that keep the writer's place on the page ──
const edits = new PageEdits({ view: () => view, scroller, typewriter: () => typewriter, changed: () => syncOutline() });
const { keepCaretLine, outside: outsideChange } = edits;

// ── status: toasts, and the word count ──
const status = new Status($('toast'), $('words'));
const toast = status.toast;
const showWords = status.words;

let chromeFrame = 0;
function refreshChrome() {
  if (chromeFrame) return;
  chromeFrame = requestAnimationFrame(() => {
    chromeFrame = 0;
    if (!view) return;
    const state = view.state;
    const outline = outlineOf(state.doc);
    corkboard.update(outline);
    const parked = parkedKey.getState(state);
    const open = parked ? outline.parked.find((p) => p.id === parked) ?? null : null;
    if (open) { refreshParked(open, outline); return; }
    const here = (reading && readingHere) || currentScene(state);
    // The count in the number face, the word in the interface face.
    showWords(outline.words, state.doc.attrs.target);
    $('title').textContent = state.doc.firstChild!.textContent || 'Untitled';
    $('crumb').textContent = corkboard.isOpen
      ? '' // (the chip says where; the status bar has the totals)
      : here
        // Names exactly as the writer typed them (only the book title is set in capitals).
        ? `Chapter ${here.chapter.number}${here.chapter.title ? ` · ${here.chapter.title}` : ''} · ${sceneDisplayName(here.scene)}`
        : '';
    spine.update(outline, here?.scene.id ?? null, here?.chapter.id ?? null);
    outlinePanel.update(outline, state.doc.firstChild!.textContent, here?.scene.id ?? null, here?.chapter.id ?? null);
  });
}

/** The chrome while a parked scene is open: its name, its words, its row in the outline. */
function refreshParked(open: ReturnType<typeof outlineOf>['parked'][number], outline: ReturnType<typeof outlineOf>) {
  const name = open.name || 'Unnamed scene';
  showWords(open.words, null, 'in this scene');
  $('title').textContent = view!.state.doc.firstChild!.textContent || 'Untitled';
  $('crumb').textContent = `Cold Storage · ${name}`;
  $('parked-name').textContent = name;
  $('parked-restore').title = open.from?.chapter ? `Back to chapter ${open.from.chapter}` : 'Back into the manuscript (end of the last chapter)';
  spine.update(outline, null, null);
  outlinePanel.update(outline, view!.state.doc.firstChild!.textContent, open.id, null);
}

// ── Cold Storage: a parked scene opens on the page; Esc goes back ──
/** Where the writer was in the manuscript when a parked scene opened. */
let parkedReturn: { pos: number; scroll: number } | null = null;

function openParkedScene(id: string) {
  if (!view) return;
  if (!parkedKey.getState(view.state)) parkedReturn = { pos: view.state.selection.head, scroll: scroller.scrollTop };
  palette.close();
  find.close();
  if (!openParked(id)(view.state, view.dispatch)) return;
  scroller.scrollTop = 0;
  view.focus();
}

/** Close the parked scene; `returnToPlace` puts the writer back where they were (else the caller moves them). */
function leaveParked(returnToPlace = true) {
  if (!view || !parkedKey.getState(view.state)) return;
  const back = parkedReturn;
  parkedReturn = null;
  closeParked(returnToPlace ? back?.pos ?? null : null)(view.state, view.dispatch);
  if (returnToPlace && back) scroller.scrollTop = back.scroll;
  view.focus();
}

function parkScene(id: string) {
  if (!view) return;
  const outline = outlineOf(view.state.doc);
  const scene = outline.chapters.flatMap((c) => c.scenes).find((s) => s.id === id);
  if (!scene || !moveToColdStorage(id)(view.state, view.dispatch)) return;
  syncOutline();
  toast(`Moved ${scene.label}${scene.name ? ` “${scene.name}”` : ''} to Cold Storage. ⌘Z undoes it.`);
}

function restoreScene(id: string, chapterId?: string, index?: number) {
  if (!view) return;
  const parked = outlineOf(view.state.doc).parked.find((p) => p.id === id);
  const wasOpen = parkedKey.getState(view.state) === id;
  if (!parked) return;
  if (wasOpen) parkedReturn = null; // it goes into the manuscript and the writer follows it there
  if (!restoreFromColdStorage(id, chapterId, index)(view.state, view.dispatch)) return;
  syncOutline();
  const placed = outlineOf(view.state.doc).chapters.flatMap((c) => c.scenes).find((s) => s.id === id);
  if (wasOpen && placed) navigate(id); // it was on the page: follow it into the manuscript
  toast(`Restored ${parked.name ? `“${parked.name}”` : 'the scene'}${placed ? ` as ${placed.label}` : ''}. ⌘Z undoes it.`);
}

// ── navigation controller: one path for every "go to scene" ──
function navigate(sceneId: string): boolean {
  if (!view) return false;
  if (app.dataset.view === 'corkboard') setView('manuscript');
  leaveParked(false); // going somewhere in the manuscript
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
  const duration = cssNumber('--dur-jump');
  if (!duration || Math.abs(delta) < 1) return;
  const easing = cssValue('--ease-jump', 'ease-out');
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

/** Open notes per scene id (the outline's rows and the corkboard's cards show them). */
function openNoteCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  if (!view) return counts;
  const anchors = anchorsIn(view.state.doc);
  for (const n of notes.all) {
    const scene = !n.resolved && anchors.get(n.id)?.scene;
    if (scene) counts.set(scene, (counts.get(scene) ?? 0) + 1);
  }
  return counts;
}

// ── outline: a column beside the page, opened deliberately (button, ⌘\, menu) ──
const outlinePanel = new OutlinePanel($('workspace'), {
  navigate: (id) => navigate(id),
  toEditor: () => focusWriting(),
  rename: (id, name) => {
    const changed = view ? rename(id, name)(view.state, view.dispatch) : false;
    if (changed) syncOutline(); // the row shows its new name at once
    return changed;
  },
  addScene: (chapterId) => newSceneIn(chapterId),
  addChapter: () => newChapter(),
  moveScene: (id, chapterId, index) => {
    const moved = view ? moveScene(id, chapterId, index)(view.state, view.dispatch) : false;
    if (moved) syncOutline();
    return moved;
  },
  moveChapter: (id, index) => {
    const moved = view ? moveChapter(id, index)(view.state, view.dispatch) : false;
    if (moved) syncOutline();
    return moved;
  },
  park: (id) => parkScene(id),
  openParked: (id) => openParkedScene(id),
  restore: (id, chapterId, index) => restoreScene(id, chapterId, index),
  noteCounts: () => openNoteCounts(),
  deleteScene: (id) => deleteFromOutline(id, 'scene'),
  deleteChapter: (id) => deleteFromOutline(id, 'chapter'),
  onPresence: (presence: OutlinePresence) => {
    const open = presence === 'pinned';
    $('sidebar').setAttribute('aria-pressed', String(open));
    $('sidebar').setAttribute('aria-label', open ? 'Hide outline' : 'Show outline');
    $('sidebar').title = `${open ? 'Hide' : 'Show'} outline  ⌘\\`;
  },
});

/**
 * Delete a scene or chapter (confirmed in the outline). A snapshot keeps the
 * manuscript as it was; one ⌘Z brings it back.
 */
function deleteFromOutline(id: string, kind: 'scene' | 'chapter') {
  if (!view) return;
  const outline = outlineOf(view.state.doc);
  const chapter = outline.chapters.find((c) => c.id === id);
  const scene = outline.chapters.flatMap((c) => c.scenes).find((s) => s.id === id);
  const parked = outline.parked.find((p) => p.id === id);
  const what = kind === 'chapter' && chapter ? `chapter ${chapter.number}${chapter.title ? ` “${chapter.title}”` : ''}`
    : scene ? `${scene.label}${scene.name ? ` “${scene.name}”` : ''}`
    : parked ? `${parked.name ? `“${parked.name}”` : 'a scene'} from Cold Storage` : null;
  if (!what) return;
  const count = chapter && kind === 'chapter' ? chapter.scenes.reduce((n, s) => n + s.words, 0) : (scene ?? parked)?.words ?? 0;
  snapshotNow(`Before deleting ${what}`.slice(0, 80));
  const command = kind === 'chapter' ? deleteChapter(id) : deleteScene(id);
  if (!command(view.state, view.dispatch)) return;
  syncOutline();
  toast(`Deleted ${what} (${numberFormat.format(count)} ${count === 1 ? 'word' : 'words'}). ⌘Z brings it back.`);
}

/** Add an empty scene at the end of a chapter and go there, ready to write. */
function newSceneIn(chapterId: string) {
  leaveParked(false);
  if (!view || !addScene(chapterId)(view.state, view.dispatch)) return;
  const here = currentScene(view.state);
  syncOutline();
  if (here) navigate(here.scene.id); // scroll and glide to it
}

/** Add a chapter at the end of the book and go to it; returns its identity. */
function newChapter(): string | null {
  leaveParked(false);
  if (!view || !addChapter()(view.state, view.dispatch)) return null;
  const here = currentScene(view.state);
  syncOutline();
  if (here) navigate(here.scene.id);
  return here?.chapter.id ?? null;
}

/** Give the outline the manuscript as it is now, not as of the last painted frame. */
function syncOutline() {
  if (!view) return;
  const here = (reading && readingHere) || currentScene(view.state);
  outlinePanel.update(outlineOf(view.state.doc), view.state.doc.firstChild!.textContent, here?.scene.id ?? null, here?.chapter.id ?? null);
}


/**
 * The column opens or closes: the layout changes at once, then the column
 * slides and the page glides from where it was to its new center (FLIP),
 * so nothing in the manuscript is laid out again during the motion.
 */
interface SideColumn { motion(open: boolean, m: Motion): void }
function sidebarMotion(columns: SideColumn[], open: boolean, change: () => void, animate = true) {
  const before = page.getBoundingClientRect().left;
  keepCaretLine(change);
  const duration = animate ? cssNumber('--dur-sidebar') : 0;
  const easing = cssValue('--ease-sidebar', 'ease-out');
  const follow = cssValue('--ease-sidebar-follow', easing);
  for (const c of columns) c.motion(open, { duration, easing, follow });
  const dx = before - page.getBoundingClientRect().left;
  if (duration && Math.abs(dx) >= 1) {
    page.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], { duration, easing, composite: 'add' });
  }
  return duration;
}

function setOutlinePinned(pinned: boolean, persist = true, animate = true) {
  sidebarMotion([outlinePanel], pinned, () => {
    app.dataset.outline = pinned ? 'pinned' : 'hidden';
    outlinePanel.setPresence(pinned ? 'pinned' : 'hidden');
  }, animate && app.dataset.focus !== 'true');
  if (persist) bridge.setPrefs({ outline: pinned ? 'pinned' : 'hidden' });
}
// ── surfaces ──
const typewriter = new Typewriter(app, scroller, page, () => view);
const saver = new Saver(bridge, () => view, () => filePath, $('save-state'), app);
const toolbar = new SelectionToolbar($('workspace'), scroller, () => view, () => runCommand('add-note'));
const find = new FindPanel($('workspace'), scroller, () => view, () => snapshotNow('Before Replace All'));

// ── notes: floating beside their passages, and a panel on the right ──
const notes = new NotesStore(bridge, () => view, (message) => toast(message, 'error'));
const margin = new MarginNotes(page, scroller, {
  view: () => view,
  store: notes,
  openInPanel: (id) => setNotesPanel(true, () => notesPanel.focusNote(id)),
  discard: (id) => discardNote(id),
  toEditor: () => focusWriting(),
});
const notesPanel = new NotesPanel($('workspace'), {
  view: () => view,
  store: notes,
  show: (id) => showNote(id),
  remove: (id) => discardNote(id),
  toEditor: () => focusWriting(),
  onPresence: (open) => {
    $('notes-button').setAttribute('aria-pressed', String(open));
    $('notes-button').setAttribute('aria-label', open ? 'Hide notes' : 'Show notes');
  },
});
notes.onChange(() => {
  outlinePanel.notesChanged();
  const open = notes.all.filter((n) => !n.resolved).length;
  $('notes-badge').textContent = open ? String(open) : '';
});

/**
 * Open or close the notes panel. The floating notes hand off to it: they
 * fade out (drifting toward the panel) and, as they finish, it slides in;
 * closing, it slides out and they drift back in as it settles — one
 * motion, not two. `then` runs once the panel is open (or closed).
 */
let notesHandoff: { queued: Array<() => void>; cancel(): void } | null = null;
function setNotesPanel(open: boolean, then?: () => void) {
  if (notesHandoff) {
    if (open) { if (then) notesHandoff.queued.push(then); return; } // already on its way
    notesHandoff.cancel(); // changed their mind mid-fade: the cards come back
    then?.();
    return;
  }
  if (open === notesPanel.isOpen) { then?.(); return; }
  const out = open && marginShowsNotes() && margin.el.childElementCount > 0 ? cssNumber('--dur-notes-out') : 0;
  if (out) {
    // The cards fade where they are; the page makes room only once they've gone.
    const handoff = { queued: then ? [then] : [], cancel: () => { notesHandoff = null; void margin.fade(true, 0); } };
    notesHandoff = handoff;
    void margin.fade(false, out).then((done) => {
      if (notesHandoff !== handoff || !done) return;
      notesHandoff = null;
      slideNotesPanel(true);
      for (const f of handoff.queued) f();
    });
    return;
  }
  slideNotesPanel(open);
  then?.();
}

function slideNotesPanel(open: boolean) {
  const slide = sidebarMotion([notesPanel], open, () => {
    app.dataset.notes = open ? 'open' : 'closed';
    notesPanel.setOpen(open);
  }, app.dataset.focus !== 'true');
  margin.refresh();
  if (!open && marginShowsNotes()) void margin.fade(true, cssNumber('--dur-notes-in'), slide * 0.6);
}

/** The notes panel is open, or on its way. */
function notesPanelWanted(): boolean {
  return notesPanel.isOpen || !!notesHandoff;
}

/** Margin cards are shown in manuscript mode, but not with the panel open, in typewriter or focus mode, or without room. */
function marginShowsNotes(): boolean {
  return !notesPanel.isOpen && !typewriter.enabled && app.dataset.focus !== 'true' && !margin.isCompact;
}

/** Open a note where it can be seen: its card in the margin, or the panel. */
function revealNote(id: string, focus: boolean) {
  if (marginShowsNotes()) { margin.setActive(id, focus); return; }
  setNotesPanel(true, () => notesPanel.focusNote(id));
}

/**
 * Add a note: about the selected passage (⇧⌘M, the toolbar, the palette),
 * or a general one when nothing is selected. It opens ready to type.
 */
function addNote() {
  if (!view) return;
  if (view.state.selection.empty) {
    setNotesPanel(true, () => notesPanel.newGeneral());
    return;
  }
  const id = newId();
  if (!addNoteAnchor(id)(view.state, view.dispatch)) {
    toast('A note goes on a passage within one scene. Select some text in a scene first.');
    return;
  }
  notes.create(describeAnchor(view.state.doc, anchorsIn(view.state.doc).get(id)!), id);
  revealNote(id, true);
}

/** A note and its anchor go (deleted, or left empty). */
function discardNote(id: string) {
  if (view) removeNoteAnchor(id)(view.state, view.dispatch);
  notes.remove(id);
  margin.setActive(null);
}

/** Go to a note's passage: on the page (opening its parked scene if need be), its card active. */
function showNote(id: string) {
  if (!view) return;
  const a = anchorsIn(view.state.doc).get(id);
  if (!a) return;
  const parked = outlineOf(view.state.doc).parked.some((p) => p.id === a.scene);
  if (parked) openParkedScene(a.scene); else leaveParked(false);
  const range = anchorsIn(view.state.doc).get(id)!;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from)).scrollIntoView());
  const dom = view.domAtPos(range.from).node as HTMLElement;
  (dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView({ block: 'center' });
  view.focus();
  margin.setActive(id);
}

/** A point-in-time snapshot of the manuscript as it is now (before a risky change). */
function snapshotNow(reason: string) {
  if (view && filePath) void bridge.takeSnapshot(filePath, docToModel(view.state.doc), 'point', reason);
}

const appearance = new AppearancePanel(document.body, {
  current: () => readAppearance(app),
  sample: () => sampleFrom(view?.state ?? null),
  save: (p) => { applyAppearance(p); bridge.setPrefs(p); },
  onClose: () => focusWriting(),
});

// The book as a whole: Book Settings, Export (⇧⌘E), Print (⌘P).
const book = new BookActions({
  bridge,
  view: () => view,
  filePath: () => filePath,
  exportableNotes: () => notes.all.filter((n) => !n.resolved && n.body),
  change: (command) => outsideChange(command),
  toast,
  onClose: () => focusWriting(),
});

// ── views of the book: the manuscript, the corkboard (⇧⌘C; DECISIONS §24) ──
const views = new BookViews({
  app,
  workspace: $('workspace'),
  bridge,
  view: () => view,
  edits,
  navigate: (id) => navigate(id),
  noteCounts: () => openNoteCounts(),
  deleteScene: (id) => deleteFromOutline(id, 'scene'),
  bookSettings: () => book.openSetup(),
  toast,
  beforeBoard: () => {
    if (sprinter.active) return false; // (Sprinter has no other views)
    palette.close();
    find.close();
    return true;
  },
  focusPage: () => focusWriting(),
  changed: () => refreshChrome(),
});
const corkboard = views.board;
const setView = views.set;
// In the top bar's right cluster: the board's view controls, then (divided) the view chips; its totals in the status bar.
$('notes-button').before(corkboard.controls);
$('notes-button').after(views.tabs.el);
$('words').after(corkboard.summary);

// ── Sprinter (⇧⌘S): its own module; the manuscript side is here ──
const sprinter = new Sprinter({
  app,
  workspace: $('workspace'),
  bridge,
  view: () => view,
  filePath: () => filePath,
  toast,
  saveBook: () => saver.saveNow(),
  openBook: (book) => openBook(book),
  setMode: (mode) => setMode(mode),
  showWords: (words) => showWords(words),
  focusBook: () => focusWriting(),
});

let onLoaded: ((filePath: string) => void) | null = null;

/** Open `book` in the window (the current one is saved first); true once it is open. */
async function openBook(book: string): Promise<boolean> {
  if (book === filePath) return true;
  const loaded = new Promise<string>((resolve) => { onLoaded = resolve; });
  if (!(await bridge.openBook(book))) { onLoaded = null; return false; }
  await loaded;
  return true;
}

/** Back to whatever page is being written on: the sprint page in a sprint, else the manuscript. */
function focusWriting() {
  if (sprinter.active && sprinter.page.isOpen) sprinter.focus();
  else if (corkboard.isOpen) corkboard.focus(); // (a panel closed over the board: back to its card)
  else view?.focus();
}


/**
 * Sprinter: the sprint page over the manuscript, with less structure (no
 * numbering, spine, outline or notes), in focus mode. Leaving restores the
 * outline, notes and focus mode as they were; the manuscript's caret and
 * scroll never moved.
 */
let beforeSprint: { outline: boolean; notes: boolean; focus: boolean } | null = null;
function setMode(mode: 'manuscript' | 'sprinter') {
  if (app.dataset.mode === mode) return;
  if (mode === 'sprinter') {
    beforeSprint = { outline: outlinePanel.presence === 'pinned', notes: notesPanelWanted(), focus: app.dataset.focus === 'true' };
    palette.close();
    find.close();
    if (beforeSprint.outline) setOutlinePinned(false, false);
    if (beforeSprint.notes) setNotesPanel(false);
    app.dataset.mode = 'sprinter';
    if (!beforeSprint.focus) setFocus(true, false);
    showWords(sprinter.page.words());
  } else {
    const before = beforeSprint;
    beforeSprint = null;
    app.dataset.mode = 'manuscript';
    if (before && !before.focus) setFocus(false);
    if (before?.outline) setOutlinePinned(true, false);
    if (before?.notes) setNotesPanel(true);
    refreshChrome();
  }
  syncTypewriterSwitch();
  bridge.modeChanged(mode);
  view?.setProps({}); // re-evaluates `editable`
  margin.refresh();
  focusWriting();
}

/** The status bar's switch shows the typewriter of the page being written on. */
function syncTypewriterSwitch() {
  $('typewriter').setAttribute('aria-checked', String(sprinter.active ? sprinter.page.typewriter.enabled : typewriter.enabled));
}


const history = new HistoryPanel(document.body, {
  bridge,
  filePath: () => filePath,
  current: () => (view ? docToModel(view.state.doc) : null),
  currentWords: () => (view ? outlineOf(view.state.doc).words : 0),
  restore: (m, from) => {
    if (!view) return;
    view.dispatch(restoreManuscript(view.state, m));
    view.focus();
    const at = new Date(from.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    toast(`Restored the version from ${at}. ⌘Z undoes it.`);
  },
  onClose: () => focusWriting(),
});
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
  const parkedNow = parkedKey.getState(next);
  if (parkedNow !== parkedKey.getState(before)) {
    app.dataset.parked = String(!!parkedNow);
    margin.refresh(); // another page: its notes, not the manuscript's
    // Closed some other way than Back (its scene deleted): return to where the writer was.
    const back = parkedNow ? null : parkedReturn;
    parkedReturn = parkedNow ? parkedReturn : null;
    if (back) requestAnimationFrame(() => {
      if (!view || parkedKey.getState(view.state)) return;
      const sel = Selection.findFrom(view.state.doc.resolve(Math.min(back.pos, view.state.doc.content.size)), -1, true);
      if (sel) view.dispatch(view.state.tr.setSelection(sel));
      scroller.scrollTop = back.scroll;
    });
  }
  if (next.doc !== before.doc) {
    notes.textChanged();
    margin.refresh();
    notesPanel.refresh();
    saver.changed();
    typewriter.recenter(true);
  } else if (!next.selection.eq(before.selection)) {
    // Recenter on explicit keyboard navigation only — never on mouse
    // selection, modifier keys, or manual scrolling.
    if (Date.now() - lastKeyNav < 150 && !tr.getMeta('navigation')) typewriter.recenter(true);
    saver.caretMoved();
  }
  refreshChrome();
}

function load(doc: OpenedDocument) {
  // Everything open belongs to the old document: matches, versions, the sample, the palette's list.
  find.close();
  history.close();
  appearance.close();
  book.close();
  palette.close();
  filePath = doc.filePath;
  let state: EditorState = createManuscriptState(doc.manuscript, {
    onReject: () => console.warn('[baretext] rejected a change that would have damaged structure'),
  });
  state = state.reconfigure({ plugins: [...state.plugins, currentScenePlugin, toolbar.plugin] });
  if (doc.caret !== null && doc.caret > 0 && doc.caret < state.doc.content.size) {
    const sel = TextSelection.near(state.doc.resolve(doc.caret));
    state = state.apply(state.tr.setSelection(sel));
  }
  if (view) {
    view.updateState(state);
  } else {
    view = new EditorView(page, {
      state,
      dispatchTransaction: dispatch,
      // While a sprint is open the manuscript takes no typing at all (commands
      // like placing the sprint still change it).
      editable: () => app.dataset.mode !== 'sprinter',
      attributes: { spellcheck: 'false', 'aria-label': 'Manuscript', 'aria-multiline': 'true', role: 'textbox' },
      // In typewriter mode the typewriter owns scrolling.
      handleScrollToSelection: () => typewriter.enabled,
    });
  }
  const name = doc.filePath.split('/').pop() ?? doc.filePath;
  $('filename').textContent = name;
  saver.reset(view.state.doc);
  margin.setActive(null);
  void notes.load(doc.filePath);
  if (doc.notice) toast(doc.notice, 'error');
  else if (doc.importedFrom) {
    const original = doc.importedFrom.split('/').pop();
    toast(`Imported “${original}” as a Baretext copy: “${name}”. The original is untouched.`);
  }
  refreshChrome();
  if (doc.created) book.openSetup(true); // a new book: what is it?
  requestAnimationFrame(() => {
    // To the page — unless a dialog opened meanwhile: it keeps the keyboard.
    // (Anything else, like a half-typed rename in the old book, gives way.)
    if (!document.activeElement?.closest('[role="dialog"][data-open="true"]')) focusWriting();
    if (typewriter.enabled) typewriter.recenter(false);
    else view?.dispatch(view.state.tr.scrollIntoView());
  });
  const loaded = onLoaded;
  onLoaded = null;
  loaded?.(doc.filePath);
}

// Clicking a note's passage brings its note forward (in the margin, or the panel when there's no room).
page.addEventListener('click', (e) => {
  // The innermost open note's passage (notes may overlap; resolved ones read as plain text).
  const anchor = [...document.elementsFromPoint(e.clientX, e.clientY)].find((el) => el.classList.contains('bt-note-anchor') && !notes.get((el as HTMLElement).dataset.note!)?.resolved) as HTMLElement | undefined;
  if (!anchor) return;
  const id = anchor.dataset.note!;
  const note = notes.get(id);
  if (!note || note.resolved) return;
  if (marginShowsNotes()) margin.setActive(id);
  else revealNote(id, true);
});

// Clicking any non-text space places the caret on the nearest line (spec §4.4.2).
scroller.addEventListener('mousedown', (e) => {
  if (!view || e.button !== 0) return;
  // The scrollbar: a hand scroll, never a caret placement.
  if (e.target === scroller && e.offsetX >= scroller.clientWidth) { startReading(); return; }
  // A margin note's own clicks (its text box, Cancel, Save, Resolve) stay in the note.
  if ((e.target as HTMLElement).closest('.bt-margin-notes')) return;
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
let twFadeTimer: number | undefined;
function setTypewriter(on: boolean) {
  const turningOff = typewriter.enabled && !on;
  // Turning off: the caret's line stays exactly where it is on screen, even
  // though the centering padding goes away; the fade eases out.
  let anchor: number | null = null;
  if (turningOff && view) {
    try { anchor = view.coordsAtPos(view.state.selection.head).top; } catch { anchor = null; }
  }
  clearTimeout(twFadeTimer);
  if (turningOff) {
    app.dataset.twFade = 'true';
    const ms = cssNumber('--dur-tw-off');
    twFadeTimer = window.setTimeout(() => { delete app.dataset.twFade; }, ms);
  } else {
    delete app.dataset.twFade;
  }
  typewriter.setEnabled(on);
  if (anchor !== null && view) {
    scroller.scrollTop += view.coordsAtPos(view.state.selection.head).top - anchor;
  }
  $('typewriter').setAttribute('aria-checked', String(on));
}
/** Apply appearance choices at once; the page reflows and the caret's line stays where it is on screen. */
function applyAppearance(p: AppearancePrefs) {
  keepCaretLine(() => setAppearance(app, p));
}
const FOCUS_HINT = 'Esc or ⌘. to leave focus';
function setFocus(on: boolean, hint = true) {
  if (on && (outlinePanel.el.contains(document.activeElement) || notesPanel.el.contains(document.activeElement))) focusWriting();
  // The open side columns step aside (or come back) with the rest of the chrome.
  const columns: SideColumn[] = [];
  if (app.dataset.outline === 'pinned') columns.push(outlinePanel);
  if (notesPanel.isOpen) columns.push(notesPanel);
  if (columns.length && app.dataset.focus !== String(on)) sidebarMotion(columns, !on, () => { app.dataset.focus = String(on); });
  app.dataset.focus = String(on);
  // Focus mode is entered (the button goes with the rest of the chrome) and
  // left by Esc or ⌘. — so say so, briefly, on the way in.
  // The caret's line is kept clear of the dissolving edges.
  const m = on ? cssNumber('--focus-caret-margin') : 5;
  view?.setProps({ scrollMargin: m, scrollThreshold: on ? m : 0 });
  if (on && hint) toast(FOCUS_HINT);
  else if ($('toast').textContent === FOCUS_HINT) $('toast').dataset.visible = 'false';
}

/** In Sprinter: saving, the palette and focus mode are the window's; the rest is the sprint's. */
function runSprinterCommand(command: MenuCommand) {
  switch (command) {
    case 'save': void Promise.all([sprinter.flush(), saver.saveNow()]).then(([a, b]) => a && b && toast('Saved')); break;
    case 'palette': togglePalette(commandsView(commands)); break;
    case 'focus': setFocus(app.dataset.focus !== 'true'); break;
    default: palette.close(); sprinter.command(command); syncTypewriterSwitch();
  }
}

/** Commands that act on the page: from the corkboard they go back to it first. */
const ON_THE_PAGE = new Set<MenuCommand>([
  'typewriter', 'focus', 'bold', 'italic', 'link', 'quote', 'split-scene', 'split-chapter', 'pause', 'name-scene',
  'find', 'find-replace', 'find-next', 'find-prev', 'add-note', 'notes', 'outline', 'outline-focus', 'park-scene', 'sprint', 'mode',
]);

function runCommand(command: MenuCommand) {
  if (!view) return;
  // A panel that covers the window (Appearance, History) keeps every other
  // command out until it closes; saving is always allowed.
  if ((appearance.isOpen || history.isOpen || book.isOpen || sprinter.panelOpen) && command !== 'save') return;
  if (sprinter.active) { runSprinterCommand(command); return; }
  // On the corkboard, commands that act on the page show the page first.
  if (corkboard.isOpen && ON_THE_PAGE.has(command)) setView('manuscript');
  // (Undo from the board changes the book without leaving the board.)
  const run = (cmd: (s: EditorState, d?: (tr: Transaction) => void) => boolean) => { cmd(view!.state, view!.dispatch); if (!corkboard.isOpen) view!.focus(); };
  switch (command) {
    case 'undo': run(undo); break;
    case 'redo': run(redo); break;
    case 'bold': run(toggleBold); break;
    case 'italic': run(toggleItalic); break;
    case 'split-scene': run(splitScene); break;
    case 'split-chapter': run(splitChapter); break;
    case 'pause': run(insertSectionBreak); break;
    case 'name-scene': run(nameScene); break;
    case 'quote': run(toggleQuote); break;
    case 'link': toolbar.openLink(); break;
    case 'typewriter': setTypewriter(!typewriter.enabled); break;
    case 'focus': setFocus(app.dataset.focus !== 'true'); break;
    case 'save': void saver.saveNow().then((ok) => ok && toast('Saved')); break;
    case 'palette': togglePalette(commandsView(commands)); break;
    case 'goto': togglePalette(jumpView(commands)); break;
    case 'find': palette.close(); leaveParked(); find.open(false); break;
    case 'find-replace': palette.close(); leaveParked(); find.open(true); break;
    case 'add-note': addNote(); break;
    case 'notes': setNotesPanel(!notesPanelWanted()); break;
    case 'park-scene': { const here = currentScene(view.state); if (here) parkScene(here.scene.id); break; }
    case 'find-next': find.next(1); break;
    case 'find-prev': find.next(-1); break;
    case 'appearance': palette.close(); find.close(); history.close(); appearance.open(); break;
    case 'history': palette.close(); find.close(); void history.open(false); break;
    case 'export': palette.close(); find.close(); book.openExport(); break;
    case 'print': palette.close(); void book.print(); break;
    case 'book-settings': palette.close(); find.close(); book.openSetup(); break;
    case 'corkboard': palette.close(); setView(corkboard.isOpen ? 'manuscript' : 'corkboard'); break;
    case 'sprint': palette.close(); find.close(); sprinter.openSetup(); break;
    case 'sprints': palette.close(); find.close(); sprinter.openLibrary(); break;
    // Choosing Sprinter opens setup (ending a sprint is handled above).
    case 'mode': palette.close(); find.close(); sprinter.openSetup(); break;
    case 'snapshot': palette.close(); find.close(); void history.open(true); break;
    case 'new-scene': { const here = currentScene(view.state); if (here) newSceneIn(here.chapter.id); break; }
    case 'new-chapter': {
      const id = newChapter();
      // Name it where it is: in the outline when that is open, else on the page.
      if (id && outlinePanel.presence === 'pinned') outlinePanel.startRename(id, 'editor');
      else if (id && view) { const pos = outlineOf(view.state.doc).chapters.find((c) => c.id === id)!.pos; view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 2))); view.focus(); }
      break;
    }
    case 'outline': setOutlinePinned(outlinePanel.presence !== 'pinned'); break;
    case 'outline-focus': {
      palette.close();
      if (app.dataset.focus === 'true') setFocus(false);
      if (outlinePanel.presence === 'hidden') setOutlinePinned(true);
      syncOutline();
      outlinePanel.focusTree();
      break;
    }
  }
}

// ── command palette (⌘K) and jump (⌘⇧O) ──
const palette = new Palette(document.body);
const commands: CommandContext = {
  view: () => view,
  run: (command) => runCommand(command),
  navigate: (id) => navigate(id),
  open: (next) => palette.open(next),
  isOn: (toggle) => toggle === 'corkboard' ? corkboard.isOpen : toggle === 'outline' ? outlinePanel.presence === 'pinned' : toggle === 'typewriter' ? (sprinter.active ? sprinter.page.typewriter.enabled : typewriter.enabled) : app.dataset.focus === 'true',
  fileCommand: (command) => bridge.fileCommand(command),
  reveal: () => { if (filePath) bridge.revealInFinder(filePath); },
  parked: () => (view ? parkedKey.getState(view.state) ?? null : null),
  mode: () => (sprinter.active ? 'sprinter' : 'manuscript'),
  timer: () => ({ running: sprinter.timer.running, paused: sprinter.timer.paused, hidden: sprinter.timer.hidden }),
  leaveParked: () => leaveParked(),
  restoreParked: () => { const id = view && parkedKey.getState(view.state); if (id) restoreScene(id); },
};

/** A palette key closes its own view, switches from the other, or opens. */
function togglePalette(next: PaletteView) {
  if (palette.current === next.name) { palette.close(); return; }
  palette.open(next, () => focusWriting());
}

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);
window.addEventListener('keydown', (e) => {
  if (NAV_KEYS.has(e.key)) lastKeyNav = Date.now();
  if (e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyF') { e.preventDefault(); runCommand('find-replace'); return; }
  if (e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === 'Backslash') { e.preventDefault(); runCommand(e.altKey ? 'outline-focus' : 'outline'); return; }
  if (!e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  // Undo and redo wherever the keyboard is (the corkboard, a panel's button);
  // an editor or a text field keeps its own.
  if (k === 'z' && !(e.target as Element | null)?.closest?.('.ProseMirror, input, textarea')) {
    e.preventDefault();
    runCommand(e.shiftKey ? 'redo' : 'undo');
    return;
  }
  if (k === 's' && !e.shiftKey) { e.preventDefault(); runCommand('save'); }
  else if (k === 't' && e.shiftKey) { e.preventDefault(); runCommand('typewriter'); }
  else if (e.key === '.' && !e.shiftKey) { e.preventDefault(); runCommand('focus'); }
  else if (k === 'k' && !e.shiftKey) { e.preventDefault(); runCommand('palette'); }
  else if (e.key === ',' && !e.shiftKey) { e.preventDefault(); runCommand('appearance'); }
  else if (k === 'm' && e.shiftKey) { e.preventDefault(); runCommand('add-note'); }
  else if (k === 'n' && e.shiftKey) { e.preventDefault(); runCommand('notes'); }
  else if (k === 'e' && e.shiftKey) { e.preventDefault(); runCommand('export'); }
  else if (k === 'p' && !e.shiftKey) { e.preventDefault(); runCommand('print'); }
  else if (k === 'c' && e.shiftKey) { e.preventDefault(); runCommand('corkboard'); }
  else if (k === 's' && e.shiftKey) { e.preventDefault(); runCommand('sprint'); }
  else if (k === 'd' && e.shiftKey) { e.preventDefault(); runCommand('mode'); }
  else if (k === 'h' && e.shiftKey) { e.preventDefault(); runCommand('sprint-hide'); }
  else if (k === 'o' && e.shiftKey) { e.preventDefault(); runCommand('goto'); }
  else if (k === 'f' && !e.shiftKey) { e.preventDefault(); runCommand('find'); }
  else if (k === 'g') { e.preventDefault(); runCommand(e.shiftKey ? 'find-prev' : 'find-next'); }
}, true);

// Esc steps out one layer at a time: anything open (toolbar, link field,
// later the palette or find) claims it by stopping the event; only an
// unclaimed Esc reaches here and leaves focus mode. (defaultPrevented is no
// signal: ProseMirror cancels every Esc in the editor.) Never during IME.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.isComposing) return;
  if (view && parkedKey.getState(view.state)) { e.preventDefault(); leaveParked(); return; } // back to the manuscript first
  if (app.dataset.focus !== 'true') return;
  e.preventDefault();
  setFocus(false);
});

// Status switches never take focus from the manuscript (the caret stays visible).
for (const t of document.querySelectorAll<HTMLElement>('.bt-toggle')) t.addEventListener('mousedown', (e) => e.preventDefault());
$('sidebar').addEventListener('mousedown', (e) => e.preventDefault());
$('sidebar').addEventListener('click', () => runCommand('outline'));
$('notes-button').addEventListener('mousedown', (e) => e.preventDefault());
$('notes-button').addEventListener('click', () => runCommand('notes'));
$('typewriter').addEventListener('click', () => runCommand('typewriter'));
$('focus').addEventListener('click', () => runCommand('focus'));
$('filename').addEventListener('click', () => filePath && bridge.revealInFinder(filePath));
$('parked-label').insertAdjacentHTML('afterbegin', SNOWFLAKE);
for (const ref of ['parked-restore', 'parked-back']) $(ref).addEventListener('mousedown', (e) => e.preventDefault());
$('parked-back').addEventListener('click', () => leaveParked());
$('parked-restore').addEventListener('click', () => { const id = view && parkedKey.getState(view.state); if (id) restoreScene(id); });

bridge.onMenu(runCommand);
bridge.onDocumentOpened(load);
bridge.onFlushRequest(async () => (await Promise.all([saver.saveNow(), notes.flush(), sprinter.flush()])).every(Boolean));

// ── start ──
// Every launch starts in the default mode: typewriter and focus mode are
// per-session and never restored (DECISIONS §8).
setFocus(false);
applyAppearance(bridge.initial);
setTypewriter(false);
setOutlinePinned(bridge.initial.outline === 'pinned', false, false);
bridge.loadInitial().then((doc) => { load(doc); void sprinter.recover(); }, (e: Error) => toast(`Could not open the manuscript: ${e.message}`, 'error'));

installTestHooks({
  sprintFinishNow: () => sprinter.timer.finishNow(),
  sprintFlush: () => sprinter.flush(),
  recoverSprint: () => sprinter.recover(),
  view: () => view,
  filePath: () => filePath,
  navigate,
  saver,
  toolbar,
  palette,
  find,
  history,
  appearance: () => ({ open: appearance.isOpen, choices: appearance.choices, applied: readAppearance(app) }),
  exporting: () => ({ open: book.exportOpen, prefs: book.exportPrefs }),
  book: () => ({ open: book.setupOpen, setup: view ? bookSetupOf(view.state.doc) : null }),
  outline: () => ({ presence: outlinePanel.presence, focused: outlinePanel.el.contains(document.activeElement) }),
  notes: () => ({ all: notes.all.map((n) => ({ ...n })), panel: notesPanel.isOpen, compact: margin.isCompact, anchors: view ? [...anchorsIn(view.state.doc).keys()] : [] }),
  sprints: () => ({ open: sprinter.libraryOpen }),
  sprint: () => sprinter.state(),
});
