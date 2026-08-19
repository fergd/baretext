# CLAUDE.md — Baretext design system

This folder is a **stub**, not a finished design system: a snapshot
extraction of Baretext's current visual language (color, typography,
spacing, radius, shadows, motion, plus documented-but-not-yet-componentized
patterns), pulled out of the shipping app at commit `72a86cf` (2026-08-17) so
it can be developed independently. The user will build and modify this
directly from here — treat it as a live workspace, not a reference to be
copied elsewhere.

Baretext itself is a vanilla JS/Electron writing app — **no React, no
component framework** — with its actual design tokens embedded in
`../src/index.html`'s `<style>` block and a few in `../src/editor/theme.js`.
This directory is a fork of that, not a replacement for it; nothing in
`../src/` reads from here today. See `README.md`'s "Bringing changes back
into the app" for how a change made here eventually flows back.

## Read these first, in order
1. `README.md` — structure, provenance, and what's solid vs. proposed.
2. `tokens/colors.css` — the 5 live themes (Ember/Parchment/Amstrad/
   Grove/Dracula) plus derived glass/wash tokens. Start here; color is the
   most complete, highest-confidence part of this extraction.
3. `tokens/typography.css`, `tokens/radius.css`, `tokens/shadows.css`,
   `tokens/motion.css` — each self-contained, each with a header explaining
   what's a real token vs. an audited-but-informal pattern.
4. `tokens/spacing.css` — read its header carefully before trusting
   anything in it: there is no real spacing scale in the app today, only an
   audit + a proposed one.
5. `components/patterns.md` — narrative spec of button/list/card/toast
   patterns as they actually exist in the code. No component code yet.

## What "continuing to develop this" means concretely

- Every file under `tokens/` is real, valid CSS — edit values in place, add
  new tokens, restructure freely. Each header comment states its own
  confidence level (verbatim extraction vs. proposed/audited); update or
  remove those notes as the file stops being a snapshot and starts being
  its own source of truth.
- `components/patterns.md` is the natural next thing to build FROM — turning
  its prose descriptions (buttons, list rows, cards, kbd badges, toasts,
  the two-click delete-arm pattern) into real, reusable component code
  (`components/*.css` and/or `.dc.html`-style visual references, matching
  the convention `../design_handoff_baretext/` already established for this
  repo) is likely the highest-value next step.
- Known gaps are called out explicitly in each token file (search for
  "Known gaps" / "Known deltas") — real values used in the shipping app that
  never got promoted to a token. Worth resolving as part of formalizing
  each token category, not silently dropping.
- `assets/fonts/` holds the actual IBM Plex `.woff2` files so
  `tokens/typography.css`'s `@font-face` rules resolve without reaching
  into `../src/`. If you add new fonts, add the files here too — don't
  point at a path that doesn't exist in this folder.

## Rules
- Tokens are the source of truth for color/spacing/type/radius/shadow/
  motion — new component work should reference them, not inline new hex
  values or magic numbers, even though (per `spacing.css`'s honest audit)
  the *current shipping app* doesn't yet hold itself to that standard
  everywhere.
- Don't assume a component framework when eventually porting anything back
  to `../src/` — that app is hand-rolled DOM (`el()`/`icon()` helpers in
  `../src/dom.js`) with `injectStyle()`-based CSS-in-JS, not React, despite
  what a generic design-tool template might assume.
- This folder and `../design_handoff_baretext/` are NOT the same thing and
  can drift out of sync with each other — `../design_handoff_baretext/` is
  an earlier, partially-reverted proposal that flowed design → app; this
  folder is a fresh extraction that flows app → design, current as of the
  commit noted above. See `README.md` for the full explanation.
