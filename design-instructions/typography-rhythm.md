# Typography rhythm — refinement instructions

Scope: manuscript typography (titles, chapter headings, scene headings, body prose) — grounded in `Typography Rhythm.dc.html` and the design system's `typography.css`. Additive to whatever the manuscript surface already renders; doesn't replace markdown parsing or editor behavior.

## 1. Modular scale (fill the gaps the token file leaves open)

The design system only fixes three sizes: body 15px, the unified H2/H3 "scene heading" at 28px, and chapter H1 at 56px (Editor mode). Extend that same progression upward rather than inventing a new one:

| Role | Size / line-height |
|---|---|
| Kicker / eyebrow (mono, uppercase, .14em tracking) | 10px |
| Epigraph (italic) | 14px / 1.7 |
| Body | 15px / 1.9 (unchanged) |
| Scene heading (H2/H3, unified) | 28px / 1.1 (unchanged) |
| Chapter heading (H1) | 56px / 1.05 (unchanged) |
| Book/cover title | 84px / .98 |

Keep the existing mono-heading quirk exactly as tokened: every heading level drops to weight 400 whenever the editor font is mono (synthesized bold breaks fixed-width alignment); serif/sans keep their bold weights. The 84px title follows the same rule — don't give it a hardcoded bold that ignores `[data-font="mono"]`.

## 2. Asymmetric spacing around headings — not even gaps

**The rule:** a heading sits close to what it introduces and far from what precedes it. Don't space a heading equidistant between the block above and the block below — that reads as three disconnected chunks instead of a hierarchy.

- Gap *above* a heading (separating it from prior content): the large gap — roughly 2 baseline units (~57px at the 15px/1.9 rhythm, i.e. `rhythm × 2`).
- Gap *below* a heading, before its own content (chapter title → its first scene heading, or a scene heading → its first paragraph): tight — about 12px, well under one baseline unit. This applies chapter-to-scene exactly as it does heading-to-body.
- This is independent of whether an epigraph sits between a chapter title and the manuscript body — the epigraph itself follows the same asymmetry (tight above, from the title; roomier below, into the body it's separating from).

## 3. Chapter/scene numerals — tinted, not flat gray

Matches the rail: numerals are a translucent tint of their section's color, not `--text-dimmer`.
- Chapter numeral: `color-mix(in srgb, var(--accent) 55%, transparent)`.
- Scene numeral: `color-mix(in srgb, var(--scene) 55%, transparent)` when idle; full `var(--scene)` when it's the active/current scene.
- Applies wherever a numeral prefixes a title inline (title page, chapter opening, chapter→scene adjacency) — same tint logic as the rail's left-column numerals, not a separate scheme.

## 4. Small typographic craft details worth keeping

- Opening line of a scene may render its first few words in small caps (`font-variant: small-caps`, slight positive letter-spacing, weight 700) — a quiet literary convention, not a decoration to skip.
- Scene breaks (within a scene, not between chapter/scene headings) render as a centered, widely tracked `· · ·` in `--text-dimmer` — not a horizontal rule, not an icon.
- `text-wrap: pretty` on display-size headings (chapter title, book title) to avoid ragged/orphaned last words at that size.
