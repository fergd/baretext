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

## 2026-09-30 — Checkpoint (session handoff)
**Since the snapshots entry**
- Window size/position/zoom/full screen remembered; large centered default.
- Title bar: text and traffic lights centered on the bar (user-confirmed);
  breadcrumb keeps the writer's capitalization (only the book title in caps).
- On/off controls are switches (status bar: Typewriter, Focus; palette
  toggles). Palette rows are a grid so switches and shortcuts line up.
- Bug fix: turning typewriter off no longer moves the text or hides the
  caret; the fade eases out.

**State**
- Branch `rebuild`, everything committed. 107 unit, 54 end-to-end tests,
  all passing. Fuzzer clean at 30,000 cases.
- Run: `npm start`. Tests: `npx vitest run`, `npx playwright test`
  (build first: `npm run build`). Deep fuzz: `FC_RUNS=30000 npx vitest run
  packages/editor/test/fuzz.test.ts --testTimeout=600000`.
- Samples: `samples/test-file.md`, `samples/lorem-ipsum-120k.md`
  (regenerate: `python3 scripts/gen-lorem.py`). Work only inside this
  project; the user's real manuscripts are never used for testing.

**Working agreements (from this session)**
- User reviews by screenshot and feel; small, precise UI requests.
- Bug fix = failing test first; verify in the real hidden app; screenshots
  for anything visual; record decisions in DECISIONS.md.
- Commit only when asked; branch `rebuild`.

**Open**
- Deleting a snapshot from the History panel (store supports it).
- Find's Aa / ab are pressed-state buttons, not switches (user may want
  switches).
- Book title and breadcrumb sit close together (offered a wider gap or ·).
- Dictation not verified by a person.

**Next (proposed order)**
Outline peek/pin (⌘\) · Sprinter mode + sprint timer · corkboard ·
cold storage UI · notes · themes/fonts · export/print · integrations
(DECISIONS §7).

## 2026-09-30 — Outline (first pass)
- The outline opens as a column beside the page from a sidebar button in
  the title bar, ⌘\, View → Outline or the palette; remembered across
  launches; ⌥⌘\ moves focus into it. `app/renderer/outline-panel.ts`,
  `styles/outline.css`.
- A hover-to-peek version was built first and dropped at the user's
  request: opening should be a deliberate action.
- Content: book title and total, chapters (number, title, words; folded
  chapters show scene count), scenes (number, name, words), current scene
  marked. Keyboard tree: ↑/↓, ←/→ fold and move, Home/End, Enter/Space, Esc.
- No Figma design exists for the outline; this pass uses existing tokens
  and palette styling.
- Found while testing: ⌥⌘\ right after a jump focused the previous scene
  (the outline learned the current scene one frame late). Fixed; covered.
- Opening/closing animate (slide, page glide, row cascade); the button's
  icon morphs into a close icon while open. Reduced motion skips all of it.
- Measured on 120k words (174 rows): open ≤ 7.6 ms, close ≈ 1.4 ms (the
  layout change; the motion itself is transform-only).
- Tests: 108 unit, 61 end-to-end (7 outline tests). "Move to outline"
  stays out of the palette to keep it at ≤ 16 commands.

**Still open in §8.1 (outline)**
Inline rename (F2), add chapter / add scene in a chapter, copy, archive to
cold storage, delete (two-step), drag and ⌥↑/⌥↓ to reorder, Cold Storage
section, note counts, editable book title. Reordering and deleting need
new structural commands in `packages/editor` (with fuzzing).

## 2026-09-30 — Checkpoint (session handoff)
**Since the last checkpoint**
- Outline (first pass): a column beside the page, opened only deliberately
  (title-bar sidebar button, ⌘\, View → Outline, palette switch); ⌥⌘\
  moves focus into its keyboard tree. Remembered across launches.
- Hover-to-peek was built and dropped (user: opening must be deliberate).
- Open/close motion: column slides, page glides (FLIP), rows cascade;
  sidebar icon morphs to a close icon. Reduced motion: instant.

**State**
- Branch `rebuild`, everything committed. 108 unit, 61 end-to-end tests,
  all passing. Fuzzer last run clean at 30,000 cases (no editor changes
  since).
- Run: `npm start`. Tests: `npx vitest run`, `npx playwright test`
  (build first: `npm run build`). Deep fuzz: `FC_RUNS=30000 npx vitest run
  packages/editor/test/fuzz.test.ts --testTimeout=600000`.
- Throwaway screenshot specs must live in `test/e2e/` (module resolution
  fails from outside the project); delete them after use.

**Working agreements**
- User reviews by screenshot and feel; small, precise UI requests.
- Surfaces open by a deliberate action (button, shortcut, menu), never on
  hover. Hover is for tooltips only.
- Bug fix = failing test first; verify in the real hidden app; record
  decisions in DECISIONS.md. Commit only when asked; branch `rebuild`.

**Open**
- Outline §8.1 still to build: inline rename (F2), add chapter / scene in
  a chapter, copy, archive to cold storage, two-step delete, drag and
  ⌥↑/⌥↓ reorder, Cold Storage section, note counts, editable book title.
  Reorder/delete need new structural commands in `packages/editor` (fuzzed).
- Outline has no Figma design; visuals await the user's direction.
- Deleting a snapshot from the History panel (store supports it).
- Find's Aa / ab are pressed-state buttons, not switches.
- Book title and breadcrumb sit close together.
- Dictation not verified by a person.

**Next (proposed order)**
Outline editing (rename, add, delete, reorder, cold storage) · Sprinter
mode + sprint timer · corkboard · notes · themes/fonts · export/print ·
integrations (DECISIONS §7).

## 2026-09-30 — Outline: rename
- Inline rename in the outline: F2 / double-click a scene or chapter, click
  the book title. Enter or clicking away keeps it, Esc cancels, blank
  unnames a scene. One undo step each; the caret never moves.
- Model command `rename(id, name)` (`packages/editor/src/commands.ts`),
  7 unit tests, added to the fuzzer (clean at 30,000 cases).
- Found while testing: after Enter the row showed the old name for up to
  250ms (the outline waited for its refresh); clicking the book title moved
  focus off the manuscript. Both fixed and covered.
- Tests: 115 unit, 62 end-to-end.
- Next in the outline: add chapter / add scene in a chapter, then reorder,
  then two-step delete.

## 2026-09-30 — Outline: add chapter / scene
- + on a chapter row (hover or focus; ⌘↵ on the row) adds an empty scene
  at the end of that chapter and goes there. "New chapter" at the foot of
  the outline adds one at the end and opens its title field. Palette and
  Format menu entries. One undo step each.
- Model commands `addScene`, `addChapter` with 5 unit tests; both in the
  fuzzer (clean at 30,000 cases).
- The palette's no-selection length cap went from 16 to 17 for "New
  chapter" (the cap exists to catch Format rows leaking in).
- Tests: 120 unit, 64 end-to-end.
- Next in the outline: reorder (⌥↑/⌥↓, then drag), then two-step delete.

## 2026-09-30 — Outline: drag to reorder
- Drag scenes within or across chapters (or onto a chapter row to put it
  at the end), and drag whole chapters. Lifted row, accent drop line,
  edge auto-scroll, Esc cancels, rows glide into place. One undo per move.
- Model commands `moveScene`, `moveChapter` with 10 unit tests; in the
  fuzzer with a check that every scene survives word for word (clean at
  30,000 cases).
- A chapter's only scene can't leave it (format rule).
- Tests: 130 unit, 67 end-to-end.
- Open: keyboard reorder ⌥↑/⌥↓ (spec §8.1; uses the same commands);
  two-step delete.

## 2026-09-30 — Checkpoint (session handoff, tag `checkpoint-2026-09-30-outline`)
**Since the last checkpoint**
- Outline is now editable: rename (F2 / double-click / click the book
  title), add (+ on a chapter row or ⌘↵ on it; "New chapter" at the
  foot), and drag to reorder scenes and chapters. Each is one undo step.
- New model commands in `packages/editor/src/commands.ts`: `rename`,
  `addScene`, `addChapter`, `moveScene`, `moveChapter`, all fuzzed.
- The outline header (book title + word total) was removed and restored
  at the user's request: the column needs a top bar.

**State**
- Branch `rebuild` on github.com/fergd/baretext (origin), everything
  committed and pushed; tag `checkpoint-2026-09-30-outline` marks this
  point. 130 unit, 67 end-to-end tests, all passing. Fuzzer clean at
  30,000 cases.
- Run: `npm start`. Tests: `npx vitest run`, `npx playwright test`
  (build first: `npm run build`). Deep fuzz: `FC_RUNS=30000 npx vitest run
  packages/editor/test/fuzz.test.ts --testTimeout=600000`.
- Throwaway screenshot specs go in `test/e2e/zz-*.test.ts` and are deleted
  after use; wait for `document.getAnimations().length === 0` after
  opening the outline before measuring or dragging.

**Working agreements**
- User reviews by screenshot and feel; small, precise UI requests.
- Surfaces open by a deliberate action (button, shortcut, menu), never on
  hover. Hover is for tooltips only.
- Bug fix = failing test first; verify in the real hidden app; record
  decisions in DECISIONS.md. Commit/push only when asked; branch `rebuild`.
  PR to `main` deferred (unrelated histories: `rebuild` will replace it).

**Open**
- Outline: keyboard reorder ⌥↑/⌥↓ (spec §8.1; same move commands);
  two-step delete (snapshot first); copy scene; note counts.
- Cold Storage is a feature to build (format and editor groundwork only):
  park/restore commands, outline section, standalone scene view (§8.5).
- Outline has no Figma design; visuals follow the user's screenshots.
- Deleting a snapshot from the History panel; Find's Aa / ab are not
  switches; book title and breadcrumb sit close; dictation unverified.

**Next (proposed order)**
Outline: two-step delete · keyboard reorder · Cold Storage · Sprinter mode
+ sprint timer · corkboard · notes · themes/fonts · export/print ·
integrations (DECISIONS §7).

## 2026-10-01 — Outline width
- The outline column is 296px (was 248px; long names were cut off), and
  248px in windows narrower than 1,100px. Token `--outline-w`, breakpoint
  in `tokens.css`. Test added (68 end-to-end).

## 2026-10-01 — IBM Plex
- Interface in IBM Plex Sans Condensed, numbers in IBM Plex Mono, prose
  in the writer's choice of Plex Mono (default), Sans or Serif (Format →
  Prose Font, palette "Prose font…"); headings follow the prose.
  JetBrains Mono removed. Decisions in DECISIONS §9.
- Explored first in a font lab page (Baretext window mock-up with every
  candidate face, including Apple's): https://claude.ai/artifact/7akooNqHnKeEGbTuXEUW4K
- The title-bar optical offset went from 1px to 0 (the centering test
  caught the shift with the new face).
- Palette no-selection cap 17 → 18 for "Prose font…".
- Tests: 131 unit, 70 end-to-end.

## 2026-10-01 — Themes and Appearance
- Five themes: Dracula (default), Dark, Light, Grove, High Contrast (dark,
  WCAG AAA). Automated contrast test for every theme (AA; AAA for High
  Contrast); it lightened Dracula's dimmest text slightly. The old CRT
  theme was dropped.
- Appearance panel (Baretext → Settings…, ⌘,; palette "Appearance…"):
  theme, prose font, font size (14/15/17/19), paragraph spacing, prose
  width (Narrow 500px / Wide 660px), shown live in a sample of the
  writer's own scene; nothing changes until Save. Saved together; applied
  before first paint at launch.
- Tests: 273 unit (141 of them theme contrast), 74 end-to-end.

## 2026-10-01 — Quality pass
Read the whole codebase as one product; every bug fixed with a failing
test first.

**Bugs found and fixed**
- Find's Replace used match positions from before the writer's latest
  typing and overwrote the wrong characters (e.g. typed "Yes. " became
  "THE. "). Now re-searches first.
- A refused large deletion was a dead end: every save failed, and closing
  the window was blocked by an app-freezing alert. Now a notice offers Undo
  or a two-step Save anyway; failures of any kind stay visible with Try again.
- The destructive guard missed near-total deletions in short or many-scened
  books (structure kept the file large). Now also counts prose words.
- The last manuscript failing to reopen silently started a new document.
  Now explained.
- Shortcuts and menu commands reached the window behind Appearance and
  History (find, palette, focus mode, outline). Now held back.
- Opening another manuscript left the Appearance panel showing the old book.
- History: an unreadable version failed silently (preview and Restore); a
  double-click could restore twice.
- Selecting into Cold Storage collapsed the selection (internal Select All
  path only; the native ⌘A was unaffected).

**Investigated, not bugs**
- Overlapping saves can't write an older version last (each save writes the
  document as it is when it runs). No change.
- The intermittent focus-mode test: the test measured a word while the page
  was still settling. Test fixed (waits for stillness); 10/10 under load.

**Cleaner code**
- `index.ts` 769 → ~560 lines; `outline-panel.ts` 680 → 456 (drag moved to
  `outline-drag.ts`); new `saving.ts`, `palette-commands.ts`, `test-hooks.ts`.
- Appearance validation and defaults defined once (`validAppearance`,
  `DEFAULT_APPEARANCE`); main, settings and preload share them.
- Unused code removed; compiler now rejects unused locals/parameters.
- Remaining literal colors/sizes moved to tokens; a lint test enforces it.
- First unit tests for the save pipeline (`app/main/test/save.test.ts`).

**Measured**
- Fuzzer clean at 60,000 cases. 150k words: typing p95 5–6 ms with
  typewriter off/on, outline open, and serif/extra large/wide; save 66 ms.
- Tests: 294 unit, 83 end-to-end.

## 2026-10-01 — Checkpoint (session handoff)
**State**
- Branch `rebuild` on github.com/fergd/baretext. Quality pass and polish
  done, committed and pushed.
- Run: `npm start`. Tests: `npx vitest run`, `npx playwright test`
  (build first: `npm run build`). Benchmark: `npx playwright test --config
  playwright.bench.config.ts`. Deep fuzz: `FC_RUNS=60000 npx vitest run
  packages/editor/test/fuzz.test.ts --testTimeout=1200000`.
- Throwaway screenshot specs go in `test/e2e/zz-*.test.ts` and are deleted
  after use; wait for `document.getAnimations().length === 0` before
  measuring or dragging. Never leave a test app with a refused save open
  at close (it keeps the window open by design).

**Working agreements**
- Top-tier paid-app quality bar. User reviews by screenshot and feel.
- Surfaces open by a deliberate action, never on hover.
- Bug fix = failing test first; verify live; record decisions.
- Commit/push only when asked; PR to `main` deferred (unrelated histories).

**Next (proposed order)**
Outline: two-step delete (snapshot first) · keyboard reorder (⌥↑/⌥↓) ·
Cold Storage (park/restore, outline section, standalone view; mind the
word guard) · Sprinter mode + sprint timer · corkboard · notes ·
export/print · integrations (DECISIONS §7).

## 2026-10-01 — Polish
- Typewriter off: a visible fade back in (lines and guides), not a snap.
- Outline: the current-scene highlight glides between rows while reading
  back or moving; the list scrolls smoothly to it. (Also fixed: the
  "scroll the current scene into view" math was off by the header height.)
- Tests: 294 unit, 85 end-to-end.

## 2026-10-01 — Outline: delete
- Two-step delete for scenes and chapters (trash on hover/focus, ⌫ on a
  focused row): arm, then confirm; snapshot first; one ⌘Z; toast with
  word count. A chapter's last scene / the book's last chapter leaves an
  empty one.
- Model commands with 8 unit tests; fuzzed (clean at 30,000 cases).
- Tests: 302 unit, 89 end-to-end.

## 2026-10-01 — Cold Storage
- Move scenes to Cold Storage (row action, drag, palette, Format menu);
  restore to where they came from (remembered in the file) or by dragging;
  open a parked scene alone on the page to read and edit it; Esc returns
  exactly where you were. Outline section with counts; rename and two-step
  delete for parked scenes. Parked words never count, and never trip the
  save guard.
- Format: optional `origin` on parked scenes, stored as `origins` in the
  bookkeeping comment; fuzzed in the round-trip tests.
- Editor: one-document design (`cold.ts`): the open parked scene is the
  only editable part of Cold Storage; structure commands moved to
  `outline-commands.ts`. Fuzzer extended (park, restore, open, close,
  typing in the open scene): clean at 60,000 cases.
- Found by tests while building: opening put the caret in the scene's
  name; deleting the open parked scene did nothing. Both fixed.
- Benchmark unchanged (typing p95 5.5–7 ms on 150k words; save 55 ms).
- Tests: 321 unit, 95 end-to-end.
- Cold Storage: snowflake mark; a blue per theme for its heading areas
  and the open scene's page (contrast-tested). Tests: 326 unit, 95 e2e.

## 2026-10-01 — Keyboard reorder: built, then dropped
- ⌥↑/⌥↓ reorder was built, but after a click the caret is in the text,
  where ⌥↑/⌥↓ move by paragraph; the user chose to skip the feature.
  Removed (DECISIONS §15). Drag and drop remains the way to reorder.

## 2026-10-01 — Notes
- Margin notes beside their passages, a notes panel on the right (general
  notes, all notes in order, resolve/reopen/delete), ⇧⌘M to add, ⇧⌘N for
  the panel, toolbar button, outline counts. Stored in
  `<name>.notes.json`; anchors are invisible marks that follow the text.
- Editor anchors fuzzed (60,000 cases: they never change the manuscript).
- Found while building: new cards slid in from the page top (now appear in
  place); the test hook couldn't find text across formatting boundaries
  (now searches whole paragraphs).
- 150k words with 20 notes: typing p95 6.8 ms.
- Tests: 339 unit, 101 end-to-end.
- Notes fixes (user report): a resolved note left its passage highlighted
  but unclickable — resolving now removes the highlight, and the card's
  check mark became a "Resolve" button. Margin notes are put away with the
  panel open, in typewriter and focus mode (passages open the panel then).
- Writing a note (user report): the check showed while still writing.
  Notes are now written like a Google Docs comment — Cancel / Save, ↵
  saves, ⇧↵ new line, Esc cancels; Resolve appears only once saved; saved
  text is click-to-edit (`note-body.ts`, shared by margin and panel).
- Bug (user): Cancel on a margin note saved it. The page's click-to-place-
  caret handler took the mousedown, the text box blurred and saved before
  Cancel's click. Margin notes now keep their own clicks (test first).
- Shadows (user): inactive cards faded their shadow (card opacity) and the
  active card's was stronger. Now one shadow for every card; dimming
  applies to the contents only (test first).
- Notes panel motion matches the outline (slide, cascade, slide away,
  focus mode); shared `sidebar-motion.ts`.
- Hand-off motion between floating notes and the panel (fade out, then
  slide in; slide out, then fade in). Found while building: a note's
  marker in a narrow window opened the panel without the page making room
  (test first); the margin's "no room" check read a stale value mid-glide.
- Opening, the page leads and pulls the column in behind it, mirroring how
  it pushes it out on close. First tried as a 70ms delay; measured from the
  user's recording it was a pause then a lurch (~105px/frame), so the
  column now starts at once on a follow curve (`--ease-sidebar-follow`),
  peak ~71px/frame, settling with the page. Applies to both columns.
- Note highlights (user): the yellow wash read olive on dark themes, left
  seams at italics, and matched the selection on Dark/Light. Tried an
  underline; dropped (spell/grammar checking will need underlines). Now a
  reserved rose note color per theme, washed in OKLab (10% / 18% active),
  square-cornered; none in focus mode. Chosen from a rendered board of
  hues per theme; contrast-tested.
- Tests: 344 unit, 110 end-to-end.

## 2026-10-01 — Focus mode vignette
- The space around the manuscript dims toward the window edges in focus
  mode (sides, deeper in the corners, full height); never over the text or
  hanging numbers; none without room; per-theme depth (Light gentler, warm).
- Focus control (user): a "◎ Focus" button instead of a switch (it
  disappears with the chrome); a fading "Esc or ⌘. to leave focus" hint on
  entry.
- Focus mode text dissolves at the top and bottom edges (mask; caret kept
  clear). Bench: focus mode typing p95 7.1 ms. The bench's notes step used
  Esc (which now cancels a new note) and measured 0 cards — fixed (Enter).
- Tests: 344 unit, 112 end-to-end.

## 2026-10-01 — Chapter break (⌥⌘↵)
- ⇧⌘↵ pause / ⌘↵ scene / ⌥⌘↵ chapter. ⌥⌘↵ splits the chapter at the
  caret like ⌘↵ splits a scene (shared split code), caret in the new
  chapter's name. Format menu + palette. Unit tests (6), e2e, fuzzed
  (60,000 cases). Caught while sharing ⌘↵'s split code: the caret was
  resolved in the pre-split document (argument evaluated after `tr.doc`) —
  the existing ⌘↵ test failed; fixed.
- Tests: 350 unit, 113 end-to-end.

## 2026-10-01 — Export
- Word (standard manuscript format), Markdown and plain text from an
  Export panel (⇧⌘E); Cold Storage and notes optional; choices remembered.
  DECISIONS §18.
- Verified: unit tests for the book builder, Markdown/text renderers and
  the .docx (its XML: fonts, spacing, indents, page breaks, running head,
  comments); e2e for the panel, both save-dialog outcomes, relaunch memory.
  The 120k sample exported in all three formats; macOS's importer
  (`textutil`) reads the .docx cleanly (115,677 words). Quick Look is not
  page-accurate, so the layout is pinned by the XML tests; a copy is in
  `samples/lorem-ipsum-120k (export).docx` to open in Pages or Word.
- Palette test now checks "no Format group without a selection" instead of
  a row count (it broke each time a command was added).
- "Your name" → **Author**, with a live line showing where it appears in
  the Word manuscript; File → Export… moved beside Save.
- Tests: 364 unit, 116 end-to-end.

## 2026-10-01 — Title leading
- Chapter/scene title line height tightened (DECISIONS §19).
- Found by it: the margin didn't redraw when a Cold Storage scene opened or
  closed (only on text changes) — it had relied on a scroller resize the
  taller titles happened to cause. Now refreshed on that change; the
  existing notes e2e caught it.
- Bug (user, random, resizing didn't help): the status bar "went big" and
  the title bar vanished — the whole app had been scrolled up inside the
  window. html/body were `overflow: hidden` (code can still scroll that:
  scrollIntoView, focus) and the page row was `1fr` (min = content). Now
  html, body and the app are `overflow: clip`, the body contains what is
  positioned against it, and the row is `minmax(0, 1fr)`: nothing can
  displace the app. Test first (it reproduced the shift).
- Tests: 364 unit, 117 end-to-end.

## 2026-10-01 — Review before commit
- The main process validates the book from the window (`isExportBook`)
  before building anything — a malformed one is a clean error, never a
  crash. One helper for the notes an export carries; no throwaway runs in
  the Word builder; note ranges by map.
- Verified: typecheck; 365 unit; fuzz 30,000; 117 e2e; today's e2e ×3
  (81/81, no flakes); bench p95 5.5–6.8 ms on 150k words, save 55 ms.

## 2026-10-02 — Spine scene label: glass
User asked for an iOS-glass feel on the spine's hover label, only if free
for performance. The label now springs in from its tick (slight overshoot,
`--ease-glass`), glides between ticks instead of jumping, turns back if
re-hovered mid-fade, and fades out quickly. Surface: theme surface at 72%
with backdrop blur, hairline edge, lit top edge, soft shadow (tokens
`--color-glass-*`, `--shadow-glass`); Contrast and reduced-transparency stay
opaque. Only transform/opacity animate; hidden, it takes `visibility:
hidden`, so no glass layer exists while writing. Measured: hover sweep
p50 8.3 / p99 9.3 ms frames, zero long frames (identical to before); typing
bench unchanged. E2E: `spine.test.ts` "springs in… glides… fully gone".
The hovered tick also reaches out 12 → 16px (`scaleX`, `--tick-hover-scale`)
and takes the theme's accent, with the label's spring in and quick settle
out, so it is clear which tick the label names. Sweep frames unchanged.

## 2026-10-02 — Sprint setup and Sprinter mode (first pass)
Setup panel (⌘⇧S; `sprint-setup.ts`, `sprint.css`) per DECISIONS §21:
Time/Words, presets + custom, goal, rounds, break, summary line. Start
enters Sprinter (typewriter on, structure fades); ⌘⇧D or the palette's
"Back to Manuscript" leaves it. No timer yet: Start only enters the mode.
Tests: `test/e2e/sprint.test.ts` (4), unit `sprint-setup.test.ts`,
settings validation. Bench unchanged.

## 2026-10-02 — Sprints: a clean slate, kept or placed at the end
Per DECISIONS §21. `packages/editor/src/sprint.ts` (prose-only schema,
`placeSprint`), `app/main/sprints.ts` (storage, recovery, 30-day purge),
`app/renderer/sprint-page.ts` (the page: own editor + typewriter, saves as
it is written), `sprint-keep.ts` (the end panel). Typewriter CSS is now
scoped per surface (manuscript scroller vs sprint page). Bug found on the
way: a blank page could not be stored (a scene is never empty), so every
sprint start would have shown a save error; failing test first, fixed.
Tests: editor `sprint.test.ts` (7), main `sprints.test.ts` (5), E2E
`sprint.test.ts` (13). E2E selectors now use `[data-ref="scroller"]` (there
can be two scrollers). Bench unchanged.

## 2026-10-02 — Sprint timer line, rounds, breaks
`sprint-timer.ts` (WAAPI scaleX line, wall-clock end, pause/hide), session
logic in `index.ts` (rounds, breaks, words target). Sprinter now also turns
on focus mode. Bug found: closing the palette mid-sprint focused the hidden
manuscript, so typing went into the book invisibly; failing test first,
fixed (focus goes to the page being written on) plus the manuscript is
read-only during a sprint. E2E `sprint.test.ts` now 17. Bench unchanged.

## 2026-10-02 — Sprints library
`sprints-panel.ts` (History's parts; the frame CSS is shared by both
panels), `SprintStore.kept()` (opening words), the end panel made
request-based so the library reuses it, and one `placeInBook` for both
paths. E2E selectors for History are now scoped (two panels share its
parts). E2E 141, unit 385. (The review before commit `dcc2c13` also found
the timer running on behind the end panel; fixed there, failing test first.)

## 2026-10-02 — Sprints into any manuscript; three bugs
Book picker in the keep chooser (`app/main/books.ts`: list by title from
the file head via `peekTitle`, chapters by read-only parse; `books:*` IPC
limited to offered paths; `switchTo` now reports success). Library preview
keeps bold/italic; library ordered by start time (was: last update).
Bugs found and fixed, each failing test first:
- the launch check for an unfinished sprint could take over (and discard)
  a sprint started in its first moments;
- a document finishing loading moved the keyboard out of an open dialog,
  so ↵ went into the manuscript behind it (pre-existing; now only open
  dialogs keep focus, so a stale outline rename still gives way);
- the chooser's radio dot vanished on a focused row.
E2E 145 (twice, clean), unit 390.

## 2026-10-02 — Audit: cut, combine, standardize (DECISIONS §22)
Two data hazards found and fixed first (commit `b6330d5`). Then:
`Sprinter` out of `index.ts` (1,233 → ~1,000 lines); `Modal` base for the
seven covering panels (History gains the focus trap it lacked); `Arming` for
the four two-step confirmations (notes and the save notice now also disarm
on a press elsewhere or Esc, like the outline); `dom.ts` helpers;
`.bt-field`; shared palette items; dead `SpineTarget` removed. Oxlint
(type-aware) added as a gate and its 44 findings fixed — notably an
unhandled window-load failure and a `then`-named object (a latent thenable).
happy-dom added for DOM unit tests. Unit 400, E2E 147, lint clean.

## 2026-10-02 — Checkpoint (session handoff; supersedes the 2026-10-01 one)
**State**
- This folder (`~/Projects/baretext`) and `main` on github.com/fergd/baretext
  are the rebuild. `main` replaced the old app on 2026-10-01; `origin/rebuild`
  points at the same commit and is no longer worked on. The old app lives on
  `legacy` (its other branches are kept on GitHub). Earlier checkpoints that
  say "branch `rebuild`" or "PR to `main` deferred" predate this.
- Everything through Export is committed and pushed (`0bee04c`).
- Untracked leftovers from the old app (`dist/`, `src/`) are not part of the
  rebuild; leave them or delete them, never commit them.
- Run: `npm start`. Tests: `npx vitest run`, `npx playwright test`
  (build first: `npm run build`). Benchmark: `npx playwright test --config
  playwright.bench.config.ts`. Deep fuzz: `FC_RUNS=60000 npx vitest run
  packages/editor/test/fuzz.test.ts --testTimeout=1200000`.

**Working agreements** (unchanged)
- Top-tier paid-app quality bar. User reviews by screenshot and feel.
- Surfaces open by a deliberate action, never on hover.
- Bug fix = failing test first; verify live; record decisions.
- Commit/push only when asked; work on `main` (branch first for anything
  risky).

**Next (proposed order)**
Sprinter mode + sprint timer (Figma `2162:805` shows only the hidden
"Sprinting…" state; Setup / Active / Minimized / Complete need design
direction, and whether the goal counts net words added or words typed) ·
corkboard · print · integrations (DECISIONS §7).

## 2026-10-02 — Checkpoint (session handoff; supersedes the one above)
**State:** Manuscript and Sprinter are both complete through the Sprints
library and placing a sprint into any manuscript (DECISIONS §21); the code
audit's consolidation is in (§22). Gates: `npm run typecheck`, `npm run
lint`, `npx vitest run`, `npx playwright test` (build first).
**Open decisions:** break auto-start between rounds (provisional). (The
time sprint's word goal was cut.)
**Print:** ⌘P, standard manuscript format (DECISIONS §23); E2E prints to a
PDF (test switch `BARETEXT_PRINT_TO`). *Parked (user, low priority), known
gaps:* the macOS dialog has no preview, takes the printer's paper size (A4
here) over the layout's Letter, and doesn't know the page count. Planned
fix: build the PDF (Letter, exact) and show it in an in-app preview window
with Print / Save PDF.
**Gallery:** `npm run gallery` (DECISIONS §22); 34 states × 5 themes under
screenshot test — every panel, the outline, find, the selection toolbar,
notes (panel and margin), the save notice, toasts, the spine and the timer
line. Editor-bound parts sit on a real editor in each frame. It found a real bug on day one: two manuscripts with the
same title *and* file name were labelled identically (now: by folder too).
**Corkboard phase 1 built** (DECISIONS §24): view chips, the board and its
toolbar, rows/columns layouts, keyboard, opening scenes; E2E `corkboard.test.ts`, gallery (board, focused
card, chips), bench (open time).
**Next:** corkboard phase 2 — rename, add, delete (two-step), copy, as
toolbar actions on the focused card (DECISIONS §25) · phase 3 — reorder
scenes and chapters (drag, ⌥↑/⌥↓) · book setup · Mark as… and the story
arc · integrations (§7).
