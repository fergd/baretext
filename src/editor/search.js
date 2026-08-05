import { SearchQuery } from '@codemirror/search';
import { StateField, StateEffect } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

// Headless — no visual panel (the app has its own). @codemirror/search's
// findNext/findPrevious/replaceNext/replaceAll commands pop open its built-in
// panel as a side effect, so this builds custom navigation directly on
// SearchQuery.getCursor() instead of calling those commands.

const setQueryEffect = StateEffect.define();
const setCurrentIndexEffect = StateEffect.define();

function computeMatches(state, query) {
  if (!query || !query.valid) return [];
  const matches = [];
  const cursor = query.getCursor(state.doc);
  let result = cursor.next();
  while (!result.done) {
    matches.push({ from: result.value.from, to: result.value.to });
    result = cursor.next();
  }
  return matches;
}

const searchField = StateField.define({
  create: () => ({ query: null, matches: [], currentIndex: -1 }),
  update(value, tr) {
    let { query, matches, currentIndex } = value;
    let newQuerySet = false;

    for (const effect of tr.effects) {
      if (effect.is(setQueryEffect)) { query = effect.value; newQuerySet = true; }
    }

    if (newQuerySet) {
      matches = computeMatches(tr.state, query);
      currentIndex = matches.length ? 0 : -1;
    } else if (tr.docChanged && query) {
      matches = computeMatches(tr.state, query);
      if (currentIndex >= matches.length) currentIndex = matches.length ? matches.length - 1 : -1;
    }

    for (const effect of tr.effects) {
      if (effect.is(setCurrentIndexEffect)) currentIndex = effect.value;
    }

    return { query, matches, currentIndex };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => {
    if (!value.matches.length) return Decoration.none;
    const decos = value.matches.map((m, i) =>
      Decoration.mark({ class: i === value.currentIndex ? 'cm-searchMatch cm-searchMatch-selected' : 'cm-searchMatch' }).range(m.from, m.to)
    );
    return Decoration.set(decos);
  }),
});

export const searchExtension = searchField;

export function setSearchQuery(view, queryText, opts = {}) {
  const query = new SearchQuery({
    search: queryText || '',
    caseSensitive: !!opts.caseSensitive,
  });
  view.dispatch({ effects: setQueryEffect.of(query.valid && queryText ? query : null) });
  const field = view.state.field(searchField);
  if (field.matches.length) {
    const match = field.matches[field.currentIndex];
    view.dispatch({ selection: { anchor: match.from, head: match.to }, effects: EditorView.scrollIntoView(match.from, { y: 'center' }) });
  }
  return { count: field.matches.length, index: field.matches.length ? field.currentIndex + 1 : 0 };
}

export function findNext(view) {
  const field = view.state.field(searchField);
  if (!field.matches.length) return { count: 0, index: 0 };
  const nextIndex = (field.currentIndex + 1) % field.matches.length;
  const match = field.matches[nextIndex];
  view.dispatch({
    effects: [setCurrentIndexEffect.of(nextIndex), EditorView.scrollIntoView(match.from, { y: 'center' })],
    selection: { anchor: match.from, head: match.to },
  });
  return { count: field.matches.length, index: nextIndex + 1 };
}

export function findPrevious(view) {
  const field = view.state.field(searchField);
  if (!field.matches.length) return { count: 0, index: 0 };
  const prevIndex = (field.currentIndex - 1 + field.matches.length) % field.matches.length;
  const match = field.matches[prevIndex];
  view.dispatch({
    effects: [setCurrentIndexEffect.of(prevIndex), EditorView.scrollIntoView(match.from, { y: 'center' })],
    selection: { anchor: match.from, head: match.to },
  });
  return { count: field.matches.length, index: prevIndex + 1 };
}

export function replaceCurrent(view, replacement) {
  const field = view.state.field(searchField);
  if (field.currentIndex < 0 || !field.matches[field.currentIndex]) {
    return { count: field.matches.length, index: field.matches.length ? field.currentIndex + 1 : 0 };
  }
  const match = field.matches[field.currentIndex];
  view.dispatch({ changes: { from: match.from, to: match.to, insert: replacement } });
  const newField = view.state.field(searchField);
  return { count: newField.matches.length, index: newField.matches.length ? newField.currentIndex + 1 : 0 };
}

export function replaceAll(view, queryText, replacement, opts = {}) {
  const query = new SearchQuery({ search: queryText || '', caseSensitive: !!opts.caseSensitive });
  if (!query.valid) return 0;
  const matches = computeMatches(view.state, query);
  if (!matches.length) return 0;
  const changes = matches.map((m) => ({ from: m.from, to: m.to, insert: replacement }));
  view.dispatch({ changes, effects: setQueryEffect.of(null) });
  return matches.length;
}

export function clearSearch(view) {
  view.dispatch({ effects: setQueryEffect.of(null) });
}

export function injectSearchMatchStyle() {
  if (document.getElementById('bt-search-match')) return;
  const style = document.createElement('style');
  style.id = 'bt-search-match';
  style.textContent = `
.cm-searchMatch { background: var(--sel); border-radius: 2px; }
.cm-searchMatch-selected { background: color-mix(in srgb, var(--accent) 45%, var(--sel)); }
`;
  document.head.appendChild(style);
}
