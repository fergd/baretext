// The gallery's stand-in data: a small book, its snapshots, some kept
// sprints, the writer's other manuscripts.

import type { Block, Manuscript } from '@baretext/format';
import { DEFAULT_SPRINT, type BookInfo, type SnapshotInfo, type SprintSummary } from '../../shared/bridge';
import type { Note } from '../../shared/notes';
import { NOW } from './clock';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const p = (text: string): Block => ({ type: 'paragraph', content: [{ text }] });

export const book: Manuscript = {
  title: 'The Lighthouse Keeper',
  structure: 'three-act',
  coldStorage: [{ id: 'k1', name: 'The storm, first try', link: null, blocks: [p('Too much weather.')] }],
  chapters: [
    { id: 'c1', title: 'Arrival', scenes: [
      { id: 's1', name: null, link: null, blocks: [p('The boat left her on the jetty with two cases and a box of books, and did not wait to see her up the steps.'), p('The keeper’s cottage smelled of paraffin and salt.')] },
      { id: 's2', name: 'The log', link: null, beat: 'inciting-incident', blocks: [p('Wind, sea, ships. Three lines, every day, for forty years.')] },
    ] },
    { id: 'c2', title: 'Weather', scenes: [
      { id: 's3', name: null, link: null, blocks: [p('By October the light came late and left early.')] },
      { id: 's4', name: 'Letters', link: null, beat: 'midpoint', blocks: [p('The first letter came in a tin, wrapped in oilcloth.')] },
      { id: 's5', name: null, link: null, blocks: [p('She read it twice and put it back.')] },
    ] },
    { id: 'c3', title: 'The Ferry', scenes: [{ id: 's6', name: null, link: null, blocks: [p('Nobody had crossed since spring.')] }] },
  ],
};

export const snapshots: SnapshotInfo[] = [
  { id: 'n1', kind: 'point', reason: 'Autosave', time: NOW - 12 * MIN, words: 2140 },
  { id: 'n2', kind: 'manual', reason: 'Saved snapshot', label: 'Before the storm rewrite', time: NOW - 3 * 60 * MIN, words: 2088 },
  { id: 'n3', kind: 'daily', reason: 'Daily', time: NOW - DAY, words: 1960 },
  { id: 'n4', kind: 'point', reason: 'Before Replace All', time: NOW - 2 * DAY, words: 1712 },
];

export const sprintText: Record<string, Block[]> = {
  sp1: [p('The rain had not stopped for three days. She counted the drops on the glass, one by one, until the light went and the room was only sound.'), { type: 'section_break' }, p('Downstairs, someone was running a bath.')],
  sp2: [p('Warm-up: the kitchen at 6 a.m., described without adjectives.'), p('Kettle. Window. The dog at the door, asking.')],
  sp3: [p('A list of things my grandmother never said out loud: that she was afraid of the sea; that she had loved someone before my grandfather.')],
};

export const keptSprints: SprintSummary[] = [
  { record: { id: 'sp1', status: 'kept', started: NOW - 40 * MIN, updated: NOW - 25 * MIN, words: 34, book: null, prefs: { ...DEFAULT_SPRINT, minutes: 15 } }, opening: 'The rain had not stopped for three days. She counted the drops on the glass, one by one, until the light went and the room was only sound.' },
  { record: { id: 'sp2', status: 'kept', started: NOW - 8 * 60 * MIN, updated: NOW - 8 * 60 * MIN, words: 18, book: null, prefs: { ...DEFAULT_SPRINT, kind: 'words', words: 250 } }, opening: 'Warm-up: the kitchen at 6 a.m., described without adjectives.' },
  { record: { id: 'sp3', status: 'kept', started: NOW - 3 * DAY, updated: NOW - 3 * DAY, words: 25, book: null, prefs: { ...DEFAULT_SPRINT, minutes: 25, rounds: 2 } }, opening: 'A list of things my grandmother never said out loud: that she was afraid of the sea; that she had loved someone before my grandfather.' },
];

export const books: BookInfo[] = [
  { path: '/Writing/The Lighthouse Keeper.md', title: 'The Lighthouse Keeper', current: true },
  { path: '/Writing/Short Stories 2026.md', title: 'Short Stories 2026', current: false },
  { path: '/Writing/Drafts/The Lighthouse Keeper.md', title: 'The Lighthouse Keeper', current: false },
];

/** A note on `quote`, the first time it appears in scene `scene`'s prose. */
function noteOn(id: string, scene: string, quote: string, body: string, ago: number): Note {
  const prose = book.chapters.flatMap((c) => c.scenes).find((sc) => sc.id === scene)!.blocks
    .map((b) => (b.type === 'paragraph' ? b.content.map((r) => r.text).join('') : '')).join('\n');
  return { id, body, anchor: { scene, quote, offset: prose.indexOf(quote) }, resolved: false, created: NOW - ago, updated: NOW - ago };
}

export const notes: Note[] = [
  noteOn('n1', 's1', 'two cases and a box of books', 'What is in the box? Set it up here; pay it off in the storm.', 40 * MIN),
  noteOn('n2', 's1', 'paraffin and salt', 'Smell again in chapter 3, when she leaves.', 2 * DAY),
  { id: 'n3', body: 'Her name: decide between Ada and Wren before the ferry chapter.', anchor: null, resolved: false, created: NOW - 3 * DAY, updated: NOW - 3 * DAY },
];
