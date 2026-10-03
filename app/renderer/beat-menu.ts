// The "Story beat" menu for a scene (DECISIONS §27): the book's structure's
// beats, in order — a check on the scene's own; where another scene has one,
// that scene's number (choosing it moves it here) — then "No beat". Without a
// structure, the way to choose one. Items: `beat:<id>` (`beat:` clears),
// `choose-structure`.

import type { MenuItem } from '../shared/bridge';
import type { Outline } from './outline';
import { beatName, structureOf } from './structures';

export const CHOOSE_STRUCTURE = 'choose-structure';
const BEAT = 'beat:';

export function beatMenu(outline: Pick<Outline, 'chapters'>, structure: string | null, sceneId: string): MenuItem[] {
  const scenes = outline.chapters.flatMap((c) => c.scenes);
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) return [];
  const known = structureOf(structure);
  const choose = { id: CHOOSE_STRUCTURE, label: 'Choose a structure…' };
  if (!known && !scene.beat) return [choose];
  const holders = new Map(scenes.filter((s) => s.beat && s.id !== sceneId).map((s) => [s.beat!, s.label]));
  const beats: MenuItem[] = (known?.beats ?? []).map((b) => ({
    id: BEAT + b.id,
    label: holders.has(b.id) ? `${b.name} · ${holders.get(b.id)}` : b.name,
    checked: scene.beat === b.id,
  }));
  // A beat the structure doesn't have (a newer app's, or another structure's) still shows, checked.
  if (scene.beat && !known?.beats.some((b) => b.id === scene.beat)) beats.push({ id: BEAT + scene.beat, label: beatName(structure, scene.beat), checked: true });
  return [...beats, { separator: true }, { id: BEAT, label: 'No beat', enabled: !!scene.beat }, ...(known ? [] : [choose])];
}

/** What a menu choice means for beats: a beat to mark (null: clear it), or not a beat choice at all (undefined). */
export function chosenBeat(choice: string): string | null | undefined {
  return choice.startsWith(BEAT) ? choice.slice(BEAT.length) || null : undefined;
}
