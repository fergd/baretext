import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

// Two explicit editing surfaces share the exact same Markdown document:
// false (default) = Pretty view, true = Markdown view. Pretty view's
// decorations depend only on document content, never on caret position.
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

class ListMarkerWidget extends WidgetType {
  constructor(kind, label = '', checked = false) {
    super();
    this.kind = kind;
    this.label = label;
    this.checked = checked;
  }
  eq(other) {
    return other.kind === this.kind && other.label === this.label && other.checked === this.checked;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-list-marker cm-list-marker-' + this.kind + (this.checked ? ' checked' : '');
    span.setAttribute('aria-hidden', 'true');
    if (this.kind !== 'task') span.textContent = this.label;
    return span;
  }
  ignoreEvent() { return false; }
}

const emptyBuild = () => ({ decorations: Decoration.none, atomicRanges: Decoration.none });

// Pretty view consistently conceals Markdown syntax marks. Concealed ranges
// are atomic so ordinary pointer/arrow movement cannot leave the caret inside
// an invisible delimiter. Authors edit the visible text here and switch to
// Markdown view when they want direct control of the source syntax.
function build(view) {
  const state = view.state;
  if (state.field(renderedModeField)) return emptyBuild();

  const doc = state.doc;
  const out = [];
  const atomic = [];
  const hide = (from, to) => {
    if (from < to) {
      out.push(Decoration.replace({ widget: new HiddenWidget() }).range(from, to));
      atomic.push(Decoration.mark({}).range(from, to));
    }
  };

  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name;
      if (/^ATXHeading[1-6]$/.test(name)) {
        const mark = node.node.getChild('HeaderMark');
        if (mark) {
          let end = mark.to;
          if (doc.sliceString(end, end + 1) === ' ') end++;
          hide(node.from, end);
        }
      } else if (name === 'StrongEmphasis' || name === 'Emphasis') {
        const first = node.node.firstChild, last = node.node.lastChild;
        if (first && first.name === 'EmphasisMark') hide(first.from, first.to);
        if (last && last.name === 'EmphasisMark') hide(last.from, last.to);
      } else if (name === 'InlineCode') {
        const first = node.node.firstChild, last = node.node.lastChild;
        if (first && first.name === 'CodeMark') hide(first.from, first.to);
        if (last && last.name === 'CodeMark') hide(last.from, last.to);
      } else if (name === 'Link') {
        for (let c = node.node.firstChild; c; c = c.nextSibling) {
          if (c.name === 'LinkMark' || c.name === 'URL') hide(c.from, c.to);
        }
      } else if (name === 'ListItem') {
        const mark = node.node.getChild('ListMark');
        if (!mark) return;

        const task = node.node.getChild('Task');
        const taskMark = task && task.getChild('TaskMarker');
        let end = taskMark ? taskMark.to : mark.to;
        if (doc.sliceString(end, end + 1) === ' ') end++;

        let widget;
        if (taskMark) {
          const checked = /x/i.test(doc.sliceString(taskMark.from, taskMark.to));
          widget = new ListMarkerWidget('task', '', checked);
        } else {
          const label = doc.sliceString(mark.from, mark.to);
          widget = /^\d/.test(label)
            ? new ListMarkerWidget('ordered', label)
            : new ListMarkerWidget('bullet', '•');
        }
        out.push(Decoration.replace({ widget }).range(mark.from, end));
        atomic.push(Decoration.mark({}).range(mark.from, end));
        out.push(Decoration.line({ class: 'cm-list-line' }).range(doc.lineAt(node.from).from));
      }
    },
  });

  out.sort((a, b) => a.from - b.from || a.to - b.to);
  const deduped = [];
  let lastTo = -1;
  for (const r of out) {
    if (r.from >= lastTo) { deduped.push(r); lastTo = r.to; }
  }
  atomic.sort((a, b) => a.from - b.from || a.to - b.to);
  return {
    decorations: Decoration.set(deduped, true),
    atomicRanges: Decoration.set(atomic, true),
  };
}

export const livePreviewPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    const built = build(view);
    this.decorations = built.decorations;
    this.atomicRanges = built.atomicRanges;
  }
  update(update) {
    const modeToggled = update.transactions.some(tr => tr.effects.some(e => e.is(setRenderedModeEffect)));
    if (update.docChanged || modeToggled) {
      const built = build(update.view);
      this.decorations = built.decorations;
      this.atomicRanges = built.atomicRanges;
    }
  }
}, {
  decorations: v => v.decorations,
  provide: plugin => EditorView.atomicRanges.of(view => (
    view.plugin(plugin)?.atomicRanges || Decoration.none
  )),
});

export function setRenderedMode(view, showRaw) {
  // Switching views may change wrapping and block heights. Preserve the
  // reader's viewport explicitly instead of allowing a geometry remeasure to
  // choose a seemingly random new scroll position.
  view.dispatch({ effects: [setRenderedModeEffect.of(showRaw), view.scrollSnapshot()] });
}

export function injectLivePreviewStyle() {
  if (document.getElementById('bt-live-preview-style')) return;
  const style = document.createElement('style');
  style.id = 'bt-live-preview-style';
  style.textContent = `
.cm-line.cm-list-line {
  padding-left: 1.75em;
  text-indent: -1.75em;
}
.cm-list-marker {
  display: inline-flex;
  width: 1.75em;
  justify-content: center;
  align-items: center;
  color: var(--accent);
  text-indent: 0;
  font-variant-numeric: tabular-nums;
}
.cm-list-marker-task::before {
  content: '';
  width: 0.72em;
  height: 0.72em;
  box-sizing: border-box;
  border: 1.5px solid currentColor;
  border-radius: 2px;
}
.cm-list-marker-task.checked::before {
  content: '✓';
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--bg);
  background: var(--accent);
  font-size: 0.62em;
  font-weight: 700;
  line-height: 1;
}
`;
  document.head.appendChild(style);
}
