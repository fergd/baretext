# MODE_SWITCHER.md — Bottom-bar mode switcher

An architectural change: move mode switching (Sprinter ↔ Editor) out of being palette-only and into a **centered tab pair in the status bar**. Visual reference: `Mode Switcher.dc.html` (design project root).

## Why
Mode is the app's top-level state, but today it's only reachable via ⌘K. A persistent, visible switch makes the current mode obvious and one-click to change, without adding chrome elsewhere.

## Layout — status bar becomes a 3-column grid
Today `#statusbar` (`src/index.html`) is `display:flex; justify-content:space-between` with two `.status-group`s. Change it to a three-column grid so the switch is truly centered regardless of how wide the side clusters are:

```css
#statusbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  /* height 30px, bg-alt, 1px top border — unchanged */
}
/* left cluster: existing .status-group (word/char count, md-mode, sprint chip, tw-indicator) */
/* center: the new #mode-switch */
/* right cluster: existing .status-group (save-error, file-name) — add justify-self:end */
```

The left cluster's contents are already mode-dependent (the sprint chip belongs to Sprinter's feature set, spellcheck/md-mode to Editor) — that behavior stays; only the container changes.

## The switch itself
A `role="tablist"` of two real `<button role="tab">` elements — **not** spans (see ACCESSIBILITY.md; this is the pattern for the whole app going forward).

```
#mode-switch            role="tablist"  aria-label="Mode"
  button.mode-tab       role="tab"  aria-selected  data-mode="sprinter"   ⟨ti-run⟩ Sprinter
  button.mode-tab       role="tab"  aria-selected  data-mode="editor"     ⟨ti-edit⟩ Editor
```

Styling (from the mockup, in theme tokens) — **deliberately subtle; no accent fill.** This is a writing app, so the bar must never pull the eye from the page:
- Group: `background: color-mix(in srgb, var(--bg-alt) 60%, transparent)`, `border-radius: 8px`, `padding: 2px`, `gap: 2px`. (No border — the fill alone reads as a segmented control.)
- Tab: `min-height: 26px`, `padding: 0 14px`, `font-size: 12px`, `border-radius: 6px`, icon + label.
- **Inactive:** transparent bg, `--text-dimmer` (fully receded). **Active:** a quiet raised chip — `var(--bg)` bg + a soft `0 1px 2px rgba(0,0,0,.25)` shadow, `--text` color, `font-weight: 600`. The lift + full-strength text is enough to read as selected without any accent.
- Hover on inactive: lift to `--text-dim` (no background).
- **Never** fill the active tab with `--accent`; the accent belongs to the writing surface (H1, cursor), not the chrome.

## Behavior
- Clicking a tab switches mode: set `data-mode="<id>"` on the app root (the attribute `index.html` already reads on launch) and activate that mode's feature set via the existing mode registry (`src/modes.js`). Persist the choice.
- **Keyboard:** ← / → move selection within the tablist (roving tabindex — active tab `tabindex="0"`, other `-1`), Enter/Space activates. The whole group is one Tab stop.
- **⌘K still switches modes** — the palette command and the tabs are two entry points to the same action; keep both in sync (both read/write the same mode state).
- `aria-selected` mirrors the active tab; the switch reflects mode changes made via ⌘K too.

## Scope notes
- Only the two registered modes (`sprinter`, `editor`) are tabs. **Typewriter is NOT a peer mode** — it's a toggle *within* a mode (the existing `#tw-status-indicator` chip). Leave it where it is.
- Icons: `ti-run` (Sprinter), `ti-edit` (Editor). Confirm with the team if a text-only switch is preferred for minimalism; the mockup shows icon + label.
