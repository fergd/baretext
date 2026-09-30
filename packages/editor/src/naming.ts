// A scene name left empty is dropped: when the caret leaves a scene name
// that was already empty (one the writer started and abandoned), the scene
// becomes unnamed again (shown by its ornament), so no stray "Untitled"
// names linger. A name emptied as part of a larger edit is never touched.
// The drop holds no text, so it is not an undo step: undo never brings an
// abandoned empty name back (whatever the timing).

import { Plugin } from 'prosemirror-state';
import { schema } from './schema';
import { markStructural } from './structure';

export function dropEmptySceneNames(): Plugin {
  return new Plugin({
    appendTransaction(trs, oldState, newState) {
      if (!trs.some((tr) => tr.selectionSet || tr.docChanged)) return null;
      const was = oldState.selection.$head.parent;
      if (was.type !== schema.nodes.scene_heading || was.content.size > 0) return null;
      // Where that name is now.
      const pos = trs.reduce((p, tr) => tr.mapping.map(p), oldState.selection.$head.before());
      const heading = newState.doc.nodeAt(pos);
      if (!heading || heading.type !== schema.nodes.scene_heading || heading.content.size > 0) return null;
      const { $head } = newState.selection;
      if ($head.pos > pos && $head.pos < pos + heading.nodeSize) return null; // still in it
      const tr = newState.tr.delete(pos, pos + heading.nodeSize);
      return markStructural(tr).setMeta('addToHistory', false);
    },
  });
}
