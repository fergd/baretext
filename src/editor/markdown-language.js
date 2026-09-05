import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// H1 uses the documented fixed size (--text-h1: 26px) — this was drifted in
// the old bundle (1.9em, relative to body size, never actually 26px at any
// body font-size). H2-H4 keep the original's relative em scale; the docs
// don't specify fixed values for those, so no invented redesign there.
// --text-h1/--ms-h2-*/--ms-h3-* are re-pointed by index.html's
// html[data-mode="editor"] #editor-host block (larger chapter/scene
// typography on the manuscript surface, Editor mode only — see
// MANUSCRIPT_SURFACE.md); Sprinter mode's defaults keep today's look.
// h2 AND h3 both get the manuscript surface's "scene heading" treatment —
// outline.js treats ## and ### as equally valid scene-level markers (a
// document might use either, or both), so a scene named with an h3 must
// look the same as one named with an h2, not fall back to the old,
// unrelated h3 style. Separate --ms-h3-* tokens (not just reusing --ms-h2-*
// directly) so Sprinter mode's own, still-distinct h2/h3 sizing is
// unaffected — only the editor-mode override below unifies them.
export const highlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: 'var(--text-h1, 26px)', fontWeight: 'var(--ms-h1-weight, 700)', color: 'var(--h1)', lineHeight: 'var(--ms-h1-lh, 1.3)' },
  { tag: tags.heading2, fontSize: 'var(--ms-h2-size, 1.55em)', fontWeight: 'var(--ms-h2-weight, 700)', color: 'var(--h2)', lineHeight: 'var(--ms-h2-lh, 1.35)' },
  { tag: tags.heading3, fontSize: 'var(--ms-h3-size, 1.28em)', fontWeight: 'var(--ms-h3-weight, 600)', color: 'var(--h3)', lineHeight: 'var(--ms-h3-lh, 1.4)' },
  { tag: tags.heading4, fontSize: '1.1em', fontWeight: '600', color: 'var(--h4)' },
  { tag: tags.heading5, fontWeight: '600' },
  { tag: tags.heading6, fontWeight: '600', color: 'var(--text-dim)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.9em' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--accent)' },
  { tag: tags.quote, color: 'var(--text-dim)', fontStyle: 'italic' },
  // List markers get their accent treatment from live-preview.js. Coloring
  // tags.list here colors the entire list subtree (including the author's
  // prose), which made lists read like raw Markdown instead of manuscript.
  { tag: tags.processingInstruction, color: 'var(--text-dimmer)' },
  { tag: tags.contentSeparator, color: 'var(--text-dimmer)' },
]);

export function markdownExtensions() {
  return [
    markdown({
      base: markdownLanguage,
      codeLanguages: [],
      // This app's "---" scene-break convention collides with CommonMark's
      // Setext heading syntax (any line immediately followed by "---", no
      // blank line between, is normally an H2 underline) — without this,
      // a paragraph right before a scene break silently becomes heading
      // text (wrong size/color) instead of prose. HorizontalRule parsing
      // (which "---" also matches) stays intact; scene-breaks.js's own
      // line-regex decorator doesn't depend on either classification anyway.
      extensions: [{ remove: ['SetextHeading'] }],
    }),
    syntaxHighlighting(highlightStyle, { fallback: true }),
  ];
}
