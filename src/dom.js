// Tiny DOM-creation primitives shared by every hand-rolled UI surface in
// this app (rail, corkboard, sprint timer, find/replace, theme picker,
// transient feature panels). Previously each of those files defined
// its own byte-identical copy of these three functions — six independent
// copies of el(), four of icon(), three of btn() — with no code sharing
// them, just repeated verbatim. Extracted here once an architecture review
// flagged it as the clearest duplication in the codebase.

export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// mousedown -> preventDefault() keeps a click on chrome (not the editor)
// from stealing focus away from the CodeMirror content — used everywhere
// in this app's rails/panels/toolbars.
export function btn(className, text) {
  const b = document.createElement('button');
  b.type = 'button';
  if (className) b.className = className;
  if (text !== undefined) b.textContent = text;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  return b;
}

export function icon(cls) {
  const i = document.createElement('i');
  i.className = 'lucide ' + cls;
  i.setAttribute('aria-hidden', 'true');
  return i;
}

// Injects a <style> tag once, id-guarded so remounting a feature or
// reopening a picker never appends a duplicate copy — the exact same
// five-line shape every injectXStyle() in this codebase (14 of them)
// repeated independently before this. Each file keeps its own named
// export (injectSceneBreakStyle, ...) — only the
// boilerplate body collapses to a single call here.
export function injectStyle(id, css) {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}
