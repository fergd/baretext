// The corkboard's pieces as built for the page (DECISIONS §24, §27): a
// chapter (its header, its cards, its last tile), a scene's card, the totals.
// Construction only — what they do lives on the board.

import type { ChapterEntry, Outline, SceneEntry } from './outline';
import { sceneDisplayName } from './outline';
import { numberFormat } from './dom';
import { PLUS } from './icons';
import { beatName } from './structures';

/** Below this, a scene is shown as a draft. */
export const DRAFT_WORDS = 20;

const count = (n: number, one: string, many = `${one}s`) => `${numberFormat.format(n)} ${n === 1 ? one : many}`;
export const words = (n: number) => count(n, 'word');

/** An element: a tag, its class, and its properties. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), { className }, props);
  e.append(...children);
  return e;
}

/** A button within a card: the card is the tab stop, so its buttons aren't (their keys are the card's). */
function cardButton(className: string, action: string, text: string, props: Partial<HTMLButtonElement> = {}) {
  const b = el('button', className, { type: 'button', tabIndex: -1, textContent: text, ...props });
  b.dataset.action = action;
  return b;
}

/** A chapter: its header (number, title, totals), then its cards (a group's inside its container) and the tile that adds one. */
export function chapterSection(chapter: ChapterEntry, notes: Map<string, number>, structure: string | null, groupNames: Readonly<Record<string, string>> = {}): HTMLElement {
  const section = el('section', 'bt-cork-chapter');
  section.dataset.id = chapter.id;
  section.setAttribute('aria-label', `Chapter ${chapter.number}`);
  const head = el('header', 'bt-cork-chapter-head', {},
    el('span', 'bt-cork-chapter-number', { textContent: String(chapter.number) }),
    el('h2', 'bt-cork-chapter-title', { textContent: chapter.title || 'Untitled' }),
    el('span', 'bt-cork-chapter-meta', { textContent: `${count(chapter.scenes.length, 'scene')} · ${words(chapter.scenes.reduce((n, s) => n + s.words, 0))}` }));
  const items: HTMLElement[] = [];
  for (let i = 0; i < chapter.scenes.length;) {
    const group = chapter.scenes[i]!.group;
    let end = i + 1;
    while (group && chapter.scenes[end]?.group === group) end++;
    const cards = chapter.scenes.slice(i, end).map((s) => sceneCard(s, notes.get(s.id) ?? 0, structure));
    items.push(...(group ? [groupBox(group, groupNames[group] ?? null, cards)] : cards));
    i = end;
  }
  const grid = el('div', 'bt-cork-grid', {}, ...items, addTile(chapter));
  grid.setAttribute('role', 'list');
  section.append(head, grid);
  return section;
}

/** A scene's card: its number and title (a click renames), Open and ⋯, its opening lines, its words, notes and beat. */
export function sceneCard(scene: SceneEntry, noteCount: number, structure: string | null): HTMLElement {
  const draft = scene.words < DRAFT_WORDS;
  const beat = scene.beat ? beatName(structure, scene.beat) : null;
  const title = cardButton('bt-cork-card-title', 'rename', sceneDisplayName(scene), { title: 'Rename  R' });
  title.dataset.unnamed = String(!scene.name);
  const open = cardButton('bt-cork-action', 'open', 'Open');
  open.setAttribute('aria-label', `Open ${scene.label} in the manuscript`);
  const more = cardButton('bt-cork-action bt-cork-more', 'menu', '⋯', { title: 'Open, story beat, rename, copy, delete' });
  more.setAttribute('aria-label', `Actions for ${scene.label}`);
  const card = el('article', 'bt-cork-card', {},
    el('div', 'bt-cork-card-head', {},
      el('span', 'bt-cork-card-number', { textContent: scene.label }),
      el('h3', 'bt-cork-card-heading', {}, title),
      el('span', 'bt-cork-armed', { textContent: 'Delete? ⌫ again' }), // (asked to confirm a delete, the card says how)
      open, more),
    el('p', 'bt-cork-card-opening', { textContent: scene.opening }),
    el('div', 'bt-cork-card-foot', {},
      el('span', 'bt-cork-card-words', { textContent: draft ? 'Draft' : words(scene.words) }),
      ...(noteCount ? [el('span', 'bt-cork-card-notes', { textContent: count(noteCount, 'note') })] : []),
      ...(beat ? [el('span', 'bt-cork-card-beat', { textContent: beat })] : [])));
  card.setAttribute('role', 'listitem');
  card.dataset.id = scene.id;
  card.dataset.draft = String(draft);
  card.setAttribute('aria-label', [`${scene.label} ${sceneDisplayName(scene)}`, draft ? 'draft' : words(scene.words), ...(beat ? [beat] : [])].join(', '));
  return card;
}

/**
 * A group (DECISIONS §28): a container around its cards — which stay level
 * with the cards beside it — its name below them (a click renames it;
 * "Group" while it has none) and its menu (⋯).
 */
export function groupBox(id: string, name: string | null, cards: HTMLElement[]): HTMLElement {
  const label = el('button', 'bt-cork-group-name', { type: 'button', textContent: name ?? 'Group', title: 'Rename' });
  label.dataset.action = 'rename-group';
  label.dataset.unnamed = String(!name);
  const more = el('button', 'bt-cork-group-more', { type: 'button', textContent: '⋯', title: 'Copy, ungroup' });
  more.dataset.action = 'group-menu';
  more.setAttribute('aria-label', `Actions for the group${name ? ` “${name}”` : ''}`);
  // (Its cards are its own children: on the chapter's grid, they line up with every other card.)
  const box = el('div', 'bt-cork-group', {}, ...cards, el('div', 'bt-cork-group-foot', {}, label, more));
  box.dataset.group = id;
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', name ? `Group “${name}”, ${cards.length} scenes` : `Group of ${cards.length} scenes`);
  return box;
}

/** The last place in a chapter: a tile that adds a scene. */
export function addTile(chapter: ChapterEntry): HTMLElement {
  const add = el('button', 'bt-cork-add', { type: 'button', tabIndex: -1 }); // (N adds one from the keyboard)
  add.dataset.addScene = chapter.id;
  add.setAttribute('aria-label', `New scene in chapter ${chapter.number}`);
  add.innerHTML = `${PLUS}<span>New scene</span>`;
  return add;
}

/** The board's totals: "3 chapters · 24 scenes · 75,000 words". */
export function boardSummary(outline: Outline): string {
  return `${count(outline.chapters.length, 'chapter')} · ${count(outline.chapters.reduce((n, c) => n + c.scenes.length, 0), 'scene')} · ${words(outline.words)}`;
}
