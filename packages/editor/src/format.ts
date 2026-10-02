// Formatting state and commands behind the selection toolbar (and ⌘K).
// Every command stays inside one scene and never touches titles.

import type { MarkType, Node as PMNode } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { liftTarget } from 'prosemirror-transform';
import { schema } from './schema';
import { sceneDepth } from './commands';

export type FormatState = 'on' | 'off' | 'mixed';

/** Text ranges of the selection that can carry marks (prose, not titles). */
function markableText(state: EditorState, visit: (node: PMNode) => void) {
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (node.isText && parent?.type === schema.nodes.paragraph) visit(node);
  });
}

/** Whether the selected prose has `type`: all of it, none of it, or some. */
export function markState(state: EditorState, type: MarkType): FormatState {
  let on = 0;
  let off = 0;
  markableText(state, (n) => { if (type.isInSet(n.marks)) on++; else off++; });
  return on && off ? 'mixed' : on ? 'on' : 'off';
}

/** True when the selection contains prose the toolbar can format. */
export function hasFormattableText(state: EditorState): boolean {
  if (state.selection.empty) return false;
  let any = false;
  markableText(state, (n) => { if (n.text!.trim()) any = true; });
  return any;
}

/** The link on the selection, when the whole selection shares one. */
export function selectedLink(state: EditorState): string | null {
  let href: string | null | undefined;
  markableText(state, (n) => {
    const h = schema.marks.link!.isInSet(n.marks)?.attrs.href ?? null;
    href = href === undefined || href === h ? h : null;
  });
  return href ?? null;
}

/** Accepts what people paste or type; returns a safe href or null. */
export function normalizeHref(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  if (/^(https?:|mailto:)/i.test(s)) return s;
  if (/^[^@/]+@[^@/]+\.[a-z]{2,}$/i.test(s)) return `mailto:${s}`;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#:].*)?$/i.test(s)) return `https://${s}`;
  return null;
}

export function setLink(href: string): Command {
  return (state, dispatch) => {
    const safe = normalizeHref(href);
    if (!safe || !hasFormattableText(state)) return false;
    if (dispatch) {
      const { from, to } = state.selection;
      const link = schema.marks.link!;
      dispatch(state.tr.removeMark(from, to, link).addMark(from, to, link.create({ href: safe })));
    }
    return true;
  };
}

export const removeLink: Command = (state, dispatch) => {
  if (state.selection.empty) return false;
  const { from, to } = state.selection;
  if (dispatch) dispatch(state.tr.removeMark(from, to, schema.marks.link));
  return true;
};

// ── quote / epigraph ──

interface ParagraphRef { pos: number; node: PMNode; quoted: boolean }

/** Selected paragraphs, when they all sit in one scene (else null). */
function selectedParagraphs(state: EditorState): { paragraphs: ParagraphRef[]; scenePos: number } | null {
  const { $from, $to } = state.selection;
  const df = sceneDepth($from);
  const dt = sceneDepth($to);
  if (df < 0 || dt < 0 || $from.before(df) !== $to.before(dt)) return null;
  const paragraphs: ParagraphRef[] = [];
  state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
    if (node.type === schema.nodes.paragraph) {
      paragraphs.push({ pos, node, quoted: parent?.type === schema.nodes.quote });
      return false;
    }
    return node.type === schema.nodes.quote || node.type === schema.nodes.scene || !node.isTextblock;
  });
  return paragraphs.length ? { paragraphs, scenePos: $from.before(df) } : null;
}

export function quoteState(state: EditorState): FormatState {
  const sel = selectedParagraphs(state);
  if (!sel) return 'off';
  const on = sel.paragraphs.filter((p) => p.quoted).length;
  return on === 0 ? 'off' : on === sel.paragraphs.length ? 'on' : 'mixed';
}

/** Lift the paragraphs of every quote that [from, to] touches out of that quote. */
function liftQuoted(tr: Transaction, from: number, to: number) {
  const quotes: { pos: number; node: PMNode }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === schema.nodes.quote) { quotes.push({ pos, node }); return false; }
    return !node.isTextblock;
  });
  // Last first, so earlier positions stay valid.
  for (const q of quotes.reverse()) {
    const inner = q.pos + 1;
    const $a = tr.doc.resolve(Math.max(from, inner + 1));
    const $b = tr.doc.resolve(Math.min(to, inner + q.node.content.size - 1));
    const range = $a.blockRange($b, (n) => n.type === schema.nodes.quote);
    const target = range && liftTarget(range);
    if (range && target != null) tr.lift(range, target);
  }
}

/**
 * Quote/epigraph: wraps the selected paragraphs in one quote, or unwraps
 * them when they are all quoted. Only within a single scene.
 */
export const toggleQuote: Command = (state, dispatch) => {
  const sel = selectedParagraphs(state);
  if (!sel) return false;
  if (!dispatch) return true;
  const allQuoted = sel.paragraphs.every((p) => p.quoted);
  const tr = state.tr;
  const first = sel.paragraphs[0]!;
  const last = sel.paragraphs.at(-1)!;
  let from = first.pos + 1;
  let to = last.pos + last.node.nodeSize - 1;
  liftQuoted(tr, from, to);
  if (allQuoted) {
    // Undo the writable line quoting added: if the unquoted paragraph is now
    // followed only by an empty last line, that line goes (no text, and the
    // scene still ends in a paragraph).
    const $end = tr.doc.resolve(tr.mapping.map(to));
    const d = sceneDepth($end);
    const scene = d >= 0 ? $end.node(d) : null;
    const last = scene?.lastChild;
    if (scene && last && $end.depth === d + 1 && $end.index(d) === scene.childCount - 2 &&
        last.type === schema.nodes.paragraph && last.content.size === 0) {
      const sceneEnd = $end.end(d);
      tr.delete(sceneEnd - last.nodeSize, sceneEnd);
    }
  } else {
    from = tr.mapping.map(from);
    to = tr.mapping.map(to);
    // A scene always ends in a plain paragraph: keep a writable line after the quote.
    const $end = tr.doc.resolve(to);
    const scene = $end.node(sceneDepth($end));
    const sceneEnd = $end.end(sceneDepth($end));
    if ($end.after($end.depth) === sceneEnd && scene.lastChild === $end.parent) {
      tr.insert(sceneEnd, schema.nodes.paragraph!.create());
    }
    const range = tr.doc.resolve(from).blockRange(tr.doc.resolve(to));
    if (!range) return false;
    tr.wrap(range, [{ type: schema.nodes.quote! }]);
  }
  dispatch(tr.scrollIntoView());
  return true;
};
