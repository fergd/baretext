// A scene name the writer starts (Name scene) and leaves empty is dropped:
// when the caret moves away from it without anything typed, the scene is
// unnamed again (shown by its ornament), so no stray "Untitled" names
// linger. Only names created this way are ever dropped — an empty name that
// came from the file is the writer's and stays — and only a caret move
// triggers it, never an edit. The drop holds no text, so it is not an undo
// step: undo never brings an abandoned empty name back.

import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { schema } from './schema';
import { markStructural } from './structure';

/** Positions of empty names just created by Name scene. */
const freshKey = new PluginKey<number[]>('freshSceneNames');

/** Mark the scene name at `headingPos` as just started (see nameSceneAt). */
export function markFreshSceneName(tr: Transaction, headingPos: number): Transaction {
  return tr.setMeta(freshKey, headingPos);
}

export function dropEmptySceneNames(): Plugin<number[]> {
  return new Plugin<number[]>({
    key: freshKey,
    state: {
      init: () => [],
      apply(tr, fresh, _old, state) {
        const added = tr.getMeta(freshKey) as number | undefined;
        let next = tr.docChanged ? fresh.map((p) => tr.mapping.map(p)) : fresh;
        if (added !== undefined) next = [...next, added];
        // A name stays "fresh" only while it exists and is still empty.
        return next.filter((p) => {
          const n = state.doc.nodeAt(p);
          return !!n && n.type === schema.nodes.scene_heading && n.content.size === 0;
        });
      },
    },
    appendTransaction(trs, oldState, newState) {
      // "Leaving" is a caret move; any edit leaves structure alone.
      if (trs.some((tr) => tr.docChanged) || !trs.some((tr) => tr.selectionSet)) return null;
      const $was = oldState.selection.$head;
      if ($was.parent.type !== schema.nodes.scene_heading) return null;
      const pos = $was.before();
      if (!freshKey.getState(newState)!.includes(pos)) return null;
      const heading = newState.doc.nodeAt(pos)!;
      const { $head } = newState.selection;
      if ($head.pos > pos && $head.pos < pos + heading.nodeSize) return null; // still in it
      return markStructural(newState.tr.delete(pos, pos + heading.nodeSize)).setMeta('addToHistory', false);
    },
  });
}
