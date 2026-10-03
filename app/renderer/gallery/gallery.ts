// The component gallery (dev only; spec: "a hidden component gallery
// rendering every component × state × theme"). The real components, fed
// stand-in data, each driven into one state inside its own frame. Opens with
// `npm run gallery`; test/e2e/gallery.test.ts screenshots every frame.

import './clock';
import { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { createManuscriptState } from '@baretext/editor';
import { DEFAULT_APPEARANCE, DEFAULT_EXPORT, DEFAULT_SPRINT, THEMES, type BaretextBridge, type CorkboardLayout, type Theme } from '../../shared/bridge';
import { AppearancePanel } from '../appearance';
import { Corkboard } from '../corkboard';
import { ExportPanel } from '../export-panel';
import { BookSetupPanel } from '../book-setup';
import type { BookSetup } from '@baretext/editor';
import { FindPanel } from '../find';
import { HistoryPanel } from '../history';
import { MarginNotes } from '../margin-notes';
import { NotesPanel } from '../notes-panel';
import { NotesStore } from '../notes-store';
import { outlineOf } from '../outline';
import { OutlinePanel } from '../outline-panel';
import { Palette } from '../palette';
import { commandsView, type CommandContext } from '../palette-commands';
import { Saver } from '../saving';
import { Spine } from '../spine';
import { SprintKeep, type KeepRequest } from '../sprint-keep';
import { SprintSetup } from '../sprint-setup';
import { SprintTimer } from '../sprint-timer';
import { SprintsPanel } from '../sprints-panel';
import { SelectionToolbar } from '../toolbar';
import { ViewTabs, type View } from '../view-tabs';
import { book, books, keptSprints, notes, snapshots, sprintText } from './fixtures';

interface Spec {
  component: string;
  state: string;
  /** The frame: as large as the component needs (a stand-in window). */
  size: [number, number];
  /** Build the part and drive it into the state; may return a last step that needs the live page — the keyboard, the pointer (see `finishFrame`). */
  render(frame: HTMLElement): Promise<Finish> | Finish;
}
type Finish = void | (() => void);

const THEME_NAMES: Record<Theme, string> = { dracula: 'Dracula', dark: 'Dark', light: 'Light', grove: 'Grove', contrast: 'Contrast' };
const noop = () => {};
/** The frames whose state ends with a last step, by name. */
const finishedFrames = new Map<string, Spec>();
/** Each drag in a frame has a pointer of its own. */
let pointers = 1;
const click = (frame: HTMLElement, selector: string) => frame.querySelector<HTMLElement>(selector)!.click();
/** Arm a two-step confirmation, as a last step: a press anywhere else on the page disarms it (as it should), so it arms just before its picture. */
const armed = (frame: HTMLElement, selector: string): Finish => () => click(frame, selector);

/** Only what the panels below call; the rest of the bridge is never reached here. */
const bridge = {
  initial: { ...DEFAULT_APPEARANCE, outline: 'hidden', hidden: false, export: DEFAULT_EXPORT, sprint: DEFAULT_SPRINT, corkboardLayout: 'rows', corkboardArc: false },
  listSnapshots: () => Promise.resolve(snapshots),
  readSnapshot: () => Promise.resolve(book),
  takeSnapshot: () => Promise.resolve(null),
  keptSprints: () => Promise.resolve(keptSprints),
  readSprint: (id: string) => Promise.resolve(sprintText[id] ?? []),
  writeSprint: () => Promise.resolve({ ok: true }),
  loadNotes: () => Promise.resolve(notes.map((n) => ({ ...n }))),
  saveNotes: () => Promise.resolve({ ok: true }),
  setPrefs: noop,
} as unknown as BaretextBridge;

const commands: CommandContext = {
  view: () => null, run: noop, navigate: noop, open: noop, isOn: (t) => t === 'typewriter', fileCommand: noop,
  reveal: noop, parked: () => null, leaveParked: noop, restoreParked: noop, mode: () => 'manuscript',
  timer: () => ({ running: false, paused: false, hidden: false }),
};

const sample = () => ({ book: book.title, chapterNumber: 1, chapterTitle: 'Arrival', sceneLabel: '1.1', sceneName: null, paragraphs: book.chapters[0]!.scenes[0]!.blocks.map((b) => (b.type === 'paragraph' ? b.content.map((r) => r.text).join('') : '')), words: 2140 });

const keepHost = (frame: HTMLElement) => new SprintKeep(frame, {
  books: () => Promise.resolve(books),
  chooseBook: () => Promise.resolve(null),
  chapters: () => Promise.resolve({ titles: book.chapters.map((c) => c.title), suggested: 1 }),
});
const endOfSprint: KeepRequest = { title: 'Keep this sprint?', words: 342, choices: ['chapter', 'end', 'cold', 'sprints', 'discard'], back: 'Keep writing', choose: () => Promise.resolve(false), onBack: noop };

const sprints = (frame: HTMLElement, kept = keptSprints) => new SprintsPanel(frame, {
  bridge: { ...bridge, keptSprints: () => Promise.resolve(kept) },
  place: noop, discard: () => Promise.resolve(false), onClose: noop,
});

/** A sprint timer line at `fraction`, in `phase`. */
function timerLine(frame: HTMLElement, fraction: number, phase: 'sprint' | 'break' | 'done', paused = false) {
  frame.classList.add('bt-app', 'g-app');
  frame.dataset.mode = 'sprinter';
  const timer = new SprintTimer(frame);
  if (phase === 'done') { timer.complete(); return; }
  timer.run(60_000, phase, noop);
  if (paused) timer.pause();
  const anim = frame.querySelector('.bt-sprint-line-bar')!.getAnimations()[0]!;
  anim.pause(); // a still picture
  anim.currentTime = fraction * 60_000;
}

function spine(frame: HTMLElement, current: string) {
  const workspace = Object.assign(document.createElement('div'), { className: 'bt-workspace g-workspace' });
  const nav = Object.assign(document.createElement('nav'), { className: 'bt-spine' });
  workspace.append(nav);
  frame.append(workspace);
  const outline = outlineOf(createManuscriptState(book).doc);
  const chapter = outline.chapters.find((c) => c.scenes.some((s) => s.id === current))!;
  new Spine(nav, noop).update(outline, current, chapter.id);
}

// ── the editor-bound parts: each frame is a small app (a workspace, the
// sample book in a real editor) and the part attaches to it as in the app ──

const FILE = '/Writing/The Lighthouse Keeper.md';
const el = (tag: string, className: string) => Object.assign(document.createElement(tag), { className });
const pause = (ms: number) => new Promise<void>((r) => { window.setTimeout(r, ms); });

interface Desk { view: EditorView; workspace: HTMLElement; scroller: HTMLElement; page: HTMLElement }

/** A frame as the app's window: the workspace and the book in an editor (`layout`: the columns open). */
function desk(frame: HTMLElement, layout: { outline?: boolean; notes?: boolean } = {}): Desk {
  frame.classList.add('bt-app', 'g-app');
  frame.dataset.mode = 'manuscript';
  frame.dataset.outline = layout.outline ? 'pinned' : 'hidden';
  if (layout.notes) frame.dataset.notes = 'open';
  const workspace = el('div', 'bt-workspace g-workspace');
  const scroller = el('div', 'bt-scroller');
  const page = el('div', 'bt-page');
  scroller.append(page);
  workspace.append(scroller);
  frame.append(workspace);
  const view = new EditorView(page, { state: createManuscriptState(book), attributes: { spellcheck: 'false' } });
  return { view, workspace, scroller, page };
}

/** Select the first occurrence of `text` in the book. */
function select(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text);
    return at < 0;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at, at + text.length)));
}

function outline(frame: HTMLElement): OutlinePanel {
  const d = desk(frame, { outline: true });
  const panel = new OutlinePanel(d.workspace, {
    navigate: noop, toEditor: noop, rename: () => false, addScene: noop, moveScene: () => false, moveChapter: () => false,
    addChapter: () => null, park: noop, openParked: noop, restore: noop, deleteScene: noop, deleteChapter: noop, copy: { scene: noop, chapter: noop }, popupMenu: () => Promise.resolve(null),
    noteCounts: () => new Map([['s1', 2]]), onPresence: noop,
  });
  panel.update(outlineOf(d.view.state.doc), book.title, 's3', 'c2');
  panel.setPresence('pinned');
  return panel;
}

function find(frame: HTMLElement, query: string, replace: string | null) {
  const d = desk(frame);
  const panel = new FindPanel(d.workspace, d.scroller, () => d.view);
  panel.open(replace !== null);
  const [findInput, replaceInput] = frame.querySelectorAll<HTMLInputElement>('.bt-find-input');
  findInput!.value = query;
  findInput!.dispatchEvent(new Event('input', { bubbles: true }));
  if (replace !== null) { replaceInput!.value = replace; replaceInput!.dispatchEvent(new Event('input', { bubbles: true })); }
}

async function toolbar(frame: HTMLElement, link: boolean): Promise<Finish> {
  const d = desk(frame);
  const bar = new SelectionToolbar(d.workspace, d.scroller, () => d.view);
  d.view.updateState(d.view.state.reconfigure({ plugins: [...d.view.state.plugins, bar.plugin] }));
  select(d.view, 'two cases and a box of books');
  await pause(450); // shows once a keyboard selection pauses
  // The link field lives while it has the keyboard: opened last.
  return link ? () => void bar.openLink() : undefined;
}

async function notesIn(frame: HTMLElement, where: 'panel' | 'margin') {
  const d = desk(frame, { notes: where === 'panel' });
  const store = new NotesStore(bridge, () => d.view, noop);
  await store.load(FILE);
  if (where === 'panel') {
    new NotesPanel(d.workspace, { view: () => d.view, store, show: noop, remove: noop, toEditor: noop, onPresence: noop }).setOpen(true);
  } else {
    const margin = new MarginNotes(d.page, d.scroller, { view: () => d.view, store, openInPanel: noop, discard: noop, toEditor: noop });
    margin.refresh();
    margin.setActive('n1');
  }
}

async function saveFailure(frame: HTMLElement, reason: 'destructive' | 'io') {
  const d = desk(frame);
  const message = reason === 'io' ? 'The disk is full.' : 'This change removes most of the manuscript.';
  const failing = { ...bridge, save: () => Promise.resolve({ ok: false, reason, message }) } as unknown as BaretextBridge;
  await new Saver(failing, () => d.view, () => FILE, el('span', 'bt-save-state'), frame).saveNow();
}

/**
 * The corkboard over the book, the keyboard on `focus`'s card (given last:
 * it lives while focused), then `then` (a key on it); `arc`: with the story
 * arc shown, over the book's structure (or none).
 */
function corkboard(frame: HTMLElement, focus: string | null, layout: CorkboardLayout = 'rows', then?: string, arc?: { structure: string | null }): Finish {
  const d = desk(frame);
  frame.dataset.view = 'corkboard';
  const board = new Corkboard(d.workspace, {
    open: noop, close: noop, noteCounts: () => new Map([['s1', 2]]), onLayout: noop, outline: () => outlineOf(d.view.state.doc),
    rename: () => false, addScene: () => null, deleteScene: noop, copyScene: noop, copyChapter: noop, placeScene: () => false, joinGroup: () => false, moveGroup: () => false, moveChapter: () => false, renameGroup: () => false, ungroup: () => false, copyGroup: noop, popupMenu: () => Promise.resolve(null),
    structure: () => (arc ? arc.structure : 'three-act'), setBeat: () => false, bookSettings: noop, onArc: noop,
  }, layout, !!arc);
  // The top bar as the board has it: the title, the board's view controls, the view chips.
  const bar = el('div', 'bt-chrome g-chrome');
  const tabs = new ViewTabs(noop);
  tabs.set('corkboard');
  bar.append(Object.assign(el('span', 'bt-chrome-title'), { textContent: book.title }), board.controls, tabs.el);
  frame.prepend(bar);
  board.open(outlineOf(d.view.state.doc), null);
  if (!focus) return undefined;
  return () => {
    const card = frame.querySelector<HTMLElement>(`.bt-cork-card[data-id="${focus}"]`)!;
    card.focus();
    if (then) card.dispatchEvent(new KeyboardEvent('keydown', { key: then, bubbles: true, cancelable: true }));
  };
}

/** The corkboard mid-drag: `from` lifted (a card, or a chapter's header) and held over `to` (`at`: where on it, as fractions). */
function dragging(frame: HTMLElement, layout: CorkboardLayout, from: string, to: string, at: [number, number]): Finish {
  corkboard(frame, null, layout);
  return () => {
    const pointerId = pointers++;
    const point = (selector: string, [fx, fy]: [number, number]) => {
      const r = frame.querySelector(selector)!.getBoundingClientRect();
      return { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, pointerId, bubbles: true };
    };
    frame.querySelector(from)!.dispatchEvent(new PointerEvent('pointerdown', { ...point(from, [0.5, 0.2]), button: 0 }));
    window.dispatchEvent(new PointerEvent('pointermove', point(to, at)));
  };
}

/** Book setup over `setup`; the author last used is Ann Lee's. */
function bookSetup(frame: HTMLElement, setup: BookSetup): BookSetupPanel {
  return new BookSetupPanel(frame, { current: () => setup, lastAuthor: () => 'Ann Lee', apply: noop, onClose: noop });
}

/** The top bar's right side: the view chips, `view` chosen. */
function chips(frame: HTMLElement, view: View) {
  const bar = el('div', 'bt-chrome g-chrome');
  const tabs = new ViewTabs(noop);
  tabs.set(view);
  bar.append(Object.assign(el('span', 'bt-chrome-title'), { textContent: book.title }), tabs.el);
  frame.append(bar);
}

function toast(frame: HTMLElement, kind: 'info' | 'error', message: string) {
  desk(frame);
  const t = el('div', 'bt-toast');
  t.setAttribute('role', 'status');
  Object.assign(t.dataset, { kind, visible: 'true' });
  t.textContent = message;
  frame.append(t);
}

const SPECS: Spec[] = [
  { component: 'Command palette', state: 'Commands', size: [680, 600], render: (f) => new Palette(f).open(commandsView(commands)) },
  { component: 'Appearance', state: 'Open', size: [1180, 880], render: (f) => new AppearancePanel(f, { current: () => ({ ...DEFAULT_APPEARANCE, theme: f.dataset.theme as Theme }), sample, save: noop, onClose: noop }).open() },
  { component: 'Export', state: 'Word', size: [600, 620], render: (f) => new ExportPanel(f, { current: () => DEFAULT_EXPORT, counts: () => ({ title: book.title, words: 2140, chapters: 3, cold: 1, notes: 2 }), run: () => Promise.resolve({ ok: false, canceled: true }), onClose: noop }).open() },
  // (A new book's title field has the keyboard, its text selected: a last step.)
  { component: 'Book setup', state: 'New book', size: [560, 460], render: (f) => { const p = bookSetup(f, { title: 'Untitled', author: '', structure: null, target: null }); return () => p.open(true); } },
  { component: 'Book setup', state: 'Settings', size: [560, 460], render: (f) => bookSetup(f, { title: book.title, author: 'Ann Lee', structure: 'three-act', target: 90000 }).open() },
  { component: 'Book setup', state: 'Target, not a number', size: [560, 460], render: (f) => {
    bookSetup(f, { title: book.title, author: 'Ann Lee', structure: 'save-the-cat', target: null }).open();
    const target = f.querySelector<HTMLInputElement>('[data-field="target"]')!;
    target.value = 'about 90k';
    target.dispatchEvent(new Event('input'));
  } },
  { component: 'History', state: 'Versions', size: [940, 720], render: (f) => new HistoryPanel(f, { bridge, filePath: () => '/Writing/The Lighthouse Keeper.md', current: () => book, currentWords: () => 2140, restore: noop, onClose: noop }).open() },
  { component: 'Sprint setup', state: 'Time', size: [480, 440], render: (f) => new SprintSetup(f, { current: () => DEFAULT_SPRINT, start: noop, onClose: noop }).open() },
  { component: 'Sprint setup', state: 'Words, custom', size: [480, 440], render: (f) => new SprintSetup(f, { current: () => ({ ...DEFAULT_SPRINT, kind: 'words', words: 800 }), start: noop, onClose: noop }).open() },
  { component: 'Sprint setup', state: 'A session', size: [480, 440], render: (f) => new SprintSetup(f, { current: () => ({ ...DEFAULT_SPRINT, minutes: 25, rounds: 3, breakMinutes: 5 }), start: noop, onClose: noop }).open() },
  { component: 'Where the sprint goes', state: 'Asked', size: [480, 620], render: (f) => keepHost(f).open(endOfSprint) },
  { component: 'Where the sprint goes', state: 'End of chapter', size: [480, 620], render: async (f) => { await keepHost(f).open(endOfSprint); click(f, '.bt-keep-radio[data-value="chapter"]'); } },
  { component: 'Where the sprint goes', state: 'Discard, armed', size: [480, 620], render: async (f) => { await keepHost(f).open(endOfSprint); click(f, '.bt-keep-radio[data-value="discard"]'); return armed(f, '[data-action="done"]'); } },
  { component: 'Where the sprint goes', state: 'From the library', size: [480, 520], render: (f) => keepHost(f).open({ ...endOfSprint, title: 'Add to book', choices: ['chapter', 'end', 'cold'], back: 'Back' }) },
  { component: 'Sprints', state: 'Kept', size: [940, 720], render: (f) => sprints(f).open() },
  { component: 'Sprints', state: 'Discard, armed', size: [940, 720], render: async (f) => { await sprints(f).open(); return armed(f, '.bt-sprints [data-action="discard"]'); } },
  { component: 'Sprints', state: 'Empty', size: [940, 720], render: (f) => sprints(f, []).open() },
  { component: 'Timer line', state: 'Sprinting', size: [600, 80], render: (f) => timerLine(f, 0.4, 'sprint') },
  { component: 'Timer line', state: 'Paused', size: [600, 80], render: (f) => timerLine(f, 0.4, 'sprint', true) },
  { component: 'Timer line', state: 'Break', size: [600, 80], render: (f) => timerLine(f, 0.4, 'break') },
  { component: 'Timer line', state: 'Done', size: [600, 80], render: (f) => timerLine(f, 1, 'done') },
  { component: 'Spine', state: 'First scene', size: [200, 360], render: (f) => spine(f, 's1') },
  { component: 'Spine', state: 'Later scene', size: [200, 360], render: (f) => spine(f, 's5') },
  { component: 'Outline', state: 'Open', size: [900, 520], render: (f) => void outline(f) },
  { component: 'Outline', state: 'Renaming', size: [900, 520], render: (f) => { const panel = outline(f); return () => panel.startRename('s4', 'row'); } },
  { component: 'Outline', state: 'Delete, armed', size: [900, 520], render: (f) => { outline(f); return armed(f, '.bt-outline-row[data-id="s5"] [data-action="delete"]'); } },
  { component: 'Find', state: 'Matches', size: [900, 360], render: (f) => find(f, 'the', null) },
  { component: 'Find', state: 'Replace', size: [900, 360], render: (f) => find(f, 'keeper', 'warden') },
  { component: 'Find', state: 'No matches', size: [900, 360], render: (f) => find(f, 'zebra', null) },
  { component: 'Selection toolbar', state: 'Formatting', size: [900, 360], render: (f) => toolbar(f, false) },
  { component: 'Selection toolbar', state: 'Link', size: [900, 360], render: (f) => toolbar(f, true) },
  { component: 'Notes', state: 'Panel', size: [1200, 560], render: (f) => notesIn(f, 'panel') },
  { component: 'Notes', state: 'In the margin', size: [1200, 560], render: (f) => notesIn(f, 'margin') },
  { component: 'Save notice', state: 'Would gut the book', size: [900, 300], render: (f) => saveFailure(f, 'destructive') },
  { component: 'Save notice', state: 'Couldn’t save', size: [900, 300], render: (f) => saveFailure(f, 'io') },
  { component: 'Corkboard', state: 'Board', size: [1100, 640], render: (f) => corkboard(f, null) },
  { component: 'Corkboard', state: 'A card with the keyboard', size: [1100, 640], render: (f) => corkboard(f, 's4') },
  { component: 'Corkboard', state: 'Columns', size: [1100, 640], render: (f) => corkboard(f, 's4', 'columns') },
  { component: 'Corkboard', state: 'Renaming a card', size: [1100, 640], render: (f) => corkboard(f, 's2', 'rows', 'r') },
  { component: 'Corkboard', state: 'Delete, armed', size: [1100, 640], render: (f) => corkboard(f, 's2', 'rows', 'Backspace') },
  { component: 'Corkboard', state: 'Arc, rows', size: [1100, 640], render: (f) => corkboard(f, null, 'rows', undefined, { structure: 'three-act' }) },
  { component: 'Corkboard', state: 'Arc, columns', size: [1100, 640], render: (f) => corkboard(f, null, 'columns', undefined, { structure: 'three-act' }) },
  { component: 'Corkboard', state: 'Arc, no structure', size: [1100, 640], render: (f) => corkboard(f, null, 'columns', undefined, { structure: null }) },
  { component: 'Corkboard', state: 'Dragging a card', size: [1100, 640], render: (f) => dragging(f, 'rows', '.bt-cork-card[data-id="s4"]', '.bt-cork-card[data-id="s2"]', [0.2, 0.6]) },
  { component: 'Corkboard', state: 'Dragging a card into a group', size: [1100, 640], render: (f) => dragging(f, 'rows', '.bt-cork-card[data-id="s1"]', '.bt-cork-card[data-id="s5"]', [0.9, 0.5]) },
  { component: 'Corkboard', state: 'Dropping a card on a card', size: [1100, 640], render: (f) => dragging(f, 'rows', '.bt-cork-card[data-id="s1"]', '.bt-cork-card[data-id="s3"]', [0.5, 0.5]) },
  { component: 'Corkboard', state: 'Dragging a chapter', size: [1100, 640], render: (f) => dragging(f, 'columns', '.bt-cork-chapter[data-id] .bt-cork-chapter-title', '.bt-cork-chapter[data-id="c3"]', [0.7, 0.1]) },
  { component: 'View chips', state: 'Manuscript', size: [600, 60], render: (f) => chips(f, 'manuscript') },
  { component: 'View chips', state: 'Corkboard', size: [600, 60], render: (f) => chips(f, 'corkboard') },
  { component: 'Toast', state: 'Info', size: [900, 200], render: (f) => toast(f, 'info', 'Sprint added to the end of chapter 2. ⌘Z undoes it.') },
  { component: 'Toast', state: 'Error', size: [900, 200], render: (f) => toast(f, 'error', 'Couldn’t save the sprint: the disk is full.') },
];

/**
 * Resolves once nothing on the page has scrolled for a moment: the smooth
 * scrolls parts start (a note's card, the outline's row) have ended.
 */
function scrollingSettled(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { window.removeEventListener('scroll', moved, true); resolve(); };
    let timer = window.setTimeout(done, 150);
    const moved = () => { clearTimeout(timer); timer = window.setTimeout(done, 150); };
    window.addEventListener('scroll', moved, true); // (capture: every element's scrolling, not only the page's)
  });
}

// ── the page ──

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const root = document.querySelector<HTMLElement>('.g-root')!;
const themeChoice = document.querySelector<HTMLElement>('.g-themes')!;
const SHOWN_KEY = 'gallery-theme';

function readShown(): Theme | 'all' {
  try {
    const v = localStorage.getItem(SHOWN_KEY);
    return v === 'all' || THEMES.includes(v as Theme) ? (v as Theme | 'all') : 'dracula';
  } catch {
    return 'dracula';
  }
}

/** The frames for `shown` (one theme, or all of them side by side). */
async function render(shown: Theme | 'all') {
  try { localStorage.setItem(SHOWN_KEY, shown); } catch { /* per-viewer convenience only */ }
  for (const b of themeChoice.querySelectorAll('[role="radio"]')) b.setAttribute('aria-checked', String((b as HTMLElement).dataset.value === shown));
  document.documentElement.dataset.theme = shown === 'all' ? 'dracula' : shown;
  const themes = shown === 'all' ? THEMES : [shown];
  const sections = new Map<string, HTMLElement>();
  const pending: Promise<Finish>[] = [];
  root.replaceChildren();
  for (const spec of SPECS) {
    let row = sections.get(spec.component);
    if (!row) {
      const section = Object.assign(document.createElement('section'), { className: 'g-section' });
      section.append(Object.assign(document.createElement('h2'), { className: 'g-heading', textContent: spec.component }));
      row = Object.assign(document.createElement('div'), { className: 'g-row' });
      section.append(row);
      root.append(section);
      sections.set(spec.component, row);
    }
    for (const theme of themes) {
      const figure = Object.assign(document.createElement('figure'), { className: 'g-figure' });
      figure.append(Object.assign(document.createElement('figcaption'), { className: 'g-caption', textContent: shown === 'all' ? `${spec.state} · ${THEME_NAMES[theme]}` : spec.state }));
      const frame = Object.assign(document.createElement('div'), { className: 'g-frame' });
      frame.dataset.theme = theme;
      frame.dataset.frame = `${slug(spec.component)}--${slug(spec.state)}--${theme}`;
      frame.style.setProperty('--g-w', `${spec.size[0]}px`);
      frame.style.setProperty('--g-h', `${spec.size[1]}px`);
      figure.append(frame);
      row.append(figure);
      pending.push(Promise.resolve(spec.render(frame)).then((finish) => {
        if (finish) { finishedFrames.set(frame.dataset.frame!, spec); frame.dataset.finish = ''; }
        return finish;
      }));
    }
  }
  finishedFrames.clear();
  const finishes = await Promise.all(pending);
  await document.fonts.ready;
  // A still picture: no focus rings left from opening, nothing mid-transition;
  // then the few states with a last step take it, in turn — only the last
  // keeps the keyboard here; a picture of one asks for it (`finishFrame`).
  (document.activeElement as HTMLElement | null)?.blur();
  for (const finish of finishes) finish?.();
  // Opening parts scrolled the page (focus, cards brought into view): once
  // all of that has stopped, back to the top — on a whole pixel, so every
  // frame's picture is exact.
  await scrollingSettled();
  window.scrollTo(0, 0);
  document.documentElement.dataset.ready = 'true';
}

/**
 * One frame's last step, for its picture. The page holds one focus, and a
 * state may not outlive losing it (a rename saves on blur), so the frame is
 * drawn afresh and its last step run again, once.
 */
async function finishFrame(name: string): Promise<void> {
  const spec = finishedFrames.get(name);
  const frame = document.querySelector<HTMLElement>(`[data-frame="${name}"]`);
  if (!spec || !frame) throw new Error(`No frame with a last step: ${name}`);
  frame.replaceChildren();
  const finish = await spec.render(frame);
  await document.fonts.ready;
  (document.activeElement as HTMLElement | null)?.blur(); // (as when the page settles: no focus left from opening)
  finish?.();
  await scrollingSettled();
}
Object.assign(window, { finishFrame });

themeChoice.innerHTML = [...THEMES, 'all' as const].map((t) => `<button type="button" role="radio" class="bt-seg-item" data-value="${t}" aria-checked="false">${t === 'all' ? 'All' : THEME_NAMES[t]}</button>`).join('');
themeChoice.addEventListener('click', (e) => {
  const value = (e.target as HTMLElement).closest<HTMLElement>('[role="radio"]')?.dataset.value;
  if (value) { delete document.documentElement.dataset.ready; void render(value as Theme | 'all'); }
});
const requested = new URLSearchParams(location.search).get('theme');
void render(requested === 'all' || THEMES.includes(requested as Theme) ? (requested as Theme | 'all') : readShown());
