# Baretext Design System

Distraction-free writing for Mac. Baretext is a native macOS writing app with
live markdown styling, a chapter/scene rail + corkboard, spellcheck,
find/replace, and a sprint timer for focused sessions. It has two modes:

- **Sprinter** — the minimal writing surface: markdown with live styling, no chrome.
- **Manuscript** — structured long-form: a chapter/scene rail, corkboard, and metadata.

Platform: **macOS (AppKit-era native)**, with a possible **web** port later — so this
system is expressed as platform-agnostic CSS custom properties + React component
recreations, not AppKit specifics.

> Sources: this system was reverse-built from the app's *Manuscript rail* component
> and the project README. No Figma or full codebase was attached; values were lifted
> from the working component and snapped to a 4px grid.

---

## Content fundamentals
- **Tone:** quiet, utilitarian, writerly. The UI never competes with the author's words.
- **Voice:** labels are terse and lowercase for actions ("add scene"), UPPERCASE mono
  for section overlines ("MANUSCRIPT").
- **Casing:** overlines are all-caps with wide tracking; titles are sentence case;
  user content (chapter/scene titles) is shown verbatim.
- **Numbers:** always tabular (mono, `font-variant-numeric: tabular-nums`). Chapter
  meta reads `scenes/words` (e.g. `6/4557`); scenes show a bare word count.
- **Emoji:** none. Status is shown as a word ("draft") or a glyph, never an emoji.
- **Vibe:** a terminal-adjacent, monospace writing tool — precise, calm, warm-accented.

## Visual foundations
- **Type:** JetBrains Mono is the primary UI + content face (the brand's monospace
  character). A macOS system sans (`--font-sans`) is reserved for future dense chrome.
  Size scale 11 / 12 / 13 / 14 / 16 / 20.
- **Color:** dark-first, cool-charcoal neutrals (`--bt-ink-0..4`) with a single warm
  **coral accent** (`--accent`). Accent is used sparingly — selection, active counts,
  the primary "add" action, the frost glyph is the only secondary hue (`--bt-info`).
- **Spacing:** strict **4px grid** (`--space-1`=4 … `--space-16`=64). Only `1px`/`2px`
  hairlines break the grid (`--space-hair`, `--space-2xs`), by design.
- **Elevation:** carried by **tonal surface steps** (ink-1 panel → ink-2 raised →
  ink-3 inset), not stacked shadows. The only real shadow is the floating rail
  (`--shadow-panel`). Borders are hairline `--border-subtle`.
- **Radius:** 4 / 8 / 12 / 16 / 20 + pill + round. Rows use `--radius-md` (12),
  the panel uses `--radius-xl` (20), icon buttons are round.
- **Selection:** a filled **tonal active-indicator** pill (`--selected-surface`,
  Material-3 secondary-container style) with the label in `--selected-text` — never a
  thin left bar.
- **State layers:** hover = `--bt-overlay-hover`; icon buttons get a circular
  `--bt-overlay-icon` layer inside a 40px hit target.
- **Motion:** `--ease-standard` for almost everything. Signature interaction: on row
  hover the word count cross-fades + slides out (`--motion-swap`, 220ms) while the
  edit/delete controls slide in.
- **Timeline connector:** a 2px vertical spine per chapter, breaking around each
  chevron (the chevron reads as a node). `--connector` at rest, `--connector-active`
  for the branch holding the selection.

## Iconography
- Line icons, ~1.7px stroke (`--icon-stroke`), round caps/joins, on a 24-viewBox.
  Sizes 16 / 20 / 24 (`--icon-*`). Chevron, pencil, trash, plus, grid, 6-dot grab
  handle, frost (3-line asterisk). No emoji, no filled icons.
- **No icon library is bundled yet.** Icons are inline SVG in the components. If a
  set is needed at scale, substitute Lucide (matching stroke weight) via CDN and
  flag it — do not hand-draw new glyphs.

## Index
- `styles.css` — global entry (import this).
- `tokens/` — colors, typography, spacing, radius, elevation, motion, icon, fonts.
- `guidelines/` — foundation specimen cards (Design System tab).
- `components/` — reusable primitives (row, header, icon button, disclosure, meta,
  text button, connector, selection pill).
- `ui_kits/manuscript/` — the manuscript rail, a full click-through screen.
- `SKILL.md` — portable Agent Skill wrapper.

## Caveats
- JetBrains Mono ships via Google Fonts CDN, not a bundled binary. Swap in the app's
  licensed `.woff2` files and I'll rewrite `tokens/fonts.css` with real `@font-face`.
- No logo/mark was provided — the wordmark "Baretext" is rendered in plain mono.
