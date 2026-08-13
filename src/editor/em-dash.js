import { EditorView } from '@codemirror/view';
import { collectSkipRanges, inSkipRange } from './skip-ranges.js';

// Auto-converts a typed "--" to an em dash, the same convenience Word,
// Google Docs, iA Writer, and Scrivener all offer. The one thing that
// conflicts with it here: "---" alone on its own line is this app's
// scene-break marker (see scene-nav/reorder.js), a load-bearing token, not
// decoration -- converting eagerly on the second dash would corrupt every
// scene break the instant its third dash lands. Waiting for the character
// AFTER the two dashes sidesteps that for free: if that next character is
// itself a dash, the run is still growing (headed for "---" or longer) and
// is left alone; anything else means the line can no longer trim down to a
// bare dash-only marker, so the "--" it completes is unambiguously inline
// prose and safe to convert.
export const emDashInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  if (text.length !== 1 || text === '-') return false;
  if (from !== to) return false; // replacing a selection -- not a plain keystroke, let the default happen
  if (from < 2) return false;

  const doc = view.state.doc;
  if (doc.sliceString(from - 2, from) !== '--') return false;
  if (from >= 3 && doc.sliceString(from - 3, from - 2) === '-') return false; // part of a longer run ("---" or more)

  if (inSkipRange(collectSkipRanges(view.state), from - 1)) return false;

  view.dispatch({
    changes: { from: from - 2, to, insert: '—' + text },
    selection: { anchor: from - 2 + 1 + text.length },
    userEvent: 'input.type',
  });
  return true;
});
