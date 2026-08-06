# CLAUDE.md — Baretext design handoff

You are implementing designs for **Baretext**, a macOS Electron writing app. This folder is a **design reference package** created in HTML — prototypes of the intended look and behavior, **not** production code to copy verbatim. Recreate these designs in this repo's existing stack (React/Electron) using its established patterns; port the CSS custom properties as-is, but rebuild the markup/components idiomatically.

## Read these first, in order
1. `README.md` — full design spec: all screens (Sprinter, Editor, Typewriter), layout measurements, components, interactions, state.
2. `THEMES.md` — **authoritative theme spec**: the 5 themes, every semantic token value, cursor exceptions, and a build guide for the in-app **Theme Picker** view.
3. `TYPEWRITER_MODE.md` — Typewriter mode spec (focus dimming, center guide, edge fades).
4. `ACCESSIBILITY.md` — **accessibility & hit-target audit** grounded in the current source, with the one root-cause fix (real buttons over span+mousedown), contrast, ARIA roles, focus, reduced-motion. Ordered by impact.
5. `MODE_SWITCHER.md` — the new **bottom-bar mode switcher** (centered Sprinter/Editor tabs).

### Visual references (in this folder, open in a browser)
`Mode Switcher.dc.html`, `A11y Fixes.dc.html` (before/after with a 44px hit-area + focus-ring overlay), and `Themes.dc.html`. These use a custom design-component runtime (`support.js`, included) — treat as visual references, not code to run in the app.

## The theme system (drop-in)
The design is fully tokenized. Port these two files as the styling foundation, then reference the tokens everywhere — never hard-code colors:
- `tokens/colors.css` — 5 themes (`dark`=Ember, `light`=Parchment, `amstrad`, `grove`, `dracula`), each a block of semantic custom properties keyed to `[data-theme="…"]`. `:root` = Ember (default).
- `tokens/effects.css` — radii, shadows, motion, and **derived** tokens (glass, washes, keycaps). ⚠ The derived tokens are declared on `:root, [data-theme]` on purpose — they must recompose per theme scope. Do NOT collapse them onto `:root` alone (that bug rendered every non-default theme dark).

Switch themes by setting `data-theme="<id>"` on the app root and persisting `theme` in settings. See THEMES.md → "Applying a theme".

Other token files (`fonts.css`, `typography.css`, `spacing.css`) and `styles.css` (the `@import` entry point) round out the system. `guidelines/*.html` are visual specimen cards for each token group — reference, not code.

## Tasks this handoff adds (in suggested order)
1. **Accessibility pass** (`ACCESSIBILITY.md`) — start with the root-cause fix: convert `<span>`/`<div>`+`mousedown` controls to real `<button>`s (preventDefault on mousedown to keep editor focus, action on `click`). This unblocks focus, keyboard, ARIA, and hit targets across every feature. Then the global `:focus-visible` ring + `prefers-reduced-motion`, hit-target min-sizes (un-hover-gate the rail action buttons), the `--text-dimmer` contrast lift, and ARIA for the palette (dialog+listbox) and scene rail (tree + keyboard reorder). Files touched: `src/index.html`, `src/features/sprint-timer.js`, `src/features/scene-nav/rail.js` (+ `corkboard.js`), `src/app.js`.
2. **Bottom-bar mode switcher** (`MODE_SWITCHER.md`) — turn `#statusbar` into a 3-column grid with a centered `role="tablist"` Sprinter/Editor switch; write `data-mode` on the app root (already read by `index.html`) and drive the existing mode registry (`src/modes.js`). Keep ⌘K in sync. Subtle styling — no accent fill on the active tab.
3. **Theme Picker view** (`THEMES.md`) — a scrollable grid of cards, each rendered in its own theme (`data-theme` wrapper), with a swatch row + live writing-surface specimen (incl. the Typewriter active line in `--typewriter-focus`); clicking a card applies + persists with the `--dur-theme` cross-fade. `Themes.dc.html` is the layout reference.
4. **Adopt the renamed/added themes** — the app currently ships `dark|light|ayu|dracula`; update to `dark(Ember)|light(Parchment)|amstrad|grove|dracula` per `tokens/colors.css`. Fix the theme guard list in `src/index.html` and `docs/theme-spec.md`.

## Rules
- Tokens are the source of truth for color/spacing/type — reference them, don't inline hex.
- Match measurements and copy exactly (README is precise).
- The bundled `.dc.html` files use a custom design-component runtime (`support.js`); treat them as visual references, not code to run in the app.
