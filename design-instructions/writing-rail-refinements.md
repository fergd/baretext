# Writing rail — refinement instructions

Scope: `Writing rail.dc.html` (the summoned-outline rail + status bar). Typewriter mode's *visual* design is out of scope here — it's already right — but its role as an independent control (see §3) needs to be preserved by whoever wires this up for real.

**These are additive changes only.** Nothing below replaces or simplifies what the corkboard already does — it only adds chapter-level grouping, the per-section add-scene affordance, draft flagging, and the hover-swap on rail rows. Every existing card/chapter behavior stays exactly as it is today, including:
- Per-card `AI SUMMARY` block, `suggest name` and `summary` actions, and the edit / open-in-editor / delete icon trio in each card's header.
- Drag-to-reorder on cards (and the "double-click to jump to this scene · drag to reorder" tooltip), plus the keyboard reorder path.
- Chapter header row's own `suggest name`, rename, and delete controls, and its drag-to-reorder.
- The corkboard's top bar: undo / redo / summarize all / esc-back-to-writing.

If anything in §1 below reads as ambiguous about one of these, the existing behavior wins — ask rather than drop it.

## 1. Corkboard shows the whole manuscript, not one chapter

**Problem:** corkboard currently renders only the scenes of whichever chapter is active. The real app's corkboard is a scrollable view of every chapter in the book.

**Spec:**
- Iterate every chapter (in manuscript order; Cold Storage excluded — it has its own entry point, see `cold-storage-view.js`).
- Each chapter is its own section: a header row (`CHAPTER {n} · {title}`, 10px uppercase, `--text-dimmer`, with scene count / word count trailing at the same size) followed by that chapter's scene grid.
- Empty chapters (no scenes yet) still render their header and an empty grid — don't hide them.
- Each chapter's grid ends with a dashed "+ new scene" card (same grid cell size as `SceneCard`, dashed `--border`, centered `+` and label, `--text-dimmer`) — this is a real affordance, not decoration.
- Section-to-section vertical gap should read clearly larger than the card-to-card gap within a section (roughly 2:1) so chapters stay visually distinct while scrolling.
- Use `SceneCard`'s `draft` prop for any scene under the draft word threshold (20 words, per `scene-nav/model.js`'s `DRAFT_WORD_THRESHOLD`) — don't invent a different threshold.

## 2. Scene-row hover: replace the metadata, don't stack next to it

**Problem:** hovering a scene row currently reveals archive/rename/delete icons *in addition to* the word count, all crammed into the row's trailing edge — on a long title this starts fighting for space immediately.

**Spec:**
- At rest: row shows title + word count (current behavior).
- On hover: the word count is replaced by the action icon cluster in the same trailing position — not added alongside it. Exactly one of {count, icons} is visible at a time.
- This applies uniformly to manuscript scene rows (both idle and active/highlighted state) and Cold Storage scene rows.
- Implement the swap as a genuine state-driven conditional (hovered vs. not), not an opacity trick layered on top of static content — the count shouldn't be present-but-invisible while hovering (keeps the DOM/AX tree honest about what's actually showing).

## 3. Typewriter is a control, not a mode — keep it structurally independent

This governs how the toggle is *wired*, not how it looks:

- Typewriter is a standalone boolean view-toggle. It must never be folded into the Sprinter/Editor mode switch, a menu that implies mutual exclusivity, or any single-select control — it composes with both modes simultaneously and independently of theme/font choice.
- Primary activation stays `⌘⇧T` + the command-palette entry ("Typewriter mode"), per `TYPEWRITER_MODE.md`. Whatever surfaces the toggle in chrome (status bar, menu, etc.) is a secondary affordance, not a replacement for the shortcut/palette path.
- The status bar element is a **state indicator that also happens to be clickable**, not the toggle's home — don't remove or gate the shortcut/palette path in favor of it.
- It's irrelevant to corkboard view (no active line to center there), so hide the *indicator* while corkboard is open — but don't clear the underlying state. Returning to the manuscript should resume centering immediately, exactly as it was left.

## 4. Cold Storage numerals match the rest of the rail

**Problem:** every scene elsewhere in the rail carries a left-aligned index numeral (tinted from its section's color, per the earlier chapter/scene numeral pass); Cold Storage scenes currently don't, so they look like a different kind of row rather than the same row type in a different bucket.

**Spec:** give Cold Storage scenes the same left numeral treatment (index within Cold Storage, same tint approach as manuscript scene numerals) so the row type reads identically everywhere it appears.
