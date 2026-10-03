// The story structures a book can be measured against (DECISIONS §26), and
// each one's beats (§27): the moments a writer marks scenes as, each at its
// conventional place in a book (`at`: a share of its length, 0 to 1) and
// its tension there (`t`, 0 to 1: the arc's height). The book keeps only
// ids, so a structure or beat this app doesn't know survives.

export interface Beat {
  id: string;
  name: string;
  at: number;
  t: number;
}

export interface Structure {
  id: string;
  name: string;
  beats: readonly Beat[];
}

const beat = (id: string, name: string, at: number, t: number): Beat => ({ id, name, at, t });

export const STRUCTURES: readonly Structure[] = [
  {
    id: 'three-act', name: 'Three acts', beats: [
      beat('inciting-incident', 'Inciting incident', 0.12, 0.3),
      beat('first-plot-point', 'First plot point', 0.25, 0.42),
      beat('midpoint', 'Midpoint', 0.5, 0.58),
      beat('second-plot-point', 'Second plot point', 0.75, 0.74),
      beat('climax', 'Climax', 0.9, 1),
      beat('resolution', 'Resolution', 0.97, 0.25),
    ],
  },
  {
    id: 'heros-journey', name: 'The hero’s journey', beats: [
      beat('ordinary-world', 'The ordinary world', 0, 0.12),
      beat('call-to-adventure', 'The call to adventure', 0.1, 0.3),
      beat('refusal-of-the-call', 'Refusal of the call', 0.15, 0.26),
      beat('meeting-the-mentor', 'Meeting the mentor', 0.2, 0.32),
      beat('crossing-the-threshold', 'Crossing the threshold', 0.25, 0.45),
      beat('tests-allies-enemies', 'Tests, allies, enemies', 0.35, 0.52),
      beat('approach', 'Approach to the inmost cave', 0.45, 0.62),
      beat('ordeal', 'The ordeal', 0.5, 0.88),
      beat('reward', 'The reward', 0.6, 0.56),
      beat('road-back', 'The road back', 0.75, 0.72),
      beat('resurrection', 'Resurrection', 0.9, 1),
      beat('return-with-the-elixir', 'Return with the elixir', 0.98, 0.2),
    ],
  },
  {
    id: 'save-the-cat', name: 'Save the Cat', beats: [
      beat('opening-image', 'Opening image', 0, 0.12),
      beat('theme-stated', 'Theme stated', 0.05, 0.16),
      beat('setup', 'Setup', 0.07, 0.2),
      beat('catalyst', 'Catalyst', 0.1, 0.36),
      beat('debate', 'Debate', 0.15, 0.32),
      beat('break-into-two', 'Break into two', 0.2, 0.46),
      beat('b-story', 'B story', 0.22, 0.46),
      beat('fun-and-games', 'Fun and games', 0.3, 0.52),
      beat('midpoint', 'Midpoint', 0.5, 0.66),
      beat('bad-guys-close-in', 'Bad guys close in', 0.62, 0.72),
      beat('all-is-lost', 'All is lost', 0.75, 0.82),
      beat('dark-night-of-the-soul', 'Dark night of the soul', 0.78, 0.78),
      beat('break-into-three', 'Break into three', 0.8, 0.86),
      beat('finale', 'Finale', 0.9, 1),
      beat('final-image', 'Final image', 0.99, 0.2),
    ],
  },
  {
    id: 'seven-point', name: 'Seven-point', beats: [
      beat('hook', 'Hook', 0, 0.12),
      beat('first-plot-turn', 'First plot turn', 0.15, 0.36),
      beat('first-pinch', 'First pinch', 0.35, 0.5),
      beat('midpoint', 'Midpoint', 0.5, 0.6),
      beat('second-pinch', 'Second pinch', 0.65, 0.76),
      beat('second-plot-turn', 'Second plot turn', 0.85, 0.92),
      beat('resolution', 'Resolution', 1, 0.3),
    ],
  },
  {
    id: 'freytag', name: 'Freytag’s pyramid', beats: [
      beat('exposition', 'Exposition', 0, 0.1),
      beat('inciting-incident', 'Inciting incident', 0.12, 0.25),
      beat('rising-action', 'Rising action', 0.3, 0.55),
      beat('climax', 'Climax', 0.5, 1),
      beat('falling-action', 'Falling action', 0.7, 0.55),
      beat('denouement', 'Dénouement', 0.95, 0.15),
    ],
  },
  {
    id: 'kishotenketsu', name: 'Kishōtenketsu', beats: [
      beat('ki', 'Ki · introduction', 0, 0.2),
      beat('sho', 'Shō · development', 0.25, 0.32),
      beat('ten', 'Ten · twist', 0.5, 0.95),
      beat('ketsu', 'Ketsu · conclusion', 0.75, 0.35),
    ],
  },
];

/**
 * Which story beats survive choosing `structure` (DECISIONS §27): those it
 * has. With none chosen, none; with one this app doesn't know (a newer
 * app's), all — what can't be judged is never thrown away.
 */
export function beatsKept(structure: string | null): (beat: string) => boolean {
  if (structure === null) return () => false;
  const known = structureOf(structure);
  return known ? (beat) => known.beats.some((b) => b.id === beat) : () => true;
}

export const structureOf = (id: string | null): Structure | undefined => STRUCTURES.find((s) => s.id === id);

/** A beat's name in a structure; one this app doesn't know reads from its id ("a-newer-beat" → "A newer beat"). */
export function beatName(structure: string | null, id: string): string {
  return structureOf(structure)?.beats.find((b) => b.id === id)?.name ?? (id.charAt(0).toUpperCase() + id.slice(1)).replace(/-/g, ' ');
}
