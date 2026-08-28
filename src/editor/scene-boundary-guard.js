import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { deleteCharBackward, deleteGroupBackward } from '@codemirror/commands';
import { getOutline } from './outline.js';

// Chapters and scenes are only ever meant to be deleted from the rail's own
// two-click-confirm delete button (see scene-nav/rail.js/ui-helpers.js) --
// never as a side effect of ordinary backspacing. Without this, backspacing
// from the start of a scene/chapter's prose eats into (or, given enough
// presses, entirely through) the "#" heading marker or "---" scene break
// that defines it, silently merging or deleting real structure with no
// confirm step and no visible trace of what happened.
const NAME_COMMENT_RE = /^<!--.*-->$/;
const MARKER_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const HEADING_PREFIX_RE = /^#{1,3}[ \t]*/;

// Mirrors scene-nav/model.js's firstProsePos for an explicit-marker scene:
// skip the marker line itself and, if present, its waypoint-name comment,
// landing on the first real content line -- or the marker's own position if
// the scene is still empty (a fresh draft with nothing typed into it yet),
// same fallback firstProsePos uses.
function contentStartFor(doc, itemPos, endPos) {
  const raw = doc.sliceString(itemPos, endPos);
  const lines = raw.split('\n');
  let offset = 0;
  for (let i = 1; i < lines.length; i++) {
    offset += lines[i - 1].length + 1;
    const trimmed = lines[i].trim();
    if (trimmed && !NAME_COMMENT_RE.test(trimmed)) return itemPos + offset;
  }
  return itemPos;
}

// True if backspacing (or word/group-backward deleting) from the current
// cursor would delete into, or merge across, a chapter heading's "#" prefix
// or a scene break's marker/name-comment preamble. Only a collapsed cursor
// is guarded -- an explicit multi-line selection is a deliberate, visible
// gesture the writer chose, not an accidental one-key slip, so it's left to
// the default command.
export function wouldCrossBoundary(view) {
  const sel = view.state.selection.main;
  if (!sel.empty || sel.head === 0) return false;
  const pos = sel.head;
  const doc = view.state.doc;
  const outline = getOutline(view);

  for (let i = 0; i < outline.length; i++) {
    const item = outline[i];
    // Sitting exactly at a boundary's own start -- stop here regardless of
    // what precedes it (deleting further would merge two chapters/scenes,
    // even if what's right before is itself just ordinary prose).
    if (pos === item.pos) return true;

    if (item.type === 'h1' || item.type === 'h2' || item.type === 'h3') {
      const line = doc.lineAt(item.pos);
      const m = HEADING_PREFIX_RE.exec(line.text);
      const prefixEnd = line.from + (m ? m[0].length : 0);
      if (pos > item.pos && pos <= prefixEnd) return true;
      continue;
    }

    if (item.type === 'scene') {
      const line = doc.lineAt(item.pos);
      if (!MARKER_RE.test(line.text.trim())) continue; // implicit first scene -- no marker text to protect
      const endPos = i + 1 < outline.length ? outline[i + 1].pos : doc.length;
      const contentStart = contentStartFor(doc, item.pos, endPos);
      if (pos > item.pos && pos <= contentStart) return true;
    }
  }
  return false;
}

function guarded(command) {
  return (view) => wouldCrossBoundary(view) || command(view);
}

export function sceneBoundaryGuardKeymap() {
  return Prec.highest(keymap.of([
    { key: 'Backspace', run: guarded(deleteCharBackward), shift: guarded(deleteCharBackward) },
    { key: 'Mod-Backspace', mac: 'Alt-Backspace', run: guarded(deleteGroupBackward) },
  ]));
}
