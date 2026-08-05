import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// H1 uses the documented fixed size (--text-h1: 26px) — this was drifted in
// the old bundle (1.9em, relative to body size, never actually 26px at any
// body font-size). H2-H4 keep the original's relative em scale; the docs
// don't specify fixed values for those, so no invented redesign there.
export const highlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: 'var(--text-h1, 26px)', fontWeight: '700', color: 'var(--h1)', lineHeight: '1.3' },
  { tag: tags.heading2, fontSize: '1.55em', fontWeight: '700', color: 'var(--h2)', lineHeight: '1.35' },
  { tag: tags.heading3, fontSize: '1.28em', fontWeight: '600', color: 'var(--h3)' },
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
  { tag: tags.list, color: 'var(--accent)' },
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
