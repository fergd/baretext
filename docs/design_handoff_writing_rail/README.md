# Handoff: Writing Rail — Summoned Outline, Corkboard, Typography Rhythm

## Overview
Redesign of Baretext's Editor-mode scene rail: a hidden "spine" of tick marks at the window edge that peeks into a glass outline panel on hover and docks into a full column when pinned. Adds a whole-manuscript corkboard view, a Cold Storage archive section inside the outline, hover-swapped row actions, tinted chapter/scene numerals, and a refined type scale/rhythm for manuscript prose. Target: Baretext's existing Electron/vanilla-JS app (`src/`).

## About the Design Files
The files in `design_reference/` are **HTML/React design-component prototypes** built in a prototyping tool, not production code — they exist to show exact look, states, and interaction behavior. **Do not copy this markup or its React-ish templating into the app.** Baretext's real UI is hand-written vanilla JS/CSS. Recreate the same visual result and behavior using that stack: plain DOM, the app's existing CSS custom properties (see Design Tokens below — same names, same values, already defined in `design-system/tokens/*.css`), and the app's own event-handling conventions.

## Fidelity
**High-fidelity.** Colors, sizes, spacing, and copy below are exact — pull them directly rather than eyeballing the screenshots. Layout structure (flex/grid) and states are also exact. Two things are intentionally unspecified: full drag-and-drop reorder animation curves (use the app's existing drag affordances) and the precise typewriter scroll-lock mechanics (see §4, this is UI-only in the mocks).

## Screenshots
All in `screenshots/`, captured at the Dracula theme, Editor mode, mono editor font (`data-theme="dracula" data-mode="editor"`).
- `01-manuscript-collapsed.png` — default state: outline fully hidden, only the 2px tick spine shows at the canvas edge, typewriter mode on.
- `02-peek-glass.png` — hovering the tick spine: glass outline panel appears floating over the canvas (not pinned).
- `03-expanded-outline.png` — outline pinned/docked as a flush 320px column; Cold Storage section open at the bottom.
- `04-corkboard.png` — corkboard view: all chapters stacked with headers and scene-card grids.

---

## 1. Layout structure

Three-row shell inside the editor window: **toolbar (38px)** → **body (flex:1, row)** → **status bar (`--statusbar-h`, 30px)**.

### Toolbar (38px, `--bg-alt`, 1px bottom border `--border`)
Left to right, 14px horizontal padding, 14px gap:
- Traffic-light dots (macOS chrome, out of scope — app supplies its own window chrome)
- **Expand/collapse outline** icon button, 22×22px hit target — hidden entirely while corkboard is open
- **Corkboard toggle** icon button, 22×22px, always visible
- Document title, 11px uppercase mono, `.1em` tracking, `--text-dim`
- Chapter breadcrumb, 10px mono, `--text-dimmer` (e.g. "chapter 4 · meeting the father")
- Flexible spacer
- Search icon button, right-aligned, 22×22px

### Body (flex row, fills remaining height)
- **Outline column** (0px collapsed / 320px pinned, animated `width .22s var(--ease-panel)`, `overflow:hidden` on the wrapper so content doesn't reflow mid-transition)
- **Canvas** (flex:1, `position:relative`, `overflow:hidden`, holds tick spine, peek glass, manuscript prose OR corkboard grid, and the typewriter guide overlay)

### Status bar (grid `1fr auto 1fr`, 24px horizontal padding, `--bg-alt`, 1px top border)
- Left cell: word count (clickable → toggles typewriter) + typewriter indicator when on
- Center cell: Sprinter/Editor tab switch (`Button variant="tab"`) — **hidden while corkboard is open**
- Right cell: cloud icon + filename, right-aligned

---

## 2. The outline rail (three states)

### State A — Collapsed / tick spine (default)
A 40px-wide invisible hover target sits flush at the canvas's left edge (`position:absolute; left:0; top:0; bottom:0; width:40px`), centered content (`justify-content:center`), 14px left padding, 16px gap between chapter groups.

Each chapter renders as a vertical stack of **ticks**, one per scene (or `nTicks` if scenes aren't loaded), 5px gap between ticks within a chapter:
- Idle tick: `height:2px; width:11px; border-radius:1px; background:var(--text-dimmer)`
- Active/current-scene tick: `width:20px; background:var(--accent)`

Hovering anywhere in this 40px strip triggers State B.

### State B — Peek (glass, floats over canvas)
Appears at `left:44px; top:22px; width:296px`, `z-index:4`, glass surface:
```
border-radius: var(--radius-panel)      /* 12px */
border: 1px solid var(--glass-border)
background: var(--glass-bg)
backdrop-filter: blur(22px) saturate(160%)
box-shadow: 0 24px 60px rgba(0,0,0,.55), var(--glass-highlight)
animation: 0.2s var(--ease-panel), fade+translateX(-6px→0) on enter
```
Header row (32px, 1px bottom border in `--glass-border`): "OUTLINE" label (10px uppercase, `.12em` tracking, `--text-dimmer`) + an expand-outline icon button that pins it (→ State C).

Body: `max-height:520px; overflow:auto; padding:6px 0 8px` — same chapter/scene row markup as the pinned column (§2 State C) but **read-only preview**: no hover-action icons, no drag handles, no Cold Storage section, no add-scene footer. Shows chapters from the current chapter onward (not the whole book) — this is a *peek*, not the full outline.

Leaving the spine or the glass panel (mouseleave on either) reverts to State A. Clicking the expand icon inside it pins the outline (State C) and removes the glass panel and tick spine.

### State C — Pinned / docked column (320px)
Full-height `--bg-alt` column, 1px right border, three parts stacked in a column:

**1. Scrollable chapter/scene list** (`flex:1; overflow:auto; padding:6px 0 10px`)

Chapter row — 30px tall, `padding:0 10px 0 8px`, 8px gap, hover wash `var(--wash-accent)`:
- Chevron icon (`chevron-down` open / `chevron-right` closed), 14px, `--text-dimmer`
- Chapter numeral, 11px mono, tinted `color-mix(in srgb, var(--accent) 55%, transparent)`
- Title, 13px, `--text`, `flex:1`, ellipsis-truncated
- Count ("7/3256" = scenes/words), 10px, `--text-dimmer`

Scene row (nested under an open chapter) — 28px tall, `padding:0 6px 0 14px`, 6px gap:
- Idle: numeral 10px tinted `color-mix(in srgb, var(--scene) 55%, transparent)` · title 12px `--text-dim` · **at rest:** word count 10px `--text-dimmer`; **on hover:** word count is *replaced* (not joined) by 3 icon buttons at 20×20px — archive (→ cold storage), rename (pencil), delete (`DeleteButton`, arm-then-confirm per the design system's two-click delete pattern)
- Active/current scene: same shell, `background:var(--wash-accent-strong)`, `box-shadow:var(--stripe-accent)` (inset 3px left stripe, never a real border), numeral full `var(--scene)`, title `--text`, word count full `var(--accent)` — same hover icon-swap rule applies

Rows are `draggable`; dragging a scene onto a different chapter's drop zone (`onDragOver`/`onDrop` on the chapter's scene-list wrapper) reparents it. Chapter reorder/rename/delete controls are out of scope for this rail spec — preserve whatever the app already has.

**2. Cold Storage section** (`flex:none`, 1px top border, pinned to bottom of the column above the footer)
- Header row, 30px, clickable to toggle open/closed: chevron + snowflake icon (`--scene` color, 13px) + "cold storage" label (12px `--text-dim`) + trailing count "`n`/`words`" (10px `--text-dimmer`)
- When open: same scene-row markup as manuscript scenes (§ above), **including the same numeral tint and hover icon-swap** — but the hover icons are archive→**restore** (`corner-up-left`, "restore to manuscript"), rename, delete
- Drop target: dragging any manuscript scene onto the Cold Storage header archives it; dragging a cold scene back onto a chapter restores it

**3. Footer bar** (34px, 1px top border, `padding:0 10px`, 10px gap): "+ chapter" and "+ scene" text affordances (11px `--text-dim` → `--text` on hover) left-aligned, "⌘\\ collapses" hint (10px `--text-dimmer`) right-aligned.

---

## 3. Corkboard view

Toggled by the toolbar's grid-icon button (icon swaps `cards` ⇄ `file-text`, label swaps "corkboard" ⇄ "back to manuscript"). While corkboard is open: **the outline expand/collapse button, typewriter indicator, and the Sprinter/Editor status-bar tabs are all hidden** — corkboard replaces the manuscript surface, not just the canvas contents.

Renders the **entire manuscript**, one section per chapter, scrollable (`padding:32px`):
- Chapter header (14px gap above/below, baseline-aligned): "CHAPTER `{n}` · `{title}`" 10px uppercase `--text-dimmer`, trailing scene/word count same size
- Scene grid directly under it: CSS grid `repeat(auto-fill, minmax(200px,1fr))`, 14px gap
- Grid always ends with a **dashed "+ new scene" card**: same cell size as a real card (min-height 120px), `border:1px dashed var(--border)`, centered "+ new scene" label 12px `--text-dimmer`, hover → `border-color:var(--text-dim); color:var(--text-dim)`
- **40px gap between chapter sections** vs **14px gap between cards within a section** (~3:1, reads as clearly distinct groups)
- Empty chapters still render their header + an empty grid (just the add-scene card) — never hidden
- Scenes under the **draft threshold (20 words)** get the card's `draft` flag/visual treatment
- All existing `SceneCard` functionality is preserved as-is: AI summary, suggest-name, edit/open/delete, drag-to-reorder, ring-not-shadow selected state, chapter-level controls, undo/redo — this spec is **additive only** and must not simplify or remove any of that.

---

## 4. Typewriter mode

A **standalone boolean toggle**, structurally independent of the Sprinter/Editor mode switch — it must never be folded into that (or any other) single-select control; it composes with either mode.
- Primary activation: `⌘⇧T` + command-palette entry ("Typewriter mode"). The status-bar word-count area is a secondary, clickable *indicator* of state — not the toggle's home; don't remove the shortcut/palette path in its favor.
- Visual effect on manuscript prose: sentences dim by distance from the last one (`opacity` — full 1.0 for current, ~0.28 one back, ~0.16 further back), body line-height increases 1.9 → 2.1, and a 1px horizontal center-guide line appears at 50% canvas height with a small "typewriter" label (10px, tinted `color-mix(in srgb, var(--syntax-2) 40%, transparent)`) plus a top/bottom fade gradient (`linear-gradient(var(--bg) 0%, transparent 22%, transparent 78%, var(--bg) 100%)`).
- **This mock is UI-only** — no actual scroll-locking/re-centering is simulated. The real implementation needs to keep the active line pinned at the center guide as the writer types.
- Irrelevant to corkboard (no active line there): hide the *indicator* while corkboard is open, but do not clear the underlying boolean — returning to the manuscript must resume centering exactly as it was left.

---

## 5. Typography rhythm (manuscript prose)

Reference: `Typography Rhythm.dc.html`, screenshots not included (text-only spec, values are exact below).

### Modular scale
| Role | Size / line-height | Notes |
|---|---|---|
| Kicker/eyebrow | 10px, mono, uppercase, `.14em` tracking | |
| Epigraph | 14px / 1.7, italic | |
| Body | 15px / 1.9 | unchanged from existing token |
| Scene heading (H2/H3, unified) | 28px / 1.1 | unchanged |
| Chapter heading (H1) | 56px / 1.05 | unchanged |
| Book/cover title | 84px / 0.98 | new — top of the modular scale |

**Mono-heading quirk applies at every level including the 84px title:** when the editor font is mono, every heading weight drops to 400 (synthesized bold breaks fixed-width alignment); serif/sans keep bold (700).

### Asymmetric spacing (the core rule)
A heading sits **close to what it introduces, far from what precedes it** — never split evenly.
- Gap **above** a heading (from prior content): ~2 baseline units ≈ **57px** at the 15px/1.9 rhythm (`rhythm × 2`, where one rhythm unit ≈ 28.5px).
- Gap **below** a heading, before its own content (chapter title → its first scene heading, or scene heading → first paragraph): tight, **~12px**, well under one baseline unit. Applies uniformly to chapter→scene and heading→body.
- An epigraph between chapter title and body follows the same asymmetry: tight above (from the title), roomier below (into the body).

### Numeral tinting (shared with the rail)
- Chapter numeral: `color-mix(in srgb, var(--accent) 55%, transparent)`
- Scene numeral: `color-mix(in srgb, var(--scene) 55%, transparent)` idle → full `var(--scene)` when active/current
- Same rule wherever a numeral prefixes a title: title page, chapter opening, chapter→scene adjacency, and the rail's own numerals.

### Small craft details
- Scene's opening words may render in small caps: `font-variant: small-caps`, slight `+` letter-spacing, weight 700 (a few words only, not the whole first sentence).
- In-scene break (not a chapter/scene boundary): centered `· · ·`, widely tracked (`.6em`), `--text-dimmer`, generous vertical margin (~2 rhythm units) — never a `<hr>` or icon.
- `text-wrap: pretty` on display-size headings (chapter title, book title) to avoid orphaned last words.

---

## Interactions & Behavior summary
- Hover tick spine → peek glass (mouseenter/mouseleave, no click)
- Click expand icon (toolbar or peek header) → pin/unpin outline column, `.22s var(--ease-panel)` width transition
- Click corkboard icon → swap canvas content, hide expand/typewriter-indicator/mode-tabs
- Hover a scene/cold-storage row → count is *replaced* by 3 action icons (not layered) — implement as a real conditional render, not an opacity overlay, so the DOM/AX tree doesn't lie about what's showing
- Drag a scene row → drop on another chapter (reparents) or Cold Storage header (archives); drag a cold row → drop on a chapter (restores)
- Click Cold Storage header → toggle open/closed (chevron rotates `chevron-right` ⇄ `chevron-down`)
- Click word count in status bar, or `⌘⇧T`, or command palette → toggle typewriter (state persists across corkboard visits)

## State Management
- `pinned: boolean` — outline docked vs. collapsed
- `peek: boolean` — glass panel visible (only meaningful when `!pinned`)
- `cbView: boolean` — corkboard vs. manuscript canvas
- `typewriter: boolean` — persists independent of `cbView`
- `coldOpen: boolean` — Cold Storage section expanded
- `hoverId: string | null` — which single row currently shows action icons instead of its count
- Chapters: `{ n, title, open, scenes: [{ id, title, words, active }] }[]`
- Cold storage: `{ id, title, words }[]`
- Derived per scene: `draft = words < 20`, tick color/width from `active`

## Design Tokens
All from the app's existing token files (`design-system/tokens/`) — reuse verbatim, do not introduce new colors/sizes not listed below or in §5's modular scale.

**Dracula theme** (used in screenshots): `--bg:#282a36` `--bg-alt:#21222c` `--text:#f8f8f2` `--text-dim:#97a1bf` `--text-dimmer:#91929b` `--accent:#bd93f9` `--scene:#8be9fd` `--border:#44475a`

**Dark theme (Ember, app default)**: `--bg:#242424` `--bg-alt:#191919` `--text:#faf2d6` `--text-dim:#bdae93` `--text-dimmer:#968d78` `--accent:#f8c537` `--scene:#d98a3f` `--border:#3a3a3a`

Composited tokens (same formula in every theme, already defined in `colors.css`): `--glass-bg: color-mix(in srgb, var(--bg-alt) 86%, transparent)` · `--glass-border: color-mix(in srgb, var(--border) 65%, transparent)` · `--glass-highlight: inset 0 1px 0 color-mix(in srgb, var(--text) 8%, transparent)` · `--wash-accent: color-mix(in srgb, var(--accent) 9%, transparent)` · `--wash-accent-strong: color-mix(in srgb, var(--accent) 15%, transparent)` · `--stripe-accent: inset 3px 0 0 var(--accent)`.

**Radius**: panel 12px · card 10px · picker 8px · item 6px.
**Structural measures**: outline column pinned width 320px (peek glass 296px) · statusbar height 30px · toolbar height 38px · tick-spine hit width 40px.
**Motion**: panel transitions `.22s cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-panel`), never spring/overshoot. Hover washes ~0.1s ease, color/background only, never transform.
**Iconography**: Tabler Icons, outline style, class syntax (`ti ti-*`) — `chevron-down`/`chevron-right`, `archive`, `pencil`, `corner-up-left`, `snowflake`, `cards`/`file-text`, `layout-sidebar-left-expand`/`layout-sidebar-left-collapse`, `search`, `align-left`, `cloud`. Sizes: 12–16px in rows, 20–22px icon-button hit targets.

## Files
- `design_reference/Writing rail.dc.html` — full interactive prototype: toolbar, outline (all 3 states), corkboard, status bar, typewriter, drag/drop, hover-swap logic. Renders correctly only inside the prototyping tool (needs its `_ds` design-system bundle); read the source for exact structure and copy the CSS-in-JS values into your CSS.
- `design_reference/Typography Rhythm.dc.html` — type-scale and spacing specimen (§5).
- `design_reference/writing-rail-refinements.md` — the original prose spec this README is built from (rail + corkboard + typewriter + cold storage).
- `design_reference/typography-rhythm.md` — the original prose spec for §5.
- `screenshots/` — visual reference for every state described above.
