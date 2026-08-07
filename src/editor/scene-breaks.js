import { Decoration, ViewPlugin } from '@codemirror/view';

const sceneBreakLine = Decoration.line({ class: 'cm-scene-break' });
// A waypoint name lives as an HTML comment right after its marker line (or,
// for a chapter's markerless implicit first scene, right before its
// content) — see outline.js/rename.js. attributes carries the actual name
// text through to CSS via attr(), so the raw <!-- --> syntax stays hidden
// the same way the marker's raw dashes are, in favor of just the name.
function nameCommentLine(name) {
  return Decoration.line({ class: 'cm-scene-name-comment', attributes: { 'data-scene-name': name } });
}
const NAME_COMMENT_RE = /^<!--\s*(.*?)\s*-->$/;

// Kept independent of outline.js on purpose — this only ever needs to know
// "hide this line, show that instead," not the full chapter/scene model
// outline.js builds for scene-nav, so a light local scan (heading / marker /
// first-content-after-a-chapter-heading) is enough, mirroring outline.js's
// own scan closely enough to land on the same lines.
function build(view) {
  const doc = view.state.doc;
  const decos = [];
  let awaitingFirstContent = false;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const trimmed = line.text.trim();
    const headingMatch = line.text.match(/^(#{1,3})(?:[ \t]+.*)?$/);

    if (headingMatch) {
      awaitingFirstContent = headingMatch[1].length === 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      decos.push(sceneBreakLine.range(line.from));
      awaitingFirstContent = false;
      if (i + 1 <= doc.lines) {
        const next = doc.line(i + 1);
        const m = next.text.trim().match(NAME_COMMENT_RE);
        if (m) decos.push(nameCommentLine(m[1]).range(next.from));
      }
      continue;
    }
    if (awaitingFirstContent) {
      const m = trimmed.match(NAME_COMMENT_RE);
      if (m) { decos.push(nameCommentLine(m[1]).range(line.from)); continue; }
      if (trimmed !== '') awaitingFirstContent = false;
    }
  }
  return Decoration.set(decos, true);
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
.cm-scene-name-comment {
  position: relative; color: transparent !important; caret-color: var(--cursor) !important;
  text-align: center; height: 1.7em;
}
.cm-scene-name-comment * { color: transparent !important; }
.cm-scene-name-comment::before {
  content: attr(data-scene-name); position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  color: var(--text-dimmer); font-size: 11px; font-style: italic; white-space: nowrap;
  pointer-events: none;
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
