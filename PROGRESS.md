# Baretext — progress log

A running record of what's been built, in what order, and what's still open.
Read this at the start of a new session to pick up where things left off —
it's context, not a spec; the code and `git log` are the source of truth for
exact behavior.

Also see: `README.md` (how to run/build/test, feature overview),
`docs/two-mode-architecture-plan.md` (the Sprinter/Editor mode split),
`docs/theme-spec.md` (design tokens), `TYPEWRITER_MODE.md` (typewriter
focus-mode spec).

## Where things stand (as of 2026-08-05)

Both Sprinter and Editor mode are feature-complete against the original
design handoff. Latest work: two quick fixes on top of commit `e8e141a` —
⌘↵ as a scene-break shortcut, and a pause button for the sprint timer (not
yet committed — see below). Full test suite: 83 unit + 42 E2E, all passing.
Nothing is mid-flight or half-implemented right now — the next session
starts from a clean slate unless new requests come in.

## How this app is organized

- **Two modes**, `sprinter` and `editor`, registered in `src/modes.js`.
  Sprinter is the minimal writing surface (editor + typewriter mode + sprint
  timer). Editor adds the chapter/scene rail, corkboard, find/replace, and
  spellcheck.
- **Feature modules** in `src/features/*.js`, each self-contained
  (`init`/`destroy`/`commandGroups`/`keybindings`), mounted/unmounted by
  `src/app.js`'s `activateMode()` when the mode switches.
- **Editor engine** in `src/editor/` (CodeMirror 6), compiled to
  `src/editor-bundle.js` via `npm run build:editor`. This is the only part
  of the app that needs a build step — everything else is loaded live as ES
  modules.
- Full architecture rundown is in `README.md`'s Architecture section.

## Build history (chronological, oldest first)

1. **Initial commit** — starting point, a single-file inline-script app.
2. **Two-mode architecture + Sprint Timer + typewriter visuals** — extracted
   the inline script into `src/app.js` + `src/features/` + `src/modes.js`;
   added the Sprinter/Editor mode split, the sprint timer feature, and
   typewriter mode's focus-dimming/centering.
3. **Made Typewriter and Sprint permanent, clickable footer fixtures.**
4. **Scene/chapter navigation: rail + corkboard** — first pass at the
   always-visible left rail and the summonable full-window corkboard, both
   built on a shared chapter/scene model derived from the editor's outline
   (see the plan captured in the `virtual-watching-quilt` plan file /
   original design handoff — chapters = `h1`, scenes = `---` breaks or
   `h2`/`h3` sub-headings).
5. **Replaced the hand-rolled spellcheck dictionary with real Hunspell
   (nspell).**
6. **Added spellcheck "ignore word" support.**
7. **Rebuilt the editor core as owned source** (`src/editor/`) — moved off
   whatever the editor previously depended on, added find/replace,
   spellcheck integration, and design-token fixes at the CodeMirror layer.
8. **Local git-based backup**, custom app icon, Claude Code project
   settings (`src/backup.js` + `src/backup-providers/local-git.js` —
   provider-based, so cloud sync can be added later as one more provider
   module).
9. **Live-preview markdown, block spacing, scene-break redesign, theme
   cleanup** — the markdown rendering/styling pass (live `#`/`**`/`` ` ``
   rendering, block spacing rules, scene-break visual treatment, a cleanup
   pass across the 4 themes).
10. **Unit tests + E2E smoke suite** — established the CDP-driven E2E
    harness (`test/e2e/cdp-client.js`, `test/e2e/harness.js`) and the first
    round of unit tests, setting up the "verify live, then persist coverage"
    pattern used for everything since.
11. **Rail/corkboard/sprint polish + chapter/scene deletion** (commit
    `e8e141a`, most recent) — see below.

## Most recent work in detail (commit `e8e141a`)

Two requests, done together in one session:

**7 fixes/tweaks:**
1. Default chapter titles — blank `h1` chapters show a non-persisted
   "Chapter N" ghost-text placeholder (editor widget in
   `src/editor/chapter-placeholder.js`, plus a `displayTitle` field in
   `src/features/scene-nav/model.js`) instead of rendering blank. Typing a
   real title replaces it; nothing is ever saved to disk for the
   placeholder itself.
2. Editor line measure changed from `620px` to `75ch`, and made tunable
   from one CSS variable (`--editor-measure` in `src/index.html`, read by
   `src/editor/theme.js`).
3. Per-chapter "add scene" row in the rail (`src/features/scene-nav/rail.js`)
   — a new scene now lands in the chapter you clicked from, including
   currently-empty chapters, instead of always appending to the manuscript
   end.
4. Corkboard no longer navigates away on any card interaction — removed a
   stray `corkboard.close()` call in `addNewScene`
   (`src/features/scene-nav/index.js`) that fired for corkboard-triggered
   adds. Added a deliberate "open in manuscript" icon button on each card
   (`src/features/scene-nav/corkboard.js`) for jumping there on purpose.
5. Command palette → Sprint now opens the timer setup automatically
   (`src/app.js`'s `modeGroup()`), instead of just switching to Sprinter
   mode and leaving the user to find the shortcut themselves.
6. Removed the pulsating glow animation on the sprint icon
   (`src/features/sprint-timer.js`) — kept the icon and its accent color,
   dropped the `sprint-pulse` keyframe animation.
7. Restored "hide timer" during an active sprint (`updateChipContent()` in
   `src/features/sprint-timer.js`) — a prior session's "make the chip
   permanent" change had broken this by always showing the countdown
   regardless of `sprint.view`.

**Delete chapter/scene** — two-click arm/confirm delete buttons
(`makeDeleteButton()`, duplicated in `rail.js` and `corkboard.js`; no native
`confirm()` dialog, consistent with the app's dialog-free philosophy) wired
to `deleteScene`/`deleteChapter` in `src/features/scene-nav/reorder.js`,
built on a shared `buildDocument(chapters)` rebuild helper.

**Two real pre-existing bugs found and fixed along the way** (not asked
for, found through testing):
- `src/editor/outline.js`'s heading regex didn't recognize a bare `"# "`
  (hash + trailing space, no title yet) as a valid heading at all — fixed
  the regex to make the title group properly optional.
- `addNewScene` (`src/features/scene-nav/index.js`): adding a scene to any
  chapter that wasn't the document's last chapter glued an empty phantom
  scene-break marker directly in front of the next chapter's heading, with
  no scene content ever following it — any later rebuild (reorder, rename,
  delete) silently dropped it, discarding whatever the user had typed in
  the meantime. Fixed by trimming back to the real end of the previous
  scene's content before inserting, instead of inserting at the raw
  (chapter-spanning) `endPos`.

Both have regression tests in `test/unit/outline.test.js` and the E2E suite.

## Latest work in detail (uncommitted — two quick fixes)

1. **⌘↵ inserts a scene break.** Added `'Mod-Enter'` alongside the existing
   `'Mod-Shift-Minus'` binding in `src/features/core.js` (both call
   `ctx.insertSceneBreak()`; the old shortcut still works, undocumented),
   plus the matching case in `src/app.js`'s `shortcutFor()` global fallback.
   The command palette's "Scene break" entry now displays `⌘↵` as the
   primary shortcut. Verified live via CDP that dispatching a synthetic
   `Mod-Enter` keydown doesn't double-insert (CodeMirror's own keymap
   handles it before the global document-level fallback would; only ever
   saw one `---` inserted per keypress). Regression test:
   `test/e2e/smoke.test.js`, describe block `⌘↵ scene break and sprint
   pause`.
2. **Sprint timer pause/resume.** `src/features/sprint-timer.js`: the
   sprint object gained a `paused` boolean; `togglePause()` clears/restarts
   the `tickTimer` interval. A "pause"/"resume" pill sits between minimize
   and end in the active panel; the header dot stops pulsing and the label
   reads "paused" while paused. The status chip and the minimized edge line
   both reflect paused state too (chip text "paused", edge line dimmed) —
   except the `hidden` view, which deliberately keeps showing just
   "sprinting" regardless of pause state, consistent with hidden's whole
   point of not leaking timer specifics. Also added a "Pause sprint" /
   "Resume sprint" command palette entry. No new keybinding — button/palette
   only, since that's all that was asked for. Regression tests:
   `test/e2e/smoke.test.js`, describe block `sprint pause/resume` (3 tests
   covering active-panel pause/resume, minimized+paused, and hidden+paused).

Not yet committed or pushed as of this writing.

## Open items / not yet done

Nothing is currently pending — no unfinished request, no known bug, no
half-built feature. If a new session starts and there's no fresh user
request yet, a reasonable place to look for "what's next" is:
- Corkboard drag-to-reorder across chapters — implemented, but hasn't had
  the same depth of adversarial E2E testing as the delete feature did; if
  bugs turn up in that area, that's likely why.
- Anything explicitly deferred in `docs/two-mode-architecture-plan.md` (an
  AI assist panel was mentioned as a later layer on top of Editor mode, not
  yet started).
- `Sprinter timer design states.zip` at the repo root is original design
  reference material, not yet fully cross-checked feature-by-feature
  against the shipped implementation beyond what's already been verified.

## Working conventions established this session (worth keeping)

- Never commit or push without being explicitly asked, even after finishing
  a large chunk of work — always report results and ask first.
- Verify every change live against a real Electron instance (CDP-driven,
  isolated scratch user-data/save directories — never the user's real
  settings or `~/Documents/Barebones/`) before calling it done, not just via
  unit tests.
- Every behavioral change gets both a live verification pass and persisted
  automated test coverage (unit and/or E2E) — not one or the other.
- Destructive actions in the UI use a two-click arm/confirm pattern, never
  a native `confirm()`/`alert()` dialog — this is a deliberate, established
  app-wide convention, not a one-off choice.
- Full rebuild over surgical edit for document mutations that restructure
  the manuscript (reorder, delete) — `buildDocument()` regenerates the
  whole document string from the chapter/scene model rather than trying to
  splice text in place. Trades exact whitespace preservation for
  consistent output and much simpler correctness reasoning.
