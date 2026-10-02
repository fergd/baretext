// The component gallery (dev only; spec: "a hidden component gallery
// rendering every component × state × theme"). The real components, fed
// stand-in data, each driven into one state inside its own frame. Opens with
// `npm run gallery`; test/e2e/gallery.test.ts screenshots every frame.

import './clock';
import { createManuscriptState } from '@baretext/editor';
import { DEFAULT_APPEARANCE, DEFAULT_EXPORT, DEFAULT_SPRINT, THEMES, type BaretextBridge, type Theme } from '../../shared/bridge';
import { AppearancePanel } from '../appearance';
import { ExportPanel } from '../export-panel';
import { HistoryPanel } from '../history';
import { outlineOf } from '../outline';
import { Palette } from '../palette';
import { commandsView, type CommandContext } from '../palette-commands';
import { Spine } from '../spine';
import { SprintKeep, type KeepRequest } from '../sprint-keep';
import { SprintSetup } from '../sprint-setup';
import { SprintTimer } from '../sprint-timer';
import { SprintsPanel } from '../sprints-panel';
import { book, books, keptSprints, snapshots, sprintText } from './fixtures';

interface Spec {
  component: string;
  state: string;
  /** The frame: as large as the component needs (a stand-in window). */
  size: [number, number];
  render(frame: HTMLElement): void | Promise<void>;
}

const THEME_NAMES: Record<Theme, string> = { dracula: 'Dracula', dark: 'Dark', light: 'Light', grove: 'Grove', contrast: 'Contrast' };
const noop = () => {};
const click = (frame: HTMLElement, selector: string) => frame.querySelector<HTMLElement>(selector)!.click();

/** Only what the panels below call; the rest of the bridge is never reached here. */
const bridge = {
  initial: { ...DEFAULT_APPEARANCE, outline: 'hidden', hidden: false, export: DEFAULT_EXPORT, sprint: DEFAULT_SPRINT },
  listSnapshots: () => Promise.resolve(snapshots),
  readSnapshot: () => Promise.resolve(book),
  takeSnapshot: () => Promise.resolve(null),
  keptSprints: () => Promise.resolve(keptSprints),
  readSprint: (id: string) => Promise.resolve(sprintText[id] ?? []),
  writeSprint: () => Promise.resolve({ ok: true }),
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

const SPECS: Spec[] = [
  { component: 'Command palette', state: 'Commands', size: [680, 600], render: (f) => new Palette(f).open(commandsView(commands)) },
  { component: 'Appearance', state: 'Open', size: [1180, 880], render: (f) => new AppearancePanel(f, { current: () => ({ ...DEFAULT_APPEARANCE, theme: f.dataset.theme as Theme }), sample, save: noop, onClose: noop }).open() },
  { component: 'Export', state: 'Word', size: [600, 620], render: (f) => new ExportPanel(f, { current: () => DEFAULT_EXPORT, counts: () => ({ title: book.title, words: 2140, chapters: 3, cold: 1, notes: 2 }), run: () => Promise.resolve({ ok: false, canceled: true }), onClose: noop }).open() },
  { component: 'History', state: 'Versions', size: [940, 720], render: (f) => new HistoryPanel(f, { bridge, filePath: () => '/Writing/The Lighthouse Keeper.md', current: () => book, currentWords: () => 2140, restore: noop, onClose: noop }).open() },
  { component: 'Sprint setup', state: 'Time', size: [480, 440], render: (f) => new SprintSetup(f, { current: () => DEFAULT_SPRINT, start: noop, onClose: noop }).open() },
  { component: 'Sprint setup', state: 'Words, custom', size: [480, 440], render: (f) => new SprintSetup(f, { current: () => ({ ...DEFAULT_SPRINT, kind: 'words', words: 800 }), start: noop, onClose: noop }).open() },
  { component: 'Sprint setup', state: 'A session', size: [480, 440], render: (f) => new SprintSetup(f, { current: () => ({ ...DEFAULT_SPRINT, minutes: 25, rounds: 3, breakMinutes: 5 }), start: noop, onClose: noop }).open() },
  { component: 'Where the sprint goes', state: 'Asked', size: [480, 620], render: (f) => keepHost(f).open(endOfSprint) },
  { component: 'Where the sprint goes', state: 'End of chapter', size: [480, 620], render: async (f) => { await keepHost(f).open(endOfSprint); click(f, '.bt-keep-radio[data-value="chapter"]'); } },
  { component: 'Where the sprint goes', state: 'Discard, armed', size: [480, 620], render: async (f) => { await keepHost(f).open(endOfSprint); click(f, '.bt-keep-radio[data-value="discard"]'); click(f, '[data-action="done"]'); } },
  { component: 'Where the sprint goes', state: 'From the library', size: [480, 520], render: (f) => keepHost(f).open({ ...endOfSprint, title: 'Add to book', choices: ['chapter', 'end', 'cold'], back: 'Back' }) },
  { component: 'Sprints', state: 'Kept', size: [940, 720], render: (f) => sprints(f).open() },
  { component: 'Sprints', state: 'Discard, armed', size: [940, 720], render: async (f) => { await sprints(f).open(); click(f, '.bt-sprints [data-action="discard"]'); } },
  { component: 'Sprints', state: 'Empty', size: [940, 720], render: (f) => sprints(f, []).open() },
  { component: 'Timer line', state: 'Sprinting', size: [600, 80], render: (f) => timerLine(f, 0.4, 'sprint') },
  { component: 'Timer line', state: 'Paused', size: [600, 80], render: (f) => timerLine(f, 0.4, 'sprint', true) },
  { component: 'Timer line', state: 'Break', size: [600, 80], render: (f) => timerLine(f, 0.4, 'break') },
  { component: 'Timer line', state: 'Done', size: [600, 80], render: (f) => timerLine(f, 1, 'done') },
  { component: 'Spine', state: 'First scene', size: [200, 360], render: (f) => spine(f, 's1') },
  { component: 'Spine', state: 'Later scene', size: [200, 360], render: (f) => spine(f, 's5') },
];

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
  const pending: Promise<void>[] = [];
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
      pending.push(Promise.resolve(spec.render(frame)));
    }
  }
  await Promise.all(pending);
  await document.fonts.ready;
  // A still picture: no focus rings left from opening, nothing mid-transition.
  (document.activeElement as HTMLElement | null)?.blur();
  window.scrollTo(0, 0); // (opening panels focused into them, scrolling the page)
  document.documentElement.dataset.ready = 'true';
}

themeChoice.innerHTML = [...THEMES, 'all' as const].map((t) => `<button type="button" role="radio" class="bt-seg-item" data-value="${t}" aria-checked="false">${t === 'all' ? 'All' : THEME_NAMES[t]}</button>`).join('');
themeChoice.addEventListener('click', (e) => {
  const value = (e.target as HTMLElement).closest<HTMLElement>('[role="radio"]')?.dataset.value;
  if (value) { delete document.documentElement.dataset.ready; void render(value as Theme | 'all'); }
});
const requested = new URLSearchParams(location.search).get('theme');
void render(requested === 'all' || THEMES.includes(requested as Theme) ? (requested as Theme | 'all') : readShown());
