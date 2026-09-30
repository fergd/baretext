# Progress

## 2026-09-28 — Milestone 0 + core app

**Built**
- `packages/format`: manuscript model, serializer, parser (own files strict,
  imports lenient), round-trip verifier. File = readable Markdown with front
  matter title, `#` chapters, `##` named scenes, `---` unnamed-scene breaks,
  `* * *` section breaks, cold storage after a comment marker, and one
  trailing bookkeeping comment (ids, links).
- `packages/editor`: ProseMirror schema (the doc *is* the manuscript),
  structure guard (rejects any non-structural change to chapters/scenes or
  cold storage), structure-safe Enter/Backspace/Delete (all delete-type
  keys), cross-structure delete/type/paste/IME, ⌘↵ split scene, ⌘B/⌘I
  (word-processor toggling), `--` → em dash, paste flattening, line-break
  sanitizer, selection kept out of cold storage, margin-number and
  scene-boundary decorations.
- `app/main`: hidden-test launch, validated settings, save pipeline
  (verify → destructive guard → recovery copy ×100 → atomic write + fsync),
  reopen last file at last caret, New/Open/Open Recent, flush-before-close.
- `app/renderer`: Figma-matched manuscript (numbers hang left at 20% of the
  heading color, 24px rhythm), tick spine (click to navigate; collapses
  per chapter when too long, current chapter always expanded), typewriter
  (line-based fade mask, margin guides, FLIP line-advance motion), status
  bar, focus mode, navigation controller, gap-click caret placement.

**Verified**
- 44 unit/property tests; round trip 100k random manuscripts; editing
  fuzzer 250k random sequences (invariants checked every step; full undo
  restores the original).
- 7 E2E tests in the real hidden app with real key events.
- Benchmark (152,600 words): launch→editable 299 ms, keystroke processing
  p95 ≈ 5.5 ms (typewriter on/off, max 6.5 ms), save 52 ms.

**Not verified yet**
- On-screen paint latency in a visible window (hidden windows can't
  measure presentation reliably), traffic-light alignment, real IME and
  dictation, trackpad scrolling feel.

**Open design questions for the user**
- Book title styling (currently a small uppercase line — placeholder).
- Number for the first scene of a chapter when it is unnamed (none shown).
- Gap between a scene's prose and the next scene heading (64px, not in Figma).

**Next**
Selection toolbar · command palette · outline peek/pin · Sprinter + sprint
timer · point-in-time/daily snapshots · corkboard · cold storage UI ·
notes · find/replace · themes/fonts · export/print · integrations (§7 of
DECISIONS.md).

## 2026-09-28 — Import fix (user report: "my document didn't format")
- Cause: the new app shared the previous app's settings folder (same internal
  name), reopened the user's real manuscript, imported it as generic Markdown
  (lines joined into giant paragraphs, scene-name comments shown as text), and
  autosaved over it. Original intact in Recovery and the folder's git history.
- Fixed: legacy-format importer (verified on a scratch copy: 10 chapters,
  55 scenes, 1,731/1,731 paragraphs, 0 lines missing, exact round trip),
  imports saved as a copy beside the original, separate data folder, empty
  chapter-title placeholder no longer wraps.
- Tests: 50 unit, 8 E2E (new: legacy import leaves the original untouched).

## 2026-09-29 — Paragraphs (user report: "not formatting / no space after paragraphs")
- Cause: imported Markdown joined consecutive lines into one paragraph
  (standard Markdown), so files written one paragraph per line became walls
  of text. Now every line is its own paragraph.
- New setting: Format → Paragraph Spacing (Full / Half / None + indent),
  persisted, applied at launch.
- Restored the user's `Testing_the_Spirits_draft_2026-08-08.md` to the
  original (matches book-folder git commit 2177103); the broken version
  is kept in the old Recovery folder.
- Tests: 51 unit, 10 E2E (new: line-per-paragraph import; spacing menu,
  persistence, and launch).

## 2026-09-29 — Selection toolbar
- Linear-style popover: Bold, Italic, Link, Quote (Link's ⌘K later
  given to the command palette). Commands in
  `packages/editor/src/format.ts`, UI in `app/renderer/toolbar.ts`.
- Tests: 61 unit (new: mark/quote state, links, quote wrap/unwrap/structure
  safety; fuzzer now also runs quote/link/unlink — it caught a crash on a
  book-title selection, fixed), 15 E2E (new: mouse, keyboard, Esc, ⌘B,
  quote, ⌘K link flow, titles, scroll-away).
- Not verified: real trackpad feel and animation in a visible window.

## 2026-09-29 — Stopping point: pauses, motion, modes
**Built**
- Samples live in `samples/` (`test-file.md`, `lorem-ipsum-120k.md`,
  regenerate with `scripts/gen-lorem.py`); dev builds save new documents
  there, never in the previous app's `~/Documents/Baretext`.
- Pause (section break within a scene): ⌘⇧↵ / Format → Insert Pause; its
  own quiet ornament; numbered `6.4.1` at body size, renumbered live.
  Unnamed scene numbers (`6.4`) now at scene-title size. Imports: `* * *`
  → pause, `---` → scene break.
- Typewriter: stronger fade (40% → 12% → hidden at the window edges);
  scrolling eases the fade away and writing eases it back (animated
  registered properties, not an on/off switch).
- Tick spine: one gliding long-tick indicator; follows the scene being
  read while scrolling by hand, hands back to the caret on any edit or
  caret move; choosing a tick glides/fades the page (360ms, gentle ease).
- Focus mode hides the spine (fade, no hit-testing); Esc leaves focus mode,
  one layer at a time (open surfaces claim Esc by stopping propagation).
- Modes are **Manuscript** and **Sprinter**; every launch starts in
  Manuscript with typewriter and focus off (never saved).
- ⌘K reserved for the command palette.

**Fixed along the way**
- Toolbar race: a Shift+Arrow right after a click showed the toolbar
  without the keyboard pause (reproduced with a stress test first).
- Default save folder resolved to `build/main/samples` when launched the
  way tests launch (caught by a live check).
- Scrollbar clicks no longer go through gap-click caret placement.

**Verified**
- 69 unit tests (incl. 100k round trips, editing fuzzer with quote/link/
  pause), 24 E2E in the real hidden app; full E2E suite repeated green.
- 120k-word sample: launch→editable ~313 ms, keystroke p95 ≈ 5 ms,
  scroll-follow within two frames.

**Not verified yet**
- Feel in a visible window (user reports: sharp and responsive, typewriter
  and spine motion working well), real IME/dictation.

**Open**
- The app's settings still list the real manuscript and
  `~/Documents/Baretext/Untitled.md` (lastFile/recent); clear them while
  the app is quit.
- Spec text still says "Editor" and "typewriter persists" (DECISIONS.md
  overrides); offer to reword the spec.
- Unquoting a scene's last paragraph leaves the added empty line.

**Next**
Command palette (⌘K) · naming/renaming scenes · outline peek/pin ·
Sprinter + sprint timer · snapshots · corkboard · cold storage UI · notes ·
find/replace · themes/fonts · export/print · integrations (DECISIONS §7).

## 2026-09-29 — Command palette and scene naming
- Command palette (⌘K) with Go to chapter or scene (⌘⇧O): targeted command
  set, fast fuzzy search, measured open ≤ 2.1 ms and keystroke ≤ 0.9 ms on
  120k words. `app/renderer/palette.ts`, `app/renderer/fuzzy.ts`.
- Scene naming: click an unnamed scene's ornament, Format → Name Scene, or
  the palette (Name/Rename scene); empty names go away on Backspace or when
  left. Commands in `packages/editor/src/commands.ts`, drop rule in
  `packages/editor/src/naming.ts`.
- Fuzzer caught two naming bugs before they shipped (a larger deletion
  could drop a name; undo depended on timing) — both fixed.
- Tests: 81 unit, 31 E2E.
- Open: the first scene of a chapter has no ornament to click when unnamed
  (name it from the palette or menu).

## 2026-09-29 — Find & replace; where we're at
**Built**
- Find & replace (⌘F; ⌥⌘F or the chevron for Replace; ⌘G / ⇧⌘G; Edit
  menu and palette). Searches everything visible (prose, quotes, chapter
  titles, scene names), never cold storage; Match case / Whole word;
  straight and curly quotes match. Replacement keeps formatting; Replace
  All is one undo. Esc leaves the current match selected. Count sits inside
  the Find field; Find and Replace fields share one width.
  `packages/editor/src/find.ts`, `app/renderer/find.ts`.
- Measured on 120k words: ≤ 1.3 ms per keystroke; highlights limited to
  about a screen (≤ 600); counts cap at 10,000+.

**Fixed (found by the fuzzer, before reaching a file)**
- Typing over a selection that ended in an empty scene name removed it
  outside undo; a caret passing through an empty name that came from the
  file removed it. Now only a name just started with Name scene and left
  without typing is dropped, and only on a caret move. Regression tests
  added; fuzzer clean at 30,000 cases (twice) and 20,000 with Replace All.

**Tests:** 91 unit, 36 end-to-end.

### Where we're at
The Manuscript-mode writing surface is feature-complete for day-to-day
drafting and revising:
- **Writing:** structure-safe editing; bold/italic/quote/link via
  selection toolbar, shortcuts, menus and palette; scene breaks (⌘↵),
  pauses (⌘⇧↵); scene naming/renaming; paragraph spacing setting.
- **Moving around:** tick spine (gliding indicator, follows reading,
  jump motion), command palette (⌘K), Go to chapter or scene (⌘⇧O),
  find & replace (⌘F).
- **Focus:** typewriter mode (line-based fade that eases away while
  reading back), focus mode (hides chrome and spine; Esc exits). Every
  launch starts in Manuscript mode with both off.
- **Safety:** verified atomic saves with recovery copies; imports never
  rewrite originals; development documents live in `samples/`.

**Still open** — sorted the same day:
- ✓ Settings no longer list the real manuscript or `~/Documents/Baretext`
  (backup kept). The `(Baretext)` copy in the book folder was left alone.
- ✓ Spec now says Manuscript / per-session modes (§2.1, §2.2, §6, §14.1).
- ✓ Unquoting a scene's last paragraph removes the line quoting added.
- ✓ An unnamed first scene shows `1.1` beside its first line; click it to
  name the scene.
- ✓ IME composition tested end to end (4 tests). Dictation and trackpad
  feel remain a person's check (trackpad feel reported good).

**Next (proposed order)**
Snapshots (see and restore earlier versions) · outline peek/pin (⌘\) ·
Sprinter mode + sprint timer · corkboard · cold storage UI · notes ·
themes/fonts · export/print · integrations (DECISIONS §7).

## 2026-09-29 — Snapshots and History
- Local snapshots (Daily, Autosave every 15 min, Opened, before Replace All
  and before restore, manual with a label) in the app's data folder,
  deduplicated, pruned (10 points, 30 days of dailies, manual kept).
- History panel (File → History…, palette): list, read-only preview,
  change vs now, one-click restore (one ⌘Z; current version kept first).
- Palette: Paragraph spacing folded into one command with a choices view.
- Tests: 102 unit, 46 end-to-end.
- Not yet: deleting a manual snapshot from the panel (the store supports
  it); a snapshot before big structural deletes (no such command yet).
