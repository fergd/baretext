# Handoff Addendum: Typewriter Mode

> This view was missed in the initial build. This spec is self-contained — it repeats the tokens it needs so it can be implemented without cross-referencing the main handoff. Reference design: `Sprinter Timer.dc.html`, option **4a** (`#4a`).

## What it is
A **view toggle** (not a mode) that works in both Sprinter and Editor. When on, the line you're writing is pinned to the **vertical center of the editor area** and the document scrolls up beneath it as you type — your eye never travels down the page. Everything except the sentence you're in fades back (focus dimming), so only the active words stay lit.

It composes with everything else: sprint timer, status bar, palette all behave normally on top of it.

## Toggle & state
- Toggled from the ⌘K palette → **"Typewriter mode"**, shortcut **⌘⇧T**. Also expose a direct shortcut binding.
- Global boolean UI state: `typewriter: boolean`. Persist it across sessions (user setting).
- Purely presentational — it changes scroll behavior, line-height, and per-sentence opacity. It does **not** alter the document, word counts, or caret model.

## Behavior

### 1. Active-line centering (the core)
- The **caret's line locks to the vertical center** of the editor viewport. As the user types or moves the caret, the document translates so the current line's baseline stays on the center axis.
- Implement by scrolling/translating the text block, not by moving the caret: after any caret change or input, compute the caret line's offset and set the editor scroll so that line sits at `50%` of the editor area's height. Animate the correction with a short ease (see Motion) so line-to-line jumps glide rather than snap; typing within a line needs no motion.
- The user can still scroll freely to read up/down; the next keystroke re-centers on the caret line.
- Applies to the editor prose area only — titlebar (44px) and status bar (30px) are outside it and don't move.

### 2. Focus dimming
- The **sentence containing the caret** renders at full `--text`.
- Sentences fade with distance from the active one:
  - active sentence → **opacity 1.0**
  - immediately adjacent sentences (one before / after) → **opacity ~0.28**
  - anything further → **opacity ~0.16**
- Unit is the **sentence**, not the line or paragraph. Split visible text into sentence ranges and set opacity per range relative to the caret's sentence. Wrap transitions in a subtle opacity ease so the lit region follows the caret smoothly.
- Dimming is independent of centering — it's the same "spotlight on the current sentence" whether or not the view is scrolled.

### 3. Line-height
- Prose line-height opens up to **2.1** in typewriter mode (normal editor prose is 1.9). This gives the centered line room and reinforces the calm, spaced feel.

### 4. Center guide + edge fade (added chrome)
- A **1px horizontal guide** across the full editor width on the center axis, color `color-mix(in srgb, var(--syntax-2) 14%, transparent)` (i.e. the theme's syntax-2 accent at ~14% alpha). Subtle — a hint of where the writing line rests, not a hard rule.
- A small uppercase marker **`typewriter`** sits on the left end of that center line: 10px, letter-spacing .14em, color `color-mix(in srgb, var(--syntax-2) 40%, transparent)`.
- **Edge fade masks:** the top and bottom of the editor area fade to `--bg` so text dissolves as it approaches the frame rather than clipping hard. Each mask is ≈22% of the editor height:
  ```
  background: linear-gradient(var(--bg) 0%, transparent 22%, transparent 78%, var(--bg) 100%);
  ```
  rendered as a non-interactive overlay above the text (`pointer-events: none`), below the caret/selection layer.

### 5. Status bar indicator
- While active, the status bar shows a `ti-align-left` icon (in `--syntax-2`) + the word `typewriter`, placed in the left cluster after the existing `words / chars / source·preview` items. Remove it when the toggle is off.

## Theming
All colors come from the active theme's tokens — no hard-coded values. Notably `--syntax-2` differs per theme (dark `#f8c537`, light `#b8820a`, ayu `#7dc45a`, dracula `#8be9fd`), so the center guide, marker, and status icon recolor automatically. The edge fade uses `--bg`, so it always matches the current surface.

## Motion
- Center re-alignment on line change: **~0.2s cubic-bezier(.16, 1, .3, 1)** (the panel ease — quick, no overshoot). No animation for intra-line typing.
- Focus-dimming opacity changes: short ease, **~0.12–0.2s**, so the lit sentence transitions rather than pops.
- Entering/leaving typewriter mode: cross-fade the dimming and slide the caret line to center over ~0.2s rather than jumping.

## Acceptance checklist
- [ ] ⌘⇧T and the palette item both toggle it; state persists across launches.
- [ ] Caret line stays on the vertical center axis while typing and on caret moves; smooth glide on line changes.
- [ ] Active sentence full-bright; neighbors ~0.28; distant ~0.16; spotlight follows the caret by sentence.
- [ ] Prose line-height is 2.1 while active.
- [ ] 1px syntax-2 center guide + `typewriter` marker visible on the center axis.
- [ ] Top/bottom edge fade to `--bg` (~22% each), non-interactive.
- [ ] Status bar shows the `ti-align-left` + `typewriter` indicator only while active.
- [ ] Works in both Sprinter and Editor, and correctly in all four themes.
- [ ] Turning it off restores normal scroll, 1.9 line-height, full opacity, and removes all added chrome.
