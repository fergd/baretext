// Scene groups (DECISIONS §28): scenes that belong together sit together. A
// group is a run of two or more consecutive scenes in one chapter sharing a
// `link` id; its name (optional) is kept on the document by that id.
//
// The rule is kept in one place, whatever changed the book: after every
// change the guard puts it right in the same step (so one undo undoes both) —
// a scene that lands between two members joins them; a group split apart
// keeps its largest run (the rest leave, or become groups of their own); a
// group left with one scene is no group; Cold Storage holds no groups.

import { newId } from '@baretext/format';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { closeHistory } from 'prosemirror-history';
import { schema } from './schema';
import { markStructural } from './structure';
import { chapterPos, moveSceneTr, relocateSpan, sceneSlot } from './outline-commands';

/** A group as it sits in the book. */
export interface GroupRun {
  id: string;
  chapterId: string;
  sceneIds: string[];
  /** The span of its scenes in the document. */
  from: number;
  to: number;
}

/** The groups in a document, in book order. */
export function groupsIn(doc: PMNode): GroupRun[] {
  const runs: GroupRun[] = [];
  doc.forEach((chapter, offset) => {
    if (chapter.type !== schema.nodes.chapter) return;
    let run: GroupRun | null = null;
    chapter.forEach((scene, childOffset) => {
      if (scene.type !== schema.nodes.scene) return;
      const link: string | null = scene.attrs.link;
      const at = offset + 1 + childOffset;
      if (link && run?.id === link) {
        run.sceneIds.push(scene.attrs.id);
        run.to = at + scene.nodeSize;
      } else {
        run = link ? { id: link, chapterId: chapter.attrs.id, sceneIds: [scene.attrs.id], from: at, to: at + scene.nodeSize } : null;
        if (run) runs.push(run);
      }
    });
  });
  return runs;
}

/** The rule, applied to `state`: the changes it needs (null when it already holds). */
export function keepGroups(state: EditorState): Transaction | null {
  const tr = state.tr;
  const set = (pos: number, link: string | null) => tr.setNodeAttribute(pos, 'link', link);
  // A scene between two members of a group joins it.
  state.doc.forEach((chapter, offset) => {
    if (chapter.type !== schema.nodes.chapter) return;
    const scenes: { pos: number; link: string | null }[] = [];
    chapter.forEach((s, o) => { if (s.type === schema.nodes.scene) scenes.push({ pos: offset + 1 + o, link: s.attrs.link }); });
    scenes.forEach((s, i) => {
      const [prev, next] = [scenes[i - 1]?.link, scenes[i + 1]?.link];
      if (prev && prev === next && s.link !== prev) { set(s.pos, prev); s.link = prev; }
    });
  });
  // Each group is one run: the largest keeps the id; other runs of two or more become groups of their own; a lone scene is in none.
  const byId = new Map<string, GroupRun[]>();
  for (const run of groupsIn(tr.doc)) byId.set(run.id, [...(byId.get(run.id) ?? []), run]);
  for (const runs of byId.values()) {
    const keep = runs.reduce((a, b) => (b.sceneIds.length > a.sceneIds.length ? b : a));
    for (const run of runs) {
      const id = run.sceneIds.length < 2 ? null : run === keep ? run.id : newId();
      if (id === run.id) continue;
      tr.doc.nodesBetween(run.from, run.to, (node, pos) => {
        if (node.type !== schema.nodes.scene) return true; // (into the chapter, to its scenes)
        set(pos, id);
        return false;
      });
    }
  }
  // Cold Storage holds no groups.
  const cold = tr.doc.lastChild!;
  const coldAt = tr.doc.content.size - cold.nodeSize;
  cold.forEach((s, o) => { if (s.attrs.link) set(coldAt + 1 + o, null); });
  return tr.docChanged ? markStructural(tr) : null;
}

/** Keeps the rule after every change, in the same step. */
export function groupsGuard(): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, state) {
      return trs.some((t) => t.docChanged) ? keepGroups(state) : null;
    },
  });
}

/** The group a scene is in (its id), if any. */
function linkOf(doc: PMNode, sceneId: string): string | null {
  let link: string | null = null;
  doc.descendants((node) => {
    if (node.type === schema.nodes.scene && node.attrs.id === sceneId) link = node.attrs.link;
    return node.type !== schema.nodes.scene && node.type !== schema.nodes.paragraph;
  });
  return link;
}

/** Where a scene is: its chapter and its index there. */
function placeOf(doc: PMNode, sceneId: string): { chapterId: string; index: number; pos: number } | null {
  let found: { chapterId: string; index: number; pos: number } | null = null;
  doc.forEach((chapter, offset) => {
    if (found || chapter.type !== schema.nodes.chapter) return;
    chapter.forEach((s, o, i) => { if (s.type === schema.nodes.scene && s.attrs.id === sceneId) found = { chapterId: chapter.attrs.id, index: i - 1, pos: offset + 1 + o }; });
  });
  return found;
}

/** Set a scene's group in `tr` (by its id, wherever it now is). */
function setLink(tr: Transaction, sceneId: string, link: string | null) {
  const at = placeOf(tr.doc, sceneId);
  if (at && tr.doc.nodeAt(at.pos)!.attrs.link !== link) tr.setNodeAttribute(at.pos, 'link', link);
}

const done = (tr: Transaction, dispatch?: (tr: Transaction) => void) => {
  if (!tr.docChanged) return false;
  if (dispatch) dispatch(closeHistory(markStructural(tr)));
  return true;
};

/**
 * Move a scene to `index` among a chapter's scenes (as they are once it has
 * left) and put it in group `group` (null: in none) — the board's drop.
 */
export const placeScene = (sceneId: string, chapterId: string, index: number, group: string | null): Command => (state, dispatch) => {
  if (!placeOf(state.doc, sceneId)) return false;
  const tr = moveSceneTr(state, sceneId, chapterId, index) ?? state.tr;
  setLink(tr, sceneId, group);
  return done(tr, dispatch);
};

/** A scene dropped on another: placed right after it, the two in one group (the target's, or a new one). */
export const joinGroup = (sceneId: string, targetId: string): Command => (state, dispatch) => {
  const target = placeOf(state.doc, targetId);
  const from = placeOf(state.doc, sceneId);
  if (!target || !from || sceneId === targetId) return false;
  const group = linkOf(state.doc, targetId) ?? newId();
  const index = target.chapterId === from.chapterId && from.index < target.index ? target.index : target.index + 1;
  const tr = moveSceneTr(state, sceneId, target.chapterId, index) ?? state.tr;
  setLink(tr, targetId, group);
  setLink(tr, sceneId, group);
  return done(tr, dispatch);
};

/** Move a group's scenes as one to `index` among a chapter's scenes (as they are once the group has left). */
export const moveGroup = (groupId: string, chapterId: string, index: number): Command => (state, dispatch) => {
  const run = groupsIn(state.doc).find((g) => g.id === groupId);
  const toAt = chapterPos(state.doc, chapterId);
  if (!run || toAt < 0) return false;
  const chapter = state.doc.nodeAt(chapterPos(state.doc, run.chapterId))!;
  const same = run.chapterId === chapterId;
  if (!same && chapter.childCount - 1 === run.sceneIds.length) return false; // a chapter always keeps a scene
  const first = placeOf(state.doc, run.sceneIds[0]!)!.index;
  const room = (same ? chapter.childCount - 1 - run.sceneIds.length : state.doc.nodeAt(toAt)!.childCount - 1);
  const at = Math.max(0, Math.min(index, room));
  if (same && at === first) return false;
  const tr = relocateSpan(state, run.from, run.to, (doc) => sceneSlot(doc, chapterPos(doc, chapterId), at));
  return done(tr, dispatch);
};

/** Name a group (blank: unnamed). One line, trimmed. */
export const renameGroup = (groupId: string, name: string): Command => (state, dispatch) => {
  const text = name.replace(/\s+/g, ' ').trim();
  const names: Record<string, string> = { ...state.doc.attrs.groups };
  if ((names[groupId] ?? '') === text) return false;
  if (text) names[groupId] = text; else delete names[groupId];
  return done(state.tr.setDocAttribute('groups', Object.keys(names).length ? names : null), dispatch);
};

/** Its scenes stay where they are, in no group. */
export const ungroup = (groupId: string): Command => (state, dispatch) => {
  const run = groupsIn(state.doc).find((g) => g.id === groupId);
  if (!run) return false;
  const tr = state.tr;
  for (const id of run.sceneIds) setLink(tr, id, null);
  return done(tr, dispatch);
};
