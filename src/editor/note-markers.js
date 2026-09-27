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
    marker.dataset.noteId = this.noteId;
    marker.addEventListener('mousedown', (event) => event.preventDefault());
    marker.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      marker.dispatchEvent(new CustomEvent('baretext-note-marker-click', {
        bubbles: true,
        detail: { noteId: this.noteId },
      }));
    });
    return marker;
  }
  ignoreEvent() { return false; }
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
      .map((marker) => Decoration.widget({ widget: new NoteMarkerWidget(marker.id), side: -1 }).range(marker.from)),
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
    .cm-content > .cm-line { position:relative; }
    .cm-note-marker { position:absolute; left:calc(100% + 12px); top:50%; display:block; width:12px; height:12px; margin-top:-6px; color:var(--accent); font:0/0 var(--font-mono); opacity:.9; cursor:pointer; z-index:2; }
    .cm-note-marker::before { content:'●'; display:block; font:12px/12px var(--font-mono); }
    .cm-note-marker:hover { opacity:1; transform:scale(1.2); }
  `;
  document.head.appendChild(style);
}
