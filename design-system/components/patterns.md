# Component patterns

Baretext has no reusable component library today — every panel/button/list
row is hand-written CSS inline in its owning feature module (`injectStyle()`
calls in `src/features/*.js` / `src/editor/*.js`), styled ad hoc against the
token files in `../tokens/`. Nothing here is a real, extractable component
yet; this is a **narrative spec of the patterns already in consistent use**
across those hand-written implementations, verified against the live app at
commit `72a86cf` (2026-08-17) — the starting point for turning them into
actual reusable components.

## Voice

No icons in prose, minimal chrome, text-first. Icon set where used: [Tabler
Icons](https://tabler.io/icons), outline style (`ti ti-*`), loaded from
`@tabler/icons-webfont`. Toasts and labels are lowercase, terse ("theme:
dark", "focus mode on", "markdown hidden") — not sentence case, not
exclamatory.

## Surfaces & elevation

Two background levels only — `--bg` (editor canvas) and `--bg-alt` (status
bar, rail, panel backgrounds) — no deeper solid-color elevation scale.
Floating panels (command palette, font picker, toast) go further: translucent
"glass" over whatever's behind them, not a solid `--bg-alt` card. See
`../tokens/shadows.css` for the exact glass recipe and shadow tokens, and
`../tokens/radius.css` for per-surface corner radii.

## Buttons

Two confirmed variants in the live app, both `all: unset` + rebuilt from
scratch (never native `<button>` chrome):

**Toggle/segmented** (font picker `.fbtn`, mode-switch `.mode-tab`):
- Default: transparent background, `--text-dim` label.
- Hover: accent wash background (`color-mix(in srgb, var(--accent) 15%,
  transparent)`) + `--text` color. The font picker additionally scales to
  `1.04` on hover and `0.97` on `:active` — the ONE place in the app that
  uses a hover transform; everything else changes color/background only.
- Active/selected: solid `--accent` background with `--bg` as the text color
  (inverted), font-weight 600. Never a border-only "selected" state.
- The mode-switch tab deliberately breaks from this: its active state is a
  quiet raised chip (`--bg` background, `--text` color, a small
  `0 1px 2px rgba(0,0,0,.25)` shadow) with NO accent fill — `--accent` is
  reserved for the writing surface itself (H1, cursor), never chrome. Keep
  this distinction if extracting a shared button component: "selected" in
  chrome vs. "selected" in a content-adjacent control (font picker) are
  different visual weights on purpose.

**Icon-only action button** (rail edit/delete, cold-storage back button):
- Hidden until row hover/focus (`opacity: 0` → `1` on `:hover`/
  `:focus-within` of the parent row) — except see "Accessibility" below.
- Real hit target padded out via a pseudo-element (`::before { content: '';
  position: absolute; inset: -6px; }`) rather than shrinking the visible
  icon — keeps a ~28px+ hit target on an 11-14px glyph.
- Hover: accent wash background + `--text` color, `.12s ease`.

## Two-click arm/confirm (destructive actions)

Every delete action in the app (scene, chapter) uses the same two-click
pattern instead of a native `confirm()` dialog:
1. First click: button shows "delete?", color shifts to `--danger`
   (`#e05c5c` — not yet a real token, see `../tokens/colors.css`'s "Known
   gaps"), font-weight 600, background `color-mix(in srgb, #e05c5c 15%,
   transparent)`.
2. Second click within the timeout: actually deletes.
3. No second click within the timeout: reverts to the normal icon-only
   state on its own.
4. Arming a second delete button anywhere on screen disarms the first —
   only one can ever be armed at once.

This is a deliberate, standing convention — never reach for a native
`confirm()`/`alert()` dialog in this app.

## List rows / menu items

Command-palette items (`.pitem`) are the canonical pattern:
- No `border-left`. Hover/active state is an **inset** `box-shadow` stripe
  (`inset 3px 0 0 var(--accent)`, = `--stripe-accent` in
  `../tokens/colors.css`) plus a faint accent-wash background — chosen
  specifically so the label text never shifts position when a row becomes
  active (a real border would eat into the row's padding and nudge text).
- Hover: `color-mix(in srgb, var(--accent) 8%, transparent)` background,
  no stripe.
- Active: `color-mix(in srgb, var(--accent) 12%, transparent)` background
  + the stripe.
- Row padding `8px 18px`, gap `10px`, transitions `0.08s ease` (the
  snappiest timing in the app — list rows need to feel instant).
- A leading icon (`.pitem-icon`, 15px, `--text-dim`) recolors to `--accent`
  on hover/active alongside the row.

Section labels above a group of rows (`.p-section`): `--accent` color,
uppercase, 10px, `letter-spacing: .12em`, 70% opacity, font-weight 600.

## Cards (corkboard scene cards)

`--bg-alt` background, 1px `--border`, `--radius-card` (10px), 13px padding,
120px min-height, `cursor: grab` (the whole card is draggable). States:
- Hover: border tints toward the theme's scene-marker color
  (`color-mix(in srgb, var(--syntax-2, var(--accent)) 50%, var(--border))`).
- Active (currently open in the editor): border = `--syntax-2`/`--accent`,
  plus a soft outer glow (`0 0 0 3px` at 12% opacity) — a ring, not a
  shadow, so it reads as "selected" rather than "elevated".
- Draft (near-empty scene): `opacity: .7`, title drops to `--text-dim`,
  synopsis becomes italic `--text-dimmer`.
- Dragging: `opacity: .35`.
- Valid drop target while dragging: `--accent` border + a slightly stronger
  glow ring (`0 0 0 2px` at 30%).

## kbd / keycap badges

`color-mix(in srgb, var(--bg) 55-60%, transparent)` background, 1px border
in `color-mix(in srgb, var(--border) 80%, transparent)` — but with a
**2px bottom border** specifically (a keycap "lip" effect, not a uniform
border), `--radius-kbd` (4px), 10-11px text, `--text-dim` color.

## Status bar

`--bg-alt` background, 1px top border, fixed 30px height, 3-column CSS grid
(`1fr auto 1fr`, not flex + space-between — this is what keeps the
mode-switch centered regardless of how wide the two side clusters are),
24px horizontal padding. Items are 11px `--font-mono`, `letter-spacing:
0.03em`, `--text-dim`; secondary items dim further to `--text-dimmer`
(`.status-item.dimmer`). A small 6px circular dot (`--danger`, `#e05c5c`)
appears next to the save status only on a write failure — otherwise hidden.

## Toasts

`--bg-alt` glass (see `../tokens/shadows.css`), bottom-center, 5px 14px
padding, `--radius-toast` (5px), 11px `--font-mono` `--text-dim` text,
`white-space: nowrap`. Enters with a combined opacity + translateY(8px→0) +
scale(0.96→1) transition — the only pattern in the app that combines all
three.

## Scrollbars

Thumb-only, no track (`background: transparent` on the track). 3-4px wide
depending on context (3px inside the command palette, 4px everywhere else),
`--radius-item`-scale rounding (2px), thumb colored `--text-dimmer` (or
`color-mix(in srgb, var(--accent) 30%, transparent)` inside the palette
specifically, to tie the scrollbar to the panel's own accent-tinted top
edge).

## Accessibility conventions

(Confirmed by `test/e2e/smoke.test.js`'s "accessibility pass" suite — keep
these true of anything built on top of this system.)
- Every interactive control is a real, focusable `<button>` — never a
  `span`/`div` with a `mousedown` handler standing in for one.
- Icon-only action buttons stay visible (not hover-gated) when reached by
  keyboard focus, even though they're hover-gated for a mouse.
- Chapter/scene rows are real ARIA tree items (`role="treeitem"` inside a
  `role="tree"`), ⌥↑/⌥↓ on a focused row reorders it as a keyboard
  alternative to drag-and-drop.
- The command palette is a real dialog + combobox + listbox
  (`aria-activedescendant` tracks the highlighted option), with a focus
  trap while open.
- A global `:focus-visible` ring and a `prefers-reduced-motion` rule are
  registered app-wide.
- Every icon-only control keeps a real ~28px+ hit target regardless of its
  visible glyph size (see "Icon-only action button" above).
