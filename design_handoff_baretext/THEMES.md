# Baretext — Themes

Five themes, all keyed off the **same semantic token names** so every component is theme-agnostic. Switching themes = setting one attribute (`data-theme`) on the app root; every color recomposes from that scope. Source of truth: `tokens/colors.css` (+ derived tokens in `tokens/effects.css`). This file supersedes the color section of `README.md`.

| id (`data-theme`) | display name | one-liner |
|---|---|---|
| `dark` | **Ember** (native) | amber lamp on charcoal — the lamp-lit page at night |
| `light` | **Parchment** | warm parchment, never white — the bare page by day |
| `amstrad` | **Amstrad** | toned-down Amstrad CPC green-phosphor terminal |
| `grove` | **Grove** | Everforest Dark (Obsidian port), verbatim palette |
| `dracula` | **Dracula** | the standard Dracula palette |

> Ember and Parchment keep the canonical `dark` / `light` ids because they are the OS light/dark modes — the display name is a label only.

## Semantic tokens — full values

| token | Ember (`dark`) | Parchment (`light`) | Amstrad | Grove | Dracula |
|---|---|---|---|---|---|
| `--bg` (canvas) | `#242424` | `#f5f0e8` | `#0d130d` | `#2f383e` | `#282a36` |
| `--bg-alt` (status bar / panels) | `#191919` | `#ede8de` | `#0a0f0a` | `#272f34` | `#21222c` |
| `--text` | `#faf2d6` | `#2a2218` | `#c8e6b0` | `#d3c6aa` | `#f8f8f2` |
| `--text-dim` | `#bdae93` | `#6b5f4a` | `#5f7a55` | `#9aa79d` | `#6272a4` |
| `--text-dimmer` | `#5a5040` | `#b0a898` | `#2d3d29` | `#859289` | `#44475a` |
| `--accent` (H1 / active UI) | `#f8c537` | `#b8820a` | `#7dc45a` | `#a7c080` | `#bd93f9` |
| `--syntax-2` (dates / subheads) | `#f8c537` | `#b8820a` | `#7dc45a` | `#e69875` | `#8be9fd` |
| `--typewriter-focus` (active line) | `#fbe6a0` | `#1a1206` | `#b6e85a` | `#e0c583` | `#ffffff` |
| `--cursor` | `#f8c537` (accent) | `#b8820a` (accent) | `#7dc45a` (accent) | `#7fbbb3` ⚠ | `#f8f8f2` (text) ⚠ |
| `--sel` | `rgba(248,197,55,.22)` | `rgba(184,130,10,.20)` | `rgba(125,196,90,.18)` | `rgba(82,92,98,.55)` | `rgba(68,71,90,.70)` |
| `--border` | `#3a3a3a` | `#d0c8b8` | `#1c281a` | `#525c62` | `#44475a` |

### Cursor exceptions ⚠
Most themes set `--cursor: var(--accent)`. Two do not:
- **Grove** — cursor is Everforest's blue caret `#7fbbb3`, not the green accent.
- **Dracula** — cursor is `--text` `#f8f8f2`, per the canonical palette.

### `--typewriter-focus`
The color of the **active line under the caret** in Typewriter mode. It is each theme's `--text` *punched up* — same hue, more saturated / more vivid — so the active line stands proud of the dimmed surrounding prose (neighbors ~`.28` opacity, distant ~`.16`) without a jarring color jump. Deliberately kept short of neon to avoid eye fatigue.

## Derived tokens (in `effects.css`)
Declared on `:root, [data-theme]` so they **recompose per theme scope** — never hard-code them. Do not duplicate these per theme; the bare `[data-theme]` selector covers Grove, Amstrad, and any future theme automatically.

- `--glass-bg` `color-mix(in srgb, var(--bg-alt) 86%, transparent)`
- `--glass-border` `color-mix(in srgb, var(--border) 65%, transparent)`
- `--glass-highlight` `inset 0 1px 0 color-mix(in srgb, var(--text) 8%, transparent)`
- `--glass-edge` `color-mix(in srgb, var(--accent) 40%, transparent)`
- `--wash-accent` / `--wash-accent-strong` — `9%` / `15%` accent over transparent (item hover / active)
- `--stripe-accent` `inset 3px 0 0 var(--accent)` (active row stripe, no layout shift)
- `--kbd-bg` / `--kbd-border` — keycap fill/lip from `--bg` / `--border`
- Theme cross-fade: `--dur-theme: .35s` (deliberately slow wash on switch)

## Applying a theme
Set `data-theme` on the app root (Electron: the top-level app container or `document.body`). Persist the id in settings (`theme: 'dark'|'light'|'amstrad'|'grove'|'dracula'`). The `.35s` wash comes for free if `color`/`background` transitions are enabled on themed surfaces.

```js
document.documentElement.setAttribute('data-theme', themeId); // or app root
settings.set('theme', themeId);
```

---

# Building the Theme Picker view

Ship the swatch gallery (this design kit's view) as a real in-app screen so users can preview every theme against the actual writing surface before committing.

### Entry points
- **⌘K palette** → "Change theme…" opens the picker.
- **Settings → Appearance** hosts it inline.

### Shell
- Full-window view below the titlebar (or a large centered modal on `--shadow-window`). Background `--bg`, padding `40px`, vertically scrolls.
- Header row: title "Theme" + a dismiss affordance (`esc back to writing`, same pattern as the corkboard view).

### Grid
- CSS grid, `grid-template-columns: repeat(2, 1fr)` on desktop (1 column < 720px), `gap: 28px`.
- One **card per theme**, in the table order above.

### Card anatomy — render each card *in its own theme*
Wrap the whole card in `data-theme="<id>"` so all tokens inside resolve to that theme (same technique the design kit uses). Then:

1. **Header** (`--bg-alt`, 1px bottom `--border`): display name (`--text`, 15px/600) on the left, id (`--text-dim`, 11px) on the right. Add a **selected marker** (accent ring on the card + a check) when this theme is active.
2. **Swatch row**: the semantic palette as labeled chips, in order `bg · bg-alt · text · text-dim · text-dimmer · accent · syntax-2 · tw-focus · border`. Each chip = a 52px color block (1px `--border`) with the token name (`--text`, 10px) and hex (`--text-dim`, 9px) beneath.
3. **Live specimen** — a mini writing surface so the theme is judged in context, not just as swatches:
   - `Chapter 1` in `--accent` (700) + `January 22, 2026` in `--syntax-2` (700).
   - A body line in `--text` with a `--sel`-highlighted span and a 2px `--cursor` caret.
   - **A Typewriter active line** rendered in `--typewriter-focus` with the surrounding two lines dimmed to `opacity: .28` — this is the key differentiator users are choosing on.
   - Two chips showing `--wash-accent-strong` fill and the `--stripe-accent` active stripe.

### Interaction
- **Click a card** → apply the theme immediately to the app root (see "Applying a theme"), persist, and move the selected marker. Keep the picker open so users can keep comparing; the whole app (and picker chrome) cross-fades over `--dur-theme`.
- **Keyboard**: arrow keys move selection between cards, `Enter` applies the focused card, `Esc` closes.
- **State**: the picker reads the current `theme` id to show the selected marker; it writes on selection.

### Accessibility
- Grid is a `radiogroup`; each card is `role="radio"` with `aria-checked` and a visible focus ring (`--accent`). Names are real text (not color-only), and every swatch is labeled — don't rely on hue alone.

### Reference implementation
`Themes.dc.html` in the project root is the working visual reference for the card + grid layout and the specimen. Port its structure; swap its static theme data for the app's live `theme` state and wire the click/keyboard handlers above.
