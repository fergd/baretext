# Baretext design system

A standalone extraction of Baretext's current visual language — color,
typography, spacing, radius, shadows, motion, and the informal component
patterns built on top of them — pulled out of the live app so it can be
developed on its own, independent of `src/`.

**Status: a stub, snapshotted from the shipping app at commit `72a86cf`
(2026-08-17).** Nothing in here is generated or synced automatically — it's
a one-time extraction, accurate as of that commit, meant as a real starting
point rather than a placeholder. Treat everything under `tokens/` as ground
truth for what Baretext actually looks like today; treat
`components/patterns.md` as a faithful description of patterns that exist in
the code but were never pulled out into reusable components.

## Why this exists

Baretext's design tokens have always lived embedded in the app itself —
mostly CSS custom properties in `src/index.html`'s `<style>` block, plus a
few in `src/editor/theme.js`. That's fine for the app but makes it hard to
iterate on the design system *as* a design system: no standalone place to
view the palette, no component inventory, no separation between "this is a
token" and "this is one component's specific implementation detail."

This directory is that separation. It doesn't replace the tokens living in
`src/` — the app doesn't consume anything from here today — it's a fork
point: a clean, current copy to design against, which someone (or some
future session) will eventually reconcile back into `src/` once the design
work here lands on something worth shipping.

## Structure

```
design-system/
├── CLAUDE.md               entry point / context for continuing design work here
├── README.md                this file
├── tokens/
│   ├── colors.css           5 themes' full palettes + derived/glass tokens
│   ├── typography.css       font stacks, @font-face, type scale, heading scale
│   ├── spacing.css          audit of current spacing usage + a proposed scale
│   ├── radius.css           the existing --radius-* scale + usage gaps
│   ├── shadows.css          elevation shadows + the glass-panel recipe
│   └── motion.css           easing/duration tokens + usage patterns
├── components/
│   └── patterns.md          narrative spec of current component patterns
│                             (buttons, list rows, cards, toasts, etc.) —
│                             no code yet, nothing here is a real reusable
│                             component in the app today
└── assets/
    └── fonts/                the actual IBM Plex .woff2 files, copied so
                              typography.css's @font-face rules resolve
                              standalone without reaching into src/
```

Each token file is a real, valid, self-contained CSS file — open any one of
them directly, or `@import` the whole `tokens/` directory into a scratch
page, and you get the live palette/scale, not a description of it.

## Provenance & honesty

Not everything here is an equally solid foundation:

- **colors, typography, radius, shadows, motion** are direct, verbatim
  extractions of real CSS custom properties already defined and used
  consistently in the app. High confidence — build on these as-is.
- **spacing** is NOT a real token system in the app today — there's no
  `--space-*` scale anywhere in `src/`. `tokens/spacing.css` is an honest
  audit of every padding/margin/gap value actually in use, bucketed by
  frequency, with a *proposed* scale based on that audit. Read its header
  comment before assuming any of it is load-bearing.
- **components/patterns.md** documents patterns, not components — there is
  no shared button/card/list-item implementation in the app; every feature
  module writes its own CSS that happens to follow these patterns. Building
  real reusable components from this spec is exactly the kind of work this
  directory exists to support.
- Each token file's header also calls out specific **known gaps** — real
  values used in the shipping app that never got promoted to a token (e.g.
  a hardcoded `#e05c5c` "danger" red used in two unrelated places instead of
  one shared token). Worth fixing as part of formalizing the system, not
  values to silently drop.

## How this relates to `design_handoff_baretext/`

The repo root also has a `design_handoff_baretext/` folder — a *previous*
design handoff that flowed the other direction (design → this app), with its
own `tokens/*.css`, `.dc.html` component references, and `CLAUDE.md`. That
folder's content is a proposed redesign that was **partially adopted, then a
larger follow-on attempt was fully reverted** (see `PROGRESS.md`'s
2026-08-16 entry). Its theme list already matches the live app (5 themes:
dark/light/amstrad/grove/dracula — no stale entries there), but its
`tokens/colors.css` still has the PRE-accessibility-fix `--text-dimmer`
value for the dark theme (`#5a5040`, ~2.0:1 contrast against `--bg-alt`,
fails WCAG AA) where the live app (and `tokens/colors.css` in *this*
directory) has the corrected `#968d78` (clears 4.5:1) — a real, verified
drift, not a hypothetical one. `docs/theme-spec.md` (a different file,
unrelated to that handoff folder) is separately even more stale — it still
documents a 4-theme system including a theme called "Ayu" that doesn't
exist anywhere in the current app. Don't treat either as current-state;
treat *this* directory as current-state, extracted directly from the
shipping app rather than from an intermediate design doc.

## Bringing changes back into the app

Nothing here is wired to `src/`. When a change made in this design system is
ready to ship:

1. The token files are meant to map 1:1 back onto `src/index.html`'s
   `:root`/`[data-theme]` blocks (colors, radius, shadows, motion,
   typography) — same custom-property names, same values, so porting a
   change is a copy, not a translation.
2. `src/editor/theme.js`'s `injectHeadingColors()` holds a second, separate
   copy of the `--h1`..`--h4` values per theme (not declared in
   `index.html` alongside the rest of each theme's palette) — update both
   if heading colors change.
3. Any new/renamed token needs updating everywhere it's consumed —
   `src/**/*.js`'s `injectStyle()` calls reference these by name throughout
   `src/features/` and `src/editor/`.
4. The app is vanilla JS/Electron, not React, despite what a generic
   handoff template might assume (see `design_handoff_baretext/CLAUDE.md`
   for the same mismatch on the inbound side) — any real component code
   built from `components/patterns.md` should follow the app's existing
   `injectStyle()` + hand-rolled-DOM (`el()`/`icon()`) conventions in
   `src/features/*.js`, not assume a component framework is available.
