import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

export const setNoteMarkers = StateEffect.define();

class NoteMarkerWidget extends WidgetType {
  constructor(noteId) { super(); this.noteId = noteId; }
  eq(other) { return other.noteId === this.noteId; }
  toDOM() {
    const marker = document.createElement('span');
    marker.className = 'cm-note-marker';
    marker.textContent = '●';
    marker.title = 'Note attached';
    marker.setAttribute('aria-label', 'Note attached');
    return marker;
  }
  ignoreEvent() { return true; }
}

const markerField = StateField.define({
  create: () => [],
  update(markers, transaction) {
    const mapped = transaction.docChanged
      ? markers.map((marker) => ({ ...marker, from: transaction.changes.mapPos(marker.from), to: transaction.changes.mapPos(marker.to) }))
      : markers;
    const effect = transaction.effects.find((candidate) => candidate.is(setNoteMarkers));
    return effect ? (effect.value || []) : mapped;
  },
  provide: (field) => EditorView.decorations.from(field, (markers) => Decoration.set(
    markers
      .filter((marker) => Number.isFinite(marker.to) && marker.to >= marker.from)
      .map((marker) => Decoration.widget({ widget: new NoteMarkerWidget(marker.id), side: 1 }).range(marker.to)),
    true,
  )),
});

export const noteMarkers = markerField;

export function syncNoteMarkers(view, notes) {
  if (!view) return;
  const markers = (notes || [])
    .filter((note) => !note.resolved && Number.isFinite(note.from) && Number.isFinite(note.to))
    .map((note) => ({ id: note.id, from: note.from, to: note.to }));
  view.dispatch({ effects: setNoteMarkers.of(markers) });
}

export function injectNoteMarkerStyle() {
  if (document.getElementById('bt-note-marker-style')) return;
  const style = document.createElement('style');
  style.id = 'bt-note-marker-style';
  style.textContent = `
    .cm-note-marker { display:inline-block; margin-left:5px; color:var(--accent); font:9px/1 var(--font-mono); vertical-align:super; opacity:.9; pointer-events:none; }
  `;
  document.head.appendChild(style);
}
