import { StateField } from '@codemirror/state';
import { getOutline } from './outline.js';
import { structuralEdit } from './transaction-types.js';

function scan(state) {
  const items = getOutline({ state });
  return items.map((item, i) => ({ ...item,
    signature: state.doc.sliceString(item.pos, items[i + 1]?.pos ?? state.doc.length).trim(),
    identityKey: state.doc.sliceString(item.pos, items[i + 1]?.pos ?? state.doc.length).replace(/^(-{3,}|\*{3,}|_{3,})\s*\n/, '').replace(/^<!--.*-->\s*$/gm, '').trim(),
  }));
}

// Session identities follow editor transactions, not rail array indexes.
// No extra records are inserted into the author's manuscript.
export const outlineState = StateField.define({
  create(state) { return { next: 1, items: scan(state).map((item, i) => ({...item, stableId: 'outline-' + i})), }; },
  update(value, tr) {
    if (!tr.docChanged) return value;
    const items = scan(tr.state), used = new Set();
    let next = Math.max(value.next, ...value.items.map(i => Number(i.stableId.slice(8)) + 1));
    for (const item of items) {
      let old;
      if (tr.annotation(structuralEdit) || tr.isUserEvent('undo') || tr.isUserEvent('redo')) {
        const matches = value.items.filter(o => !used.has(o) && o.type === item.type && o.identityKey === item.identityKey);
        if (matches.length === 1) old = matches[0];
      }
      if (!old) old = value.items.find(o => !used.has(o) && o.type === item.type && tr.changes.mapPos(o.pos, 1) === item.pos);
      if (old) used.add(old);
      item.stableId = old?.stableId ?? 'outline-' + next++;
    }
    return { next, items };
  },
});

export function getStableOutline(view) {
  return view.state.field(outlineState, false)?.items ?? getOutline(view);
}
