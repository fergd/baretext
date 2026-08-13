import { Decoration, EditorView } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';

// Cold Storage (see scene-nav/model.js/reorder.js) is a place to park cut
// scenes, but its raw text still lives at the end of the same document
// CodeMirror renders — without this extension, scrolling past the last
// real chapter would scroll straight into it, which defeats the point of
// "parked, out of the way." Two things this extension does, both driven by
// the same mechanism (Decoration.replace hiding a range of the document,
// the same technique code folding is built on):
//
//   1. Normal mode (coldStorageViewField is null): the WHOLE Cold Storage
//      section (from its <!-- COLD STORAGE --> marker to the end of the
//      doc) is always hidden from the scrollable manuscript. You cannot
//      scroll into it by any amount of scrolling — it isn't there.
//   2. Scene view (coldStorageViewField holds {from, to}): the inverse —
//      everything OUTSIDE that one scene's range is hidden, so the visible
//      document is just that scene, standalone. Entered by clicking a Cold
//      Storage scene in the rail (see scene-nav/rail.js/index.js), which
//      also remembers where the cursor was in the real manuscript so "back"
//      can return to it.
//
// Editing still writes to the real, single document underneath — nothing
// here is a separate view or a copy that needs syncing back. Only what's
// rendered/scrollable changes.
const COLD_STORAGE_MARKER = '<!-- COLD STORAGE -->';

export const setColdStorageViewEffect = StateEffect.define();

export const coldStorageViewField = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setColdStorageViewEffect)) return effect.value;
    }
    // Keep the isolated scene's boundaries correct across an ordinary
    // edit inside it (typing) without waiting for scene-nav's own debounced
    // re-render — assoc -1 on `from` and 1 on `to` means text typed right at
    // either edge of the scene stays part of the visible scene, not
    // swallowed into the hidden region on either side.
    if (tr.docChanged && value) {
      return { from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) };
    }
    return value;
  },
});

function findColdStorageMarkerPos(doc) {
  const idx = doc.toString().indexOf(COLD_STORAGE_MARKER);
  return idx === -1 ? -1 : doc.lineAt(idx).from;
}

function buildDecorations(state) {
  const view = state.field(coldStorageViewField);
  const doc = state.doc;

  if (view) {
    const decos = [];
    if (view.from > 0) decos.push(Decoration.replace({}).range(0, view.from));
    if (view.to < doc.length) decos.push(Decoration.replace({}).range(view.to, doc.length));
    return Decoration.set(decos);
  }

  const markerPos = findColdStorageMarkerPos(doc);
  if (markerPos === -1) return Decoration.none;
  return Decoration.set([Decoration.replace({}).range(markerPos, doc.length)]);
}

export const coldStorageHideField = StateField.define({
  create: (state) => buildDecorations(state),
  update(value, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(setColdStorageViewEffect))) {
      return buildDecorations(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
