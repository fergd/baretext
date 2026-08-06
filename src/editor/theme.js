import { EditorView } from '@codemirror/view';

// CodeMirror's default selection layer renders inconsistently across our
// four themes; force it to always use --sel, focused or not.
export function injectSelectionFix() {
  if (document.getElementById('bt-selection-fix')) return;
  const style = document.createElement('style');
  style.id = 'bt-selection-fix';
  style.textContent = `
.cm-editor.cm-editor .cm-scroller .cm-selectionLayer .cm-selectionBackground { background-color: var(--sel) !important; }
.cm-editor.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground { background-color: var(--sel) !important; }
.cm-editor .cm-content ::selection, .cm-editor .cm-content:focus ::selection, .cm-editor.cm-focused .cm-content ::selection { background-color: var(--sel) !important; }
`;
  document.head.appendChild(style);
}

// Per-theme heading colors, referenced by markdown-language.js's HighlightStyle.
export function injectHeadingColors() {
  if (document.getElementById('bt-heading-colors')) return;
  const style = document.createElement('style');
  style.id = 'bt-heading-colors';
  style.textContent = `
[data-theme="dark"]    { --h1: #e8c97a; --h2: #c4a85a; --h3: #a08844; --h4: #7a6832; }
[data-theme="light"]   { --h1: #8b5e0a; --h2: #b07820; --h3: #7a5515; --h4: #5a3e0e; }
[data-theme="amstrad"] { --h1: #8fd670; --h2: #6fb050; --h3: #549040; --h4: #3d6c30; }
[data-theme="grove"]   { --h1: #a7c080; --h2: #e69875; --h3: #dbbc7f; --h4: #83c092; }
[data-theme="dracula"] { --h1: #bd93f9; --h2: #ff79c6; --h3: #8be9fd; --h4: #50fa7b; }
`;
  document.head.appendChild(style);
}

// Dimensions read from CSS custom properties (docs/theme-spec.md is ground
// truth) instead of hardcoded pixel values, so the app's CSS is the single
// source of truth and Editor mode's rail can override --editor-measure
// without touching this bundle again. --editor-measure is in `ch` units
// (character-relative, not px) specifically so the line measure is one
// constant to tune in index.html's :root regardless of font/zoom — see
// --editor-measure there.
export const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--text)', height: '100%' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-editor, var(--font-mono))',
    lineHeight: 'var(--lh-body, 1.9)',
    minHeight: '100%',
  },
  '.cm-content': {
    fontFamily: 'var(--font-editor, var(--font-mono))',
    fontSize: 'var(--text-body, 15px)',
    caretColor: 'var(--cursor)',
    maxWidth: 'var(--editor-measure, 75ch)',
    margin: '0 auto',
    padding: '20px 40px 60px 40px',
    width: '100%',
    minHeight: '100%',
    boxSizing: 'border-box',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--cursor)', borderLeftWidth: '2px' },
  '.cm-selectionBackground': { backgroundColor: 'var(--sel)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--sel)' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--placeholder)' },
});
