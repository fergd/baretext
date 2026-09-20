import { Decoration, EditorView } from '@codemirror/view';
import { StateField, EditorState } from '@codemirror/state';
import { isLinkMetadata, SCENE_GROUP_RE } from '../features/scene-nav/links.js';
import { structuralEdit } from './transaction-types.js';
import { getOutline } from './outline.js';

// Inserting a boundary must not hand a trailing group record to the new
// scene. Keep each surviving record with its original scene's beginning.
// A sequential transaction keeps the correction in the same undo step and
// also covers manually typed/pasted boundaries, not just the scene command.
export const preserveSceneLinks = EditorState.transactionFilter.of(tr => {
  if (tr.annotation(structuralEdit) || !tr.docChanged || tr.isUserEvent('undo') || tr.isUserEvent('redo')) return tr;
  let replacesDocument = false;
  tr.changes.iterChangedRanges((from, to) => { if (from === 0 && to === tr.startState.doc.length) replacesDocument = true; });
  if (replacesDocument) return tr; // structural moves/file loads already own membership
  const oldOutline = getOutline({ state: tr.startState });
  const newOutline = getOutline({ state: tr.state });
  const changes = [];
  for (let i = 0; i < oldOutline.length; i++) {
    const scene = oldOutline[i];
    if (scene.type === 'h1' || scene.type === 'cold-storage') continue;
    const end = oldOutline[i + 1]?.pos ?? tr.startState.doc.length;
    for (let n = tr.startState.doc.lineAt(scene.pos).number; n <= tr.startState.doc.lineAt(end).number; n++) {
      const oldLine = tr.startState.doc.line(n);
      if (oldLine.from >= end || !SCENE_GROUP_RE.test(oldLine.text.trim())) continue;
      const mapped = tr.changes.mapPos(oldLine.from, 1);
      const record = tr.newDoc.lineAt(mapped);
      if (record.text.trim() !== oldLine.text.trim()) continue;
      const anchor = tr.changes.mapPos(scene.pos, 1);
      const index = newOutline.findLastIndex(item => item.pos <= anchor);
      const owner = newOutline[index];
      if (!owner || owner.type === 'h1' || owner.type === 'cold-storage') continue;
      const ownerEnd = newOutline[index + 1]?.pos ?? tr.newDoc.length;
      if (record.from < ownerEnd) continue;
      const content = tr.newDoc.sliceString(owner.pos, ownerEnd);
      const insertAt = owner.pos + content.trimEnd().length;
      changes.push({ from: insertAt, insert: '\n' + record.text.trim() + '\n' });
      changes.push({ from: record.from, to: Math.min(record.to + 1, tr.newDoc.length), insert: '' });
    }
  }
  return changes.length ? [tr, { changes: changes.sort((a, b) => a.from - b.from), sequential: true }] : tr;
});

function build(state) {
  const ranges = [];
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (isLinkMetadata(line.text)) {
      ranges.push(Decoration.replace({ block: true }).range(line.from, Math.min(line.to + 1, state.doc.length)));
    }
  }
  return Decoration.set(ranges);
}

// Persistent boundary metadata has no manuscript text or vertical footprint.
export const sceneLinkMetadata = StateField.define({
  create: build,
  update: (value, tr) => tr.docChanged ? build(tr.state) : value,
  provide: field => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.from(field, ranges => () => ranges),
  ],
});
