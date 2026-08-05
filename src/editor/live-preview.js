import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

// Toggles "rendered mode": true = show raw markdown (no concealment),
// false (default) = live-preview concealment active. Naming is a little
// counterintuitive (true doesn't mean "show the rendered/formatted view")
// but matches the original bundle's confirmed behavior exactly.
export const setRenderedModeEffect = StateEffect.define();

export const renderedModeField = StateField.define({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setRenderedModeEffect)) return effect.value;
    }
    return value;
  },
});

class HiddenWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.style.display = 'none';
    return span;
  }
  ignoreEvent() { return false; }
}

// Conceals markdown syntax marks — ATX heading #s, bold/italic markers,
// inline-code backticks, link brackets/URL — everywhere except the line the
// caret is currently on, where raw syntax is revealed for editing.
function build(view) {
  const state = view.state;
  if (state.field(renderedModeField)) return Decoration.none;

  const doc = state.doc;
  const cursorLine = doc.lineAt(state.selection.main.head).number;
  const out = [];
  const hide = (from, to) => {
    if (from < to) out.push(Decoration.replace({ widget: new HiddenWidget() }).range(from, to));
  };
  const onCursorLine = (node) => doc.lineAt(node.from).number === cursorLine;

  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name;
      if (/^ATXHeading[1-6]$/.test(name)) {
        if (onCursorLine(node)) return;
        const mark = node.node.getChild('HeaderMark');
        if (mark) {
          let end = mark.to;
          if (doc.sliceString(end, end + 1) === ' ') end++;
          hide(node.from, end);
        }
      } else if (name === 'StrongEmphasis' || name === 'Emphasis') {
        if (onCursorLine(node)) return;
        const first = node.node.firstChild, last = node.node.lastChild;
        if (first && first.name === 'EmphasisMark') hide(first.from, first.to);
        if (last && last.name === 'EmphasisMark') hide(last.from, last.to);
      } else if (name === 'InlineCode') {
        if (onCursorLine(node)) return;
        const first = node.node.firstChild, last = node.node.lastChild;
        if (first && first.name === 'CodeMark') hide(first.from, first.to);
        if (last && last.name === 'CodeMark') hide(last.from, last.to);
      } else if (name === 'Link') {
        if (onCursorLine(node)) return;
        for (let c = node.node.firstChild; c; c = c.nextSibling) {
          if (c.name === 'LinkMark' || c.name === 'URL') hide(c.from, c.to);
        }
      }
    },
  });

  out.sort((a, b) => a.from - b.from || a.to - b.to);
  const deduped = [];
  let lastTo = -1;
  for (const r of out) {
    if (r.from >= lastTo) { deduped.push(r); lastTo = r.to; }
  }
  return Decoration.set(deduped, true);
}

export const livePreviewPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(update) {
    const modeToggled = update.transactions.some(tr => tr.effects.some(e => e.is(setRenderedModeEffect)));
    if (update.docChanged || update.viewportChanged || update.selectionSet || modeToggled) {
      this.decorations = build(update.view);
    }
  }
}, { decorations: v => v.decorations });

export function setRenderedMode(view, showRaw) {
  view.dispatch({ effects: setRenderedModeEffect.of(showRaw) });
}
