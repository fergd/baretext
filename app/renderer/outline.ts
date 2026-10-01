// Derived, read-only views of the manuscript for navigation areas. Memoized
// per immutable node, so after an edit only the changed scene is recounted.

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { countWords } from '@baretext/format';
import { schema, structureSignature } from '@baretext/editor';

export interface SceneEntry {
  id: string;
  label: string;
  name: string | null;
  pos: number;
  words: number;
}

export interface ChapterEntry {
  id: string;
  number: number;
  title: string;
  pos: number;
  scenes: SceneEntry[];
}

export interface ParkedEntry {
  id: string;
  name: string | null;
  pos: number;
  words: number;
  /** Where it came from, if remembered: the chapter's current number, or null if that chapter is gone. */
  from: { chapter: number | null; index: number } | null;
}

export interface Outline {
  signature: string;
  chapters: ChapterEntry[];
  /** Words in the manuscript (Cold Storage not counted). */
  words: number;
  /** Cold Storage, newest first. */
  parked: ParkedEntry[];
  parkedWords: number;
}

const sceneWords = new WeakMap<PMNode, number>();
function wordsIn(scene: PMNode): number {
  let n = sceneWords.get(scene);
  if (n === undefined) {
    let total = 0;
    scene.forEach((child) => {
      if (child.type !== schema.nodes.scene_heading) total += countWords(child.textBetween(0, child.content.size, ' ', ' '));
    });
    n = total;
    sceneWords.set(scene, n);
  }
  return n;
}

const outlines = new WeakMap<PMNode, Outline>();

export function outlineOf(doc: PMNode): Outline {
  const cached = outlines.get(doc);
  if (cached) return cached;
  const chapters: ChapterEntry[] = [];
  let words = 0;
  doc.forEach((top, offset) => {
    if (top.type !== schema.nodes.chapter) return;
    const number = chapters.length + 1;
    const entry: ChapterEntry = { id: top.attrs.id, number, title: top.firstChild!.textContent, pos: offset, scenes: [] };
    top.forEach((child, childOffset) => {
      if (child.type !== schema.nodes.scene) return;
      const heading = child.firstChild?.type === schema.nodes.scene_heading ? child.firstChild : null;
      const w = wordsIn(child);
      words += w;
      entry.scenes.push({
        id: child.attrs.id,
        label: `${number}.${entry.scenes.length + 1}`,
        name: heading ? heading.textContent : null,
        pos: offset + 1 + childOffset,
        words: w,
      });
    });
    chapters.push(entry);
  });
  const parked: ParkedEntry[] = [];
  let parkedWords = 0;
  const cold = doc.lastChild!;
  const coldPos = doc.content.size - cold.nodeSize;
  cold.forEach((scene, offset) => {
    const heading = scene.firstChild?.type === schema.nodes.scene_heading ? scene.firstChild : null;
    const origin = scene.attrs.origin as { chapter: string; index: number } | null;
    const chapter = origin ? chapters.find((c) => c.id === origin.chapter) : undefined;
    const w = wordsIn(scene);
    parkedWords += w;
    parked.push({
      id: scene.attrs.id,
      name: heading ? heading.textContent : null,
      pos: coldPos + 1 + offset,
      words: w,
      from: origin ? { chapter: chapter?.number ?? null, index: origin.index } : null,
    });
  });
  const outline = { signature: structureSignature(doc), chapters, words, parked, parkedWords };
  outlines.set(doc, outline);
  return outline;
}

/** The scene (and its chapter) containing the selection head, if any. */
export function currentScene(state: EditorState): { chapter: ChapterEntry; scene: SceneEntry } | null {
  return sceneAt(state.doc, state.selection.head);
}

/**
 * The scene containing `pos`. With `chapterFallback`, a position in a
 * chapter's title counts as that chapter's first scene (for scroll tracking).
 */
export function sceneAt(doc: PMNode, pos: number, chapterFallback = false): { chapter: ChapterEntry; scene: SceneEntry } | null {
  const $pos = doc.resolve(pos);
  let sceneId: string | null = null;
  let chapterId: string | null = null;
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type === schema.nodes.scene && !sceneId) sceneId = node.attrs.id;
    if (node.type === schema.nodes.chapter) chapterId = node.attrs.id;
  }
  if (!chapterId || (!sceneId && !chapterFallback)) return null;
  for (const chapter of outlineOf(doc).chapters) {
    if (chapter.id !== chapterId) continue;
    const scene = sceneId ? chapter.scenes.find((s) => s.id === sceneId) : chapter.scenes[0];
    return scene ? { chapter, scene } : null;
  }
  return null;
}

export function sceneDisplayName(scene: SceneEntry): string {
  return scene.name ? scene.name : scene.name === '' ? 'Untitled' : 'Unnamed scene';
}
