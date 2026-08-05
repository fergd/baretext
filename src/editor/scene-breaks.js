import { Decoration, ViewPlugin } from '@codemirror/view';

const sceneBreakLine = Decoration.line({ class: 'cm-scene-break' });

function build(view) {
  const doc = view.state.doc;
  const decos = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.text.trim())) {
      decos.push(sceneBreakLine.range(line.from));
    }
  }
  return Decoration.set(decos);
}

// Tags any line that's just ---/***/___ (3+) with .cm-scene-break; the raw
// dashes are visually hidden by CSS in favor of a centered rule + dot
// ornament, while staying selectable/editable (caret still shows).
export const sceneBreakDecorator = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
  }
}, { decorations: v => v.decorations });

export function injectSceneBreakStyle() {
  if (document.getElementById('bt-scene-break')) return;
  const style = document.createElement('style');
  style.id = 'bt-scene-break';
  style.textContent = `
.cm-scene-break {
  position: relative; color: transparent !important; caret-color: var(--cursor) !important;
  text-align: center; height: 2.6em;
}
.cm-scene-break * { color: transparent !important; }
.cm-scene-break::before {
  content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 64px; height: 1.5px; background: var(--accent); opacity: 0.6; pointer-events: none;
}
.cm-scene-break::after {
  content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 9px; height: 9px; border-radius: 50%;
  border: 1.5px solid var(--accent); background: var(--bg); pointer-events: none;
}
`;
  document.head.appendChild(style);
}

// Inserts a blank-padded scene break at the caret, adding leading blank
// lines only when needed (not already at the start of an empty line).
export function insertSceneBreak(view) {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const atLineStart = from === line.from;
  const lineIsEmpty = line.text.trim() === '';

  let insert = '';
  if (!lineIsEmpty || !atLineStart) insert += '\n\n';
  insert += '---\n\n';

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  });
  view.focus();
  return true;
}
