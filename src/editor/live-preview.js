import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

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

// Pretty view consistently conceals Markdown syntax marks. Concealed ranges
// are atomic so ordinary pointer/arrow movement cannot leave the caret inside
// an invisible delimiter. Authors always edit the visible formatted text.
function build(view) {
  const state = view.state;

  const doc = state.doc;
  const out = [];
  const atomic = [];
  // No widget: an empty replace decoration leaves zero DOM footprint (no
  // element at all), and CodeMirror inserts its own widget-buffer markers
  // around it as needed for cursor navigation -- book-title.js's own
  // long-stable comment-hiding decoration uses the exact same shape. A
  // `display:none` widget span (the previous approach here) still occupies
  // a DOM node the browser's native contenteditable caret logic can get
  // stuck on: typing right at the boundary of a JUST-recognized heading
  // (e.g. finishing "### " and continuing to type the title) could land
  // the native caret on the wrong side of that node, silently inserting
  // new characters before the hidden marks instead of after them.
  const hide = (from, to) => {
    if (from < to) {
      out.push(Decoration.replace({}).range(from, to));
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
    if (update.docChanged) {
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
