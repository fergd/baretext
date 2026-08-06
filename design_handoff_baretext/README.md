# Handoff: Baretext — Sprinter, Editor & Sprint Timer

## Overview
Baretext is a distraction-free markdown writing app for macOS (Electron). This handoff covers three things to build:
1. **Sprinter mode** — timed focus writing with a deliberately subtle, minimizable **sprint timer**.
2. **Editor mode** — full manuscript tools: find/replace, spellcheck, a collapsible chapter→scene rail, and a full-window corkboard.
3. **Typewriter mode** — a view toggle (works in either mode) that locks the active line to vertical center with focus dimming.

Plus the shared chrome that ties it together: a ⌘K command palette, a 30px status bar, glass floating surfaces, and a four-theme token system.

The guiding principle is **subtraction**: nothing should pull the writer's eye off the page. Chrome is thin, tools are summoned then dismissed, and the timer can be hidden to a single status-bar glyph.

## About the Design Files
The files in this bundle are **design references authored in HTML** — prototypes that show the intended look and behavior. They are **not production code to copy**. The task is to **recreate these designs in Baretext's existing codebase** (Electron + whatever renderer stack is in use — React assumed) using its established patterns, component library, and state management. Where Baretext already has primitives (buttons, the palette, status bar), extend those rather than reintroducing the HTML markup.

The `tokens/` CSS and `components/core/` React primitives in this bundle are close to production-usable and can be ported nearly as-is — treat them as the source of truth for values.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, shadows, and interactions are final. Recreate pixel-accurately. Every value in the Design Tokens section is authoritative.

---

## Design Tokens

All theme colors are semantic and keyed off the same names, so components are theme-agnostic. Set the active theme with `data-theme="dark|light|amstrad|grove|dracula"` on a root container (Electron: on the app root, driven by user setting).

### Colors — by theme
**See [`THEMES.md`](./THEMES.md) for the authoritative, up-to-date spec** — all five themes (Ember, Parchment, Amstrad, Grove, Dracula), the full token table including `--typewriter-focus`, cursor exceptions, and a build guide for the in-app Theme Picker. The color reference that used to live here has moved there to avoid drift.

### Derived tokens — CRITICAL cascade rule
These are composed from the theme colors above. They **must be declared on `:root, [data-theme]`** (i.e. re-declared on every themed container), NOT on `:root` alone. If declared only on `:root`, the nested `var(--bg-alt)` bakes in the dark default and every non-dark theme renders these dark. (This exact bug bit the prototype.)

```css
:root, [data-theme] {
  --glass-bg:           color-mix(in srgb, var(--bg-alt) 86%, transparent);
  --glass-border:       color-mix(in srgb, var(--border) 65%, transparent);
  --glass-highlight:    inset 0 1px 0 color-mix(in srgb, var(--text) 8%, transparent);
  --glass-edge:         color-mix(in srgb, var(--accent) 40%, transparent);
  --wash-accent:        color-mix(in srgb, var(--accent) 9%,  transparent);
  --wash-accent-strong: color-mix(in srgb, var(--accent) 15%, transparent);
  --stripe-accent:      inset 3px 0 0 var(--accent);
  --kbd-bg:             color-mix(in srgb, var(--bg) 55%, transparent);
  --kbd-border:         color-mix(in srgb, var(--border) 80%, transparent);
}
```
(If the target stack computes colors in JS instead of CSS custom properties, resolve these per-theme in the theme object — same result.)

### Typography
IBM Plex family. **UI chrome is always IBM Plex Mono.** Only the editor prose font is user-switchable between Mono / Serif / Sans.
- `--font-mono`: `'IBM Plex Mono','SF Mono','Menlo',monospace` (default editor + all chrome)
- `--font-serif`: `'IBM Plex Serif','Georgia',serif`
- `--font-sans`: `'IBM Plex Sans',-apple-system,sans-serif`

Scale (px): h1/chapter **26/700**, h2/date **16/700**, body **15/400 · line-height 1.9**, ui **13/400**, status **11**, section-label **10 · letter-spacing .12em · uppercase**. Timer digits **34/700 · letter-spacing 1px · tabular-nums**.

### Spacing
4px base ramp: 4, 8, 12, 16, 20, 24, 32, 48. Fixed: status bar **30px**, titlebar **44px**, prose measure **620px** (max column), scene rail **250px**.

### Radii
toast **5**, picker/item **6–8**, card **10**, panel **12**, palette **14**, keycap **4**.

### Shadows (elevation) — large, soft, pure black; no mid-tones
- window `0 40px 110px rgba(0,0,0,.55)`
- palette `0 28px 90px rgba(0,0,0,.55)`
- panel `0 22px 60px rgba(0,0,0,.50)`
- toast `0 16px 44px rgba(0,0,0,.50)`

### Glass recipe
`background: var(--glass-bg)` + `backdrop-filter: blur(22px) saturate(160%)` + 1px `--glass-border` + `box-shadow: <shadow>, var(--glass-highlight)`. Palette & sprint panel add a top accent edge: `border-top: 1px solid var(--glass-edge)`.

### Motion
- theme wash **0.35s ease** (deliberately slow)
- panel open/close **0.2s cubic-bezier(.16,1,.3,1)** (no overshoot)
- micro (hover/press) **0.08–0.12s ease**; button hover also `transform: scale(1.04)`

---

## Screens / Views

### 1. Sprinter — writing surface
- **Purpose:** distraction-free timed writing.
- **Layout:** column. 44px titlebar (traffic lights only) → flexible editor area (prose centered, max-width 620px, padding `20px 56px 40px`) → 30px status bar.
- **Status bar:** `bg-alt`, 1px top border, 11px. Left cluster `2064 words` (text-dim) · `10922 chars` · `preview` (text-dimmer). Right: filename `ch1.md` (text-dimmer).

### 2. Sprint timer — lifecycle (the centerpiece)
The timer is designed to be summoned then gotten out of the way. Four states:

**a) Evoke** — from ⌘K → "Start sprint". A glass panel (radius 12, accent edge) presents duration chips **15 / 25 / 45** (25 selected = solid accent, bg-colored text), a word goal row, and footer hints (`↵ start`, `esc cancel`).

**b) Active** — glass panel, bottom-center, width **340**, `padding 16px 18px`, offset **52px** above the status bar. Contents:
  - Header row: a 6px accent dot (pulses, `@keyframes pulse` opacity .35↔1 over 2s) + section label `sprint`; right side `minimize` and `end` ghost pills.
  - Time: **34px/700 tabular-nums** `mm:ss` + `remaining` (text-dimmer).
  - Progress: 3px track (`color-mix(--border 60%, transparent)`), accent fill at elapsed %.
  - Footer: `+180 words · goal 500` and a `⌘⇧M` keycap.

**c) Minimized (edge line)** — panel dismissed. Progress becomes a **2px accent line along the bottom edge** of the window (just above the status bar, with a soft accent glow), and the status bar shows a **runner glyph + "Sprinting"** chip (no numbers). This is the recommended default minimized state.

**d) Hidden** — no edge line, no numbers, no panel. **Only** the runner glyph + "Sprinting" in the status bar. For writers who want zero progress signal.

**Restore:** the "Sprinting" status-bar chip (runner + word) is **clickable** — clicking it brings the full active panel back up from either minimized or hidden state. `cursor: pointer`, title "show sprint timer".

**Complete:** a single terse glass toast, bottom-center, lowercase: `sprint complete · +342 words · 25:00`, then it clears. No sound, no modal.

Rule: the runner icon (`ti-run`) appears **only during an active sprint**. No sprint running → status bar is clean, no runner, no dot.

### 3. Editor — base
- **Purpose:** revision tools over the same surface.
- **Find/replace bar:** dismissible glass panel, top-right, width ~300, radius 10. Row 1: search field (`ti-search` + query) · match count `2 / 5` · up/down chevrons · `ti-x`. Row 2: replace field (`ti-replace`) · `one` · `all` (bordered ghost buttons). Matches highlighted in prose with `--sel`; the current match a stronger accent wash.
- **Spellcheck:** red wavy underline (`text-decoration: underline wavy #ff5555; text-underline-offset: 3px`).
- **Status bar** shows `source` (not preview) and a cyan **`editor`** mode label before the filename.

### 4. Editor — scene rail (chapter→scene hierarchy)
- **Left sidebar**, width **250**, `bg-alt`, 1px right border.
- Header: section label `manuscript` + count `3 ch · 9`.
- **Collapsible tree.** Chapter = disclosure row (chevron `ti-chevron-down`/`-right` + bold title + scene count). Scenes nest beneath, indented 16px with an 11px-padded left guide line (`1px` border in `--border`). Each scene row: name (left) + word count or `draft` (right, text-dimmer). Active scene: `--wash` (syntax-2 tint) background + `inset 2px 0 0 var(--syntax-2)` stripe. Draft/empty scenes: italic name, `opacity .7`.
- Footer: `+ new scene`.
- Prose measure narrows to **560px** when the rail is present.

### 5. Editor — corkboard (full-window)
- **Full window** below the titlebar (NOT a floating popup). Its own 42px toolbar: `ti-layout-grid` + `corkboard` label + `the strange woman · 9 scenes`; right side `esc back to writing`.
- Body scrolls, grouped into **chapter sections**: a chapter header row (chevron + uppercase chapter label in syntax-2 + subtitle + a hairline rule + `N scenes · N words`), then a **4-column grid** of scene cards indented 26px under it.
- **Scene card** (min-height 120, radius 10, `bg-alt`, 1px border): title (13/700) + 2-line synopsis (11/1.55, text-dim) + footer meta (`420 words` or `draft`). Active card: syntax-2 border + `0 0 0 3px` syntax-2 glow. Draft card: dimmed, italic synopsis. Last cell per chapter: dashed **`+ new scene`** tile.

### 6. Typewriter mode (view toggle, either mode)
- Toggled via ⌘K → "Typewriter mode" (**⌘⇧T**).
- The **active line locks to the vertical center**; the page scrolls up beneath it as you type (active line's baseline stays put).
- **Focus dimming:** the active sentence is full `--text`; sentences fade with distance — roughly `opacity .28` for the adjacent sentences, `.16` further out. (Implement as opacity on sentence spans / block ranges around the caret.)
- Prose line-height opens up to **2.1** in this mode.
- A **faint center guide** (1px, `rgba(syntax-2, .14)`) and a small uppercase `typewriter` marker sit on the center line; top/bottom of the editor area get a `--bg`→transparent gradient mask (≈22% tall each) so text fades at the edges.
- Status bar adds a `ti-align-left` + `typewriter` indicator.

### 7. Command palette (⌘K) — shared chrome
- Opens centered, ~34px from window top, width **560**, glass with accent edge, radius 14, max-height 440. Click-scrim behind closes it; Esc closes it.
- Search row: `ti-search` + `type a command...` placeholder (text-dimmer).
- **Grouped** with section labels: **file** (New file ⌘N, Open file ⌘O), **sprint** (Start sprint ⌘⇧S, Hide sprint timer ⌘⇧H), **view** (Typewriter mode ⌘⇧T, Change font ⌘⇧F), **mode** (Switch to Sprinter, Switch to Editor ⌘⇧D — active one shows a `ti-check`).
- **Command item:** `padding 8px 18px`, 13px. Icon (16px, text-dim; accent when active) + label (flex) + right-aligned keycaps or check. Active/hovered row: `--wash-accent` bg + `--stripe-accent` (inset 3px accent stripe — never a left border, never shifts the label).
- Footer hint row: `↑↓ navigate` · `↵ select` · `esc close`.
- **Keycap:** `--kbd-bg`, 1px `--kbd-border`, **2px bottom border** (the "lip"), radius 4, 10px text-dim.

---

## Interactions & Behavior
- **⌘K** toggles the palette anywhere. **Esc** closes palette / corkboard / (cancels the evoke panel).
- **Mode switching:** via the palette "mode" group (Switch to Sprinter / Editor ⌘⇧D); active shows a check. (Consider also a clickable mode label in the status bar — proposed, not yet designed.)
- **Sprint controls:** Start (⌘⇧S) → active panel. `minimize` → edge-line state. `end` → clears. `Hide sprint timer` (⌘⇧H) → hidden state. Click the "Sprinting" chip → restore active panel. On timer reaching 00:00 → completion toast, then clear.
- **Timer tick:** 1s interval, `mm:ss` countdown, progress = `(total-remaining)/total * 100`. Pause should freeze both (pause control shown in the fuller panel variant).
- **Corkboard:** open from palette/toolbar; cards drag-to-reorder within and across chapters (writes back to manuscript order); click a card → jump to that scene and close the board; `esc` returns.
- **Rail:** chapter rows expand/collapse; scene click sets the active scene.
- **Hover:** command items wash; buttons wash + `scale(1.04)`; all transitions per Motion tokens.
- **Font switch (⌘⇧F):** swaps only `--font-editor` (Mono/Serif/Sans); chrome stays Mono.
- **Theme switch:** re-set `data-theme`; the 0.35s wash animates the color change.

## State Management
Minimal global UI state (names illustrative):
- `theme: 'dark'|'light'|'amstrad'|'grove'|'dracula'`
- `mode: 'sprinter'|'editor'`
- `editorFont: 'mono'|'serif'|'sans'`
- `typewriter: boolean`
- `paletteOpen: boolean`
- `corkboardOpen: boolean` (editor only)
- `findOpen: boolean`
- `sprint: null | { totalSeconds, remaining, view: 'active'|'edge'|'hidden', paused, wordsAtStart, goal }` — `null` means no sprint; the runner glyph shows only when non-null.
- Manuscript data: chapters → scenes (id, title, synopsis, wordCount, status: `draft|written`, order) for rail + corkboard. Word/char counts derive from the active document.

Data fetching: documents load from the local filesystem (Electron main process); word/char counts and scene metadata are computed from file content. No network.

## Assets
- **Fonts:** IBM Plex Mono / Serif / Sans. Prototype loads from Google Fonts CDN — **self-host `@font-face` with bundled font binaries** for the offline Electron app.
- **Icons:** Tabler Icons. Prototype uses the webfont; prefer the tree-shakeable SVG package (`@tabler/icons-react` or equivalent) in the app. Icons used: `run` (the sprint signifier — reserve for that), `search`, `replace`, `x`, `chevron-up/down/right`, `eye-off`, `align-left`, `typography`, `file-plus`, `folder-open`, `layout-columns`, `layout-grid`, `check`, `plus`.
- No raster images in these screens.

## Files (design references in this bundle)
- `Sprinter Timer.dc.html` — the annotated options canvas: sprint-timer lifecycle (evoke/active/edge/hidden), evoke+complete, Editor base/rail/corkboard, and Typewriter mode. Read this for intended look per state.
- `Baretext App.dc.html` — the interactive click-through (switch themes/modes, open palette, run a sprint, minimize/hide/restore, corkboard). Read this for intended behavior and transitions.
- `styles.css` + `tokens/` — the authoritative token layer (colors ×4 themes, typography, spacing, effects). Port these values directly.
- `components/core/` — React primitives with `.d.ts` types and usage notes: Keycap, SectionLabel, Button, CommandItem, GlassPanel, Toast, StatusBar, SprintTimer. Near production-ready references.
- `guidelines/` — specimen cards for each foundation (open in a browser to see values in context).

> These `.dc.html` files are prototypes — open them in a browser to study them, but implement against Baretext's real component system.
