import { diffLines } from 'diff';

// Keep unchanged paragraphs in CodeMirror's document/height model. Structural
// operations may serialize the manuscript, but must not replace its whole buffer.
export function documentChanges(before, after) {
  const parts = diffLines(before, after);
  const changes = [];
  let pos = 0, pending = null;
  const flush = () => {
    if (!pending) return;
    let { from, to, insert } = pending;
    while (from < to && insert && before[from] === insert[0]) { from++; insert = insert.slice(1); }
    while (to > from && insert && before[to - 1] === insert.at(-1)) { to--; insert = insert.slice(0, -1); }
    if (from !== to || insert) changes.push({ from, to, insert });
    pending = null;
  };
  for (const part of parts) {
    if (!part.added && !part.removed) { flush(); pos += part.value.length; continue; }
    if (!pending) pending = { from: pos, to: pos, insert: '' };
    if (part.removed) { pos += part.value.length; pending.to = pos; }
    else pending.insert += part.value;
  }
  flush();
  return changes;
}
