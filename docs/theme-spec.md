# Baretext — Theme Spec

Minimal, flat, no gradients. Warm/analog color language (parchment, amber, ink) rather
than corporate blue. Everything keys off CSS custom properties so all 4 themes share one
set of components.

## Fonts

| Role | Stack |
|---|---|
| Editor (default) | `'IBM Plex Mono', 'SF Mono', 'Menlo', monospace` |
| Alt: serif | `'IBM Plex Serif', 'Georgia', serif` |
| Alt: sans | `'IBM Plex Sans', -apple-system, sans-serif` |

IBM Plex family only, weights 400 / 700, normal + italic. User can switch editor font
mono/serif/sans at runtime; UI chrome (status bar, palette, buttons) stays mono always.

## Color tokens (per theme)

Each theme defines: `bg`, `bg-alt` (panels/statusbar), `text`, `text-dim` (secondary),
`text-dimmer` (tertiary/placeholder), `accent`, `border`, `cursor` (= accent, usually),
`sel` (selection, accent at low alpha).

| Token | Dark | Light | Ayu | Dracula |
|---|---|---|---|---|
| bg | `#242424` | `#f5f0e8` | `#0f1419` | `#282a36` |
| bg-alt | `#191919` | `#ede8de` | `#0d1016` | `#21222c` |
| text | `#faf2d6` | `#2a2218` | `#e6e1cf` | `#f8f8f2` |
| text-dim | `#bdae93` | `#6b5f4a` | `#5c6773` | `#6272a4` |
| text-dimmer | `#5a5040` | `#b0a898` | `#2d3640` | `#44475a` |
| accent | `#f8c537` | `#b8820a` | `#f29718` | `#bd93f9` |
| border | `#3a3a3a` | `#d0c8b8` | `#1d2630` | `#44475a` |
| selection | `rgba(248,197,55,.22)` | `rgba(184,130,10,.20)` | `rgba(242,151,24,.20)` | `rgba(68,71,90,.70)` |

Dark is the "native" theme (warm amber-on-charcoal). Light is warm parchment, not
white/gray. Ayu is deep blue-black with amber accent. Dracula is the standard palette.
`cursor` = `accent` in every theme except Dracula, where it's `text`.

## Surfaces & elevation

Two levels only: `bg` (editor canvas) and `bg-alt` (status bar, panel backgrounds) — no
deeper elevation scale. Floating panels (command palette, font picker, toast) go further:
translucent glass over whatever is behind them, not a solid `bg-alt` card.

**Glass panel recipe** (command palette, font picker, toast):
- background: `color-mix(in srgb, var(--bg-alt) 82–90%, transparent)`
- `backdrop-filter: blur(16–28px) saturate(160%)`
- border: `color-mix(in srgb, var(--border) 60–70%, transparent)`, 1px
- shadow: large soft black shadow (`0 28px 90px rgba(0,0,0,.55)` for the big palette,
  smaller for toast/font-picker) + a 1px inset highlight line
  (`inset 0 1px 0 color-mix(in srgb, var(--text) 8%, transparent)`) + a thin accent-tinted
  top edge on the palette specifically
- radius: 14px (palette), 8px (font picker), 5px (toast)

## Component patterns

- **Buttons** (e.g. font picker): transparent bg, `text-dim` label. Hover = accent wash
  bg (`color-mix(accent 15%, transparent)`) + `text` color + `scale(1.04)`. Active/selected
  = solid `accent` bg with `bg` as the text color (inverted), bold.
- **List/command items**: no left border. Active/hover state is an *inset* box-shadow
  stripe, 3px, `accent` colored, plus a faint accent wash background — chosen so the label
  text never shifts position.
- **Section labels**: `accent` color, uppercase, 10px, `letter-spacing: .12em`, 70% opacity,
  bold-ish (600).
- **kbd / keycap badges**: `color-mix(bg 50–60%, transparent)` bg, 1px border in
  `color-mix(border, transparent)` but with a **2px bottom border** (keycap "lip" effect),
  radius 3–4px, 10–11px text.
- **Status bar**: `bg-alt`, 1px top border, 30px tall, 11px text, `letter-spacing: .03em`,
  secondary items dimmed further (`text-dimmer`).
- **Scrollbars**: 3–4px wide, thumb-only (no track), `text-dimmer` colored.

## Motion

- Theme/color changes: `0.35s ease` (deliberately slow — a "wash" not a snap).
- Panel open/close: opacity `0.16–0.22s ease` + transform on
  `cubic-bezier(0.16, 1, 0.3, 1)` (fast-out, no overshoot — feels crisp, not springy).
- Micro-interactions (hover, active): `0.08–0.12s ease`.
- Theme switch also does a full-viewport flash overlay (`bg` color, opacity 0→0.35→0,
  ~0.3s) to mask the repaint.

## Voice

No icons in prose, minimal chrome, everything text-first. Icon set where used: Tabler
Icons (outline style, `ti ti-*`). Toasts and labels are lowercase, terse ("theme: dark",
"focus mode on", "markdown hidden") — not sentence case, not exclamatory.
