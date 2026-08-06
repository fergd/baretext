# Baretext — Accessibility & Hit-Target Audit

Grounded in the real source (`fergd/baretext@main`): `src/index.html`, `src/features/sprint-timer.js`, `src/features/scene-nav/rail.js`. Findings are ordered by impact. Each lists **what**, **where**, **why it matters**, and **the fix**. A visual before/after of the worst offenders is in `A11y Fixes.dc.html` (project root).

---

## The one root cause behind most findings

**Interactive controls are `<span>` / `<div>` elements wired with `mousedown` handlers, not real buttons.** This single pattern appears in every feature:

- `sprint-timer.js` — `.sprint-pill` (minimize/pause/end), `.sprint-chip-opt` (durations), `.sprint-goal-step` (± steppers), `.sprint-chip-status` (footer chip).
- `rail.js` — `.rail-chapter-row`, `.rail-scene-row`, `.rail-edit-btn`, `.rail-delete-btn`, `.rail-drag-handle`, `.rail-scene-add`, `.rail-footer`, `.rail-corkboard-btn`.
- `index.html` — `#tw-status-indicator` (the `<span>` in the status bar).

Consequences, all at once: **not focusable** (no Tab stop), **not keyboard-operable** (Enter/Space do nothing — handlers listen for `mousedown`), **no role** for assistive tech (announced as plain text, if at all), and **no `:focus-visible` outline** because non-interactive elements don't take focus.

`mousedown` was almost certainly chosen to keep editor focus from blurring. Keep that behavior, but move to real elements:

**Fix pattern**
- Use `<button type="button">` for actions and toggles; keep icon-only ones labeled with `aria-label`.
- Preserve the no-blur trick with `el.addEventListener('mousedown', e => e.preventDefault())` (stops focus stealing) **and** bind the actual action to `click` — `click` fires for both mouse and keyboard (Enter/Space), so keyboard users are covered for free.
- Add one global focus style (see Focus section).

Everything below assumes this conversion; the remaining items are the specifics on top of it.

---

## P0 — Hit targets below a usable minimum

Target guidance: **44×44px** (Apple HIG / WCAG 2.5.5 AAA) is the goal for touch; even a mouse-only macOS app should hold **≥ 28–32px** and never ship sub-20px targets. Current measured heights (font + padding, no min-size anywhere):

| Control | Where | Current | Problem |
|---|---|---|---|
| `.sprint-goal-step` ▲▼ | sprint-timer.js | **~11px** tall, ~13px wide | Smallest target in the app — a 1px/2px-padded 9px glyph |
| `#save-error`… (not interactive — ok) | index.html | 6px | fine, decorative |
| `.sprint-pill` minimize/pause/end | sprint-timer.js | ~21px tall | primary sprint controls |
| `.rail-corkboard-btn` | rail.js | ~13px (bare icon) | no padding |
| `.rail-edit-btn / .rail-delete-btn / .rail-drag-handle` | rail.js | ~11–12px icon, **`opacity:0` until row hover** | see P0-hover below |
| `.rail-scene-row` | rail.js | ~27px tall | primary navigation |
| `.rail-chapter-row` | rail.js | ~30px | |
| `.fbtn` font buttons | index.html | ~28px | |
| `.sprint-chip-opt` durations | sprint-timer.js | ~28px | |
| `.pitem` palette rows | index.html | ~34px | closest to ok |
| `#tw-status-indicator` / `.sprint-chip-status` | index.html / sprint-timer.js | text-height in a 30px bar, no padding | ~16px clickable |

**Fixes**
- Give every control `min-height` (and `min-width` for icon-only) and enough padding to reach target. Where visual density must stay tight, **grow the hit area without growing the ink**: add symmetric padding and pull it back with negative margin, or overlay a transparent `::before { position:absolute; inset:-8px }` hit layer. This keeps the compact look while making the target real.
- Steppers: replace the stacked 9px chevrons with two `min-w/h:24px` buttons (or a single `<input type="number">` styled larger). On desktop 24–28px is acceptable for a paired micro-control; do not leave them at 11px.
- Status-bar chips (`tw-status-indicator`, sprint chip): add vertical padding and a hover/focus background so the whole chip is the target, not just the glyphs.

### P0-hover — controls that only exist on hover
`.rail-edit-btn`, `.rail-delete-btn`, and `.rail-drag-handle` are `opacity:0` until `.rail-*-row:hover`. That means: **keyboard users can never reach them** (no hover), **touch users can't reveal them**, and screen-reader users get controls that are effectively hidden. Rename, delete, and reorder are core scene-management actions — they cannot be hover-gated.
- **Fix:** keep them visually quiet by default (e.g. `text-dimmer`, reduced opacity like `.5`) but always present and always focusable; bring to full strength on row hover **and** on `:focus-within`. Ensure they're in the tab order.

---

## P0 — Color contrast (WCAG AA: 4.5:1 text, 3:1 large/UI)

`--text-dimmer` is used for **real, readable text**, not just decoration, and fails badly:

- Dark theme `--text-dimmer: #5a5040` on `--bg-alt #191919` ≈ **~2.0:1** — fails AA and even AAA-large.
- Used for: status-bar secondary items (`.status-item.dimmer` — char count, md-mode, file name), input placeholders, `.rail-chapter-num`, scene word counts (`.rail-dim`), palette footer hints (`.p-hint`), keycap text in some states.

**Fixes**
- Reserve `--text-dimmer` for genuinely non-essential decoration. For any text a user needs to read, use `--text-dim` (dark `#bdae93` on `#191919` ≈ passes) or lift `--text-dimmer` per theme until it clears 4.5:1 (or 3:1 if it's ≥18.66px/bold or a UI component).
- Audit all four current in-app themes (and the new Grove/Amstrad once adopted) — Light's `--text-dimmer #b0a898` on `#ede8de` is similarly weak.
- Selection contrast and accent-on-bg for section labels are fine; the issue is specifically the tertiary text token.

---

## P1 — Composite widgets need roles, state, and keyboard models

### Command palette (`index.html` + `app.js`)
Currently a plain `<div id="overlay">` / `<div id="palette">` with a bare `<input>` and `<div class="pitem">` rows.
- Wrap as `role="dialog"` `aria-modal="true"` with an `aria-label` ("Command palette").
- **Focus trap** while open; **restore focus** to the prior element on close. Confirm `Esc` closes (footer advertises it — verify it's wired) and that Tab doesn't escape to the editor behind.
- Make it a combobox/listbox: input `role="combobox"` `aria-expanded` `aria-controls="palette-list"` `aria-activedescendant`; list `role="listbox"`; each `.pitem` `role="option"` with `aria-selected` mirroring `.active`. Then ↑↓ selection is announced.
- The `.pitem` is `<div>`-with-handler today; inside a listbox the option role is fine, but ensure activation works from keyboard (Enter) — which the ↑↓/↵ model already implies; just add the ARIA.

### Scene rail (`rail.js`)
A collapsible chapter→scene tree operated entirely by mouse.
- Model it as `role="tree"`, chapter rows `role="treeitem"` `aria-expanded`, scene rows `role="treeitem"`, groups `role="group"`. Active scene gets `aria-current="true"` (mirrors `.active`).
- Add a **keyboard model**: ↑↓ move between rows, ←/→ collapse/expand chapters, Enter jumps to the scene, F2 rename, Delete arms delete. At minimum, make every row and its edit/delete/handle real buttons in tab order.
- **Drag-to-reorder is mouse-only** (HTML5 DnD via `.rail-drag-handle`). Provide a keyboard alternative — e.g. ⌥↑/⌥↓ to move the focused item, or "move up/move down" in the palette/context actions. Reordering the manuscript shouldn't require a mouse.
- Two-click delete confirm (`makeDeleteButton`) is a nice no-dialog pattern — keep it, but ensure the armed state is announced (`aria-live` or toggling the button's `aria-label` to "confirm delete <name>").

### Font picker (`index.html`)
Real `<button>`s (good). Add `role="radiogroup"` on `#font-picker` with an `aria-label`, and `aria-pressed`/`aria-checked` on `.fbtn` reflecting `.active`.

### Status bar
Give it a role/label (`role="status"` region or `aria-label="status"`). Icon-only/ambiguous items need text alternatives; `word-count`/`char-count` updates could be an `aria-live="polite"` region if you want them announced (optional — may be chatty).

---

## P1 — Focus visibility (global)

There is **no `:focus-visible` style anywhere**. Once controls become focusable, keyboard users still see nothing without this. Add one system-wide treatment:

```css
:where(button, [role="option"], [role="treeitem"], a, input, [tabindex]):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px; /* match control */
}
```

Use `:focus-visible` (not `:focus`) so mouse clicks don't show the ring but keyboard nav does. Ensure the ring has ≥3:1 contrast against the adjacent background in every theme (accent generally clears this; verify Light).

---

## P2 — Motion & reduced-motion

Lots of motion, no `prefers-reduced-motion` guard: the infinite `sprint-pulse` dot animation, palette spring transforms, font-picker/toast transitions, the 0.35s theme wash, and the theme-switch flash overlay (`app.js`).
- Wrap non-essential motion in `@media (prefers-reduced-motion: reduce)` and reduce to near-instant opacity changes; **stop the infinite pulse** entirely for these users (continuous animation is a vestibular/attention trigger).

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
}
```

---

## P2 — Accessible names for icon-only controls

Several controls convey meaning through a Tabler glyph plus a `title` attribute. `title` is an unreliable accessible name (not exposed consistently, invisible to touch). Add explicit `aria-label`:
- `.rail-corkboard-btn` → "Open corkboard"
- `.rail-edit-btn` → "Rename <chapter/scene>"
- `.rail-delete-btn` → "Delete <name>" (and "Confirm delete <name>" when armed)
- `.rail-drag-handle` → "Reorder <name>" (plus the keyboard move affordance above)
- `#tw-status-indicator` → "Toggle typewriter mode" + `aria-pressed`
- `.sprint-chip-status` → its current `title` text as `aria-label`; announce state changes politely.
- Decorative glyphs (e.g. `#palette-search-icon`, already `aria-hidden="true"` — good) stay hidden.

---

## Suggested order of work

1. **Convert controls to real buttons** + the `mousedown`-preventDefault/`click`-action pattern (unblocks focus, keyboard, and roles everywhere at once).
2. **Add the global `:focus-visible` ring** and `prefers-reduced-motion` guard (two small CSS blocks, immediate win).
3. **Fix hit targets** with `min-height`/hit-layer padding; **un-hover-gate** the rail action buttons.
4. **Lift `--text-dimmer`** (or reassign to `--text-dim`) so all four themes pass AA.
5. **Layer ARIA** onto the palette (dialog+listbox), rail (tree), and font picker (radiogroup); add the rail keyboard move + tree nav.

Items 1–4 are broad, mechanical, and low-risk. Item 5 is the deeper widget work; the palette and rail are the two to prioritize since they're the primary navigation surfaces.
