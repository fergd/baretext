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
[data-theme="ayu"]     { --h1: #ffb454; --h2: #f29718; --h3: #e6b673; --h4: #c49a52; }
[data-theme="dracula"] { --h1: #bd93f9; --h2: #ff79c6; --h3: #8be9fd; --h4: #50fa7b; }
`;
  document.head.appendChild(style);
}

// Dimensions read from CSS custom properties (docs/theme-spec.md is ground
// truth) instead of hardcoded pixel values, so the app's CSS is the single
// source of truth and Editor mode's future rail can override
// --editor-measure without touching this bundle again.
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
    maxWidth: 'var(--editor-measure, 620px)',
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
