# Baretext — progress log

A running record of what's been built, in what order, and what's still open.
Read this at the start of a new session to pick up where things left off —
it's context, not a spec; the code and `git log` are the source of truth for
exact behavior.

Also see: `README.md` (how to run/build/test, feature overview),
`docs/two-mode-architecture-plan.md` (the Sprinter/Editor mode split),
`docs/theme-spec.md` (design tokens), `TYPEWRITER_MODE.md` (typewriter
focus-mode spec).

## Where things stand (as of 2026-08-12)

**Pick up here.** Several sessions' worth of work since the last update
(2026-08-09, the rail drag-and-drop entry below) — all done, live-verified
via CDP, and covered by persisted tests, but **still all uncommitted**:
`git status` shows 43 changed/new files, `git log` still points at
`62b00ba` (the drag-and-drop/scene-naming commit), nothing since has been
committed. **This project's standing rule is commit-only-when-asked** —
don't commit any of this without the user explicitly asking first, and
don't assume a fresh session should either.

Full test suite: **133 unit + 104 E2E, all passing.** The packaged app has
been rebuilt and reinstalled to `/Applications/Baretext.app` after every
session below (most recently after the architecture-review fixes) — it's
current with everything in this file, nothing pending a rebuild. The user
has explicitly asked for autonomous execution on this: don't stop to
confirm before rebuilding/reinstalling once a fix is done and tested — see
"Working conventions" below.

Since the last write-up, in order: a standard-practice fix for spellcheck
flagging words mid-keystroke; `--` auto-converts to an em dash (careful not
to collide with the `---` scene-break marker); a real CodeMirror keymap
bug where Cmd-I silently ran `selectParentSyntax` instead of italics; a new
**Cold Storage** rail feature for parking cut scenes without deleting them;
headings no longer render bold in the monospace font; rail/corkboard jumps
now scroll to the top of the viewport instead of centering; and a full
architecture-review pass (report, then fixes: a real silent-save-failure
bug, five duplicated UI helper functions consolidated into shared modules,
the 5-theme registry partly unified, and new test coverage for the
git-backed backup system, which had none). See "Most recent work in detail"
below for the full account of all of it.

**This session (rail drag-and-drop): two real bugs, not polish.** (1) A
genuine data-loss bug — dragging a freshly-added, not-yet-written scene to
any new position silently deleted it, no error, no undo-worthy trace.
`reorder.js`'s `buildDocument()` filtered any scene whose stripped body
was empty out of the rebuilt document entirely, on the theory that "no
prose yet" meant "safe to prune" — wrong, since "+ add scene" creates
exactly that state on purpose and the rail/corkboard already treat it as a
normal "draft" scene, not something to auto-delete. (2) No drop-position
feedback — a drop always inserted BEFORE whatever row it landed on,
regardless of where on that row the cursor was, with nothing visually
distinguishing "top half" from "bottom half" even though they meant the
same thing every time. Both fixed; see "Earlier work in detail (rail
drag-and-drop: data loss + drop feedback)" below.

Both Sprinter and Editor mode are feature-complete against the original
design handoff. A full accessibility pass (`design_handoff_baretext/
ACCESSIBILITY.md`, task 1 of that handoff's suggested order) landed:
every span/div+mousedown control converted to a real, keyboard-operable
`<button>`, a scene-rail keyboard/tree model (arrow-key nav, F2 rename,
Delete arm, ⌥↑/⌥↓ reorder), a command-palette dialog/combobox/listbox ARIA
pattern with a focus trap, WCAG AA contrast fixes across all 5 themes, hit
targets, and `prefers-reduced-motion` support. On top of that, task 2 of
the same handoff (the status-bar mode switcher, `MODE_SWITCHER.md`) is also
done, plus a quick fix: focus mode (⌘.) now also hides the minimized sprint
edge line (it lives outside `#statusbar`, so hiding the status bar alone
used to leave it on screen).

**Most recent session: built the Editor-mode manuscript surface** — a
right-aligned chapter/scene number gutter hanging in the left margin,
larger chapter/scene typography, and a named-vs-unnamed scene treatment
(named → left-aligned heading, unnamed → a `--scene`-tinted ornament
divider), all gated to Editor mode only — Sprinter stays exactly as it
looked before. **The prose measure itself is untouched (`--editor-measure`,
75ch, same as Sprinter)** — an initial pass narrowed it to a fixed 60ch to
match the design mockup's own demo page, but the user caught this on a real
document: the gutter has room to hang in the window's existing margin
without shrinking the writing column, and 60ch felt cramped for actual
writing. Reverted; the gutter is purely additive now. Also caught in the
same review: the "Untitled" chapter-title fallback was rendering italic —
never asked for, dropped, it's regular monospace like everything else in
the editor. **A third, real bug caught on the user's own document just
after that**: scenes titled with `###` (h3) instead of `##` (h2) kept the
old, unrelated h3 style (bold-ish 600 weight, its own `--h3` color, ~19px)
instead of the new manuscript-surface scene-heading treatment — visible as
a heading that read as bold/bright-green and comically small next to its
28px gutter number, which looked like a baseline-alignment bug but wasn't
(the two elements' top edges matched exactly; it was a *size* mismatch,
not a position one). Fixed by giving h3 its own `--ms-h3-*` tokens mirroring
h2's, so Editor mode unifies both (outline.js already treats `##`/`###` as
equally valid scene markers — the heading *style* just hadn't caught up),
while Sprinter's h3 stays on its own separate, unchanged defaults.

**A fourth bug, on the same document, right after that fix landed**: the
h3 fix made "January 22, 2026" the right size/weight/color, but the
number beside it ("1.1") was still visibly floating above its baseline —
a *real* alignment bug this time, not the h3 size mismatch that looked
like one. This one took **two** attempts to actually fix:

- **Attempt 1 (CSS only):** the gutter number was positioned with
  `top: 0` on a zero-height sibling placed right before the target line,
  on the assumption that matching font-size/line-height between the
  number and the heading would make them land on the same baseline. False
  — measuring three cases with *identical* font-size/line-height on both
  sides gave three different gaps in three different directions
  (blank-chapter placeholder: +16.5px; a real chapter title: −7.5px; a
  real `##` heading: +3px). A CodeMirror line's own line box is governed
  by the block's inherited line-height (sized for 15px body text), and a
  much larger heading-sized span inside it produces a
  top-of-line-to-top-of-glyph gap that isn't a fixed, reproducible
  constant.
- **Attempt 2 (JS-measured):** stopped guessing and measured the real
  rendered position instead — `getBoundingClientRect()`/`Range` against
  whatever actually rendered, with the number's `top` set to match. This
  fixed the three cases above (verified sub-1px in a test) and briefly
  looked done. It wasn't: the user's own document (real `###` scene
  headings, names with descenders like "y") was **still** visibly
  misaligned — matching *bounding-box tops* doesn't guarantee matching
  *baselines* when the two things being compared have glyphs of different
  heights (a digit vs. a capital letter vs. a descender), and the sub-1px
  test that had seemed like solid proof was tautological: it only checked
  that the code did what it meant to, never independently verified that
  "matching tops" was the right thing to match in the first place.

**The actual fix:** stopped computing a position in JS at all. The gutter
number is now genuinely inline content sharing the same line box as its
heading text, so the browser's own text-layout engine does the baseline
alignment — the same mechanism that correctly aligns a digit next to a
capital letter in ordinary prose, and the only thing in this whole
investigation that got every case right without needing per-case tuning.
The tricky part was keeping that inline number out of
`.cm-line.textContent` (needed for the E2E suite's exact-text assertions)
while *also* getting it to render before an existing `::before`-based
caption on named scenes, since a real `::before` is always structurally
first no matter where a real DOM widget is inserted — solved by moving
that caption to its own widget too, ordered via `side`. See "Most recent
work in detail" below for the technical detail, including why the
seemingly-obvious "compare bounding boxes directly" verification approach
was tried a third time for the regression test and *also* produced a
false positive, and what test methodology actually holds up. **Not yet
committed** — see the Build history section; the previous session
(drag-and-drop fixes + scene-naming rework) was already committed before
this one started, so a diff review will show only this session's changes.
Full test suite: 115 unit + 83 E2E, all passing, stable across repeated
runs. Nothing is mid-flight or
half-implemented. One idea was raised and explicitly deferred, not
started: see "Open items" below (AI-generated corkboard summaries).

**Note:** `docs/theme-spec.md` (the original internal theme doc) is now
stale in two ways — its own hex values don't even match what was previously
shipped as "Ayu" (a pre-existing drift, not something this session caused),
and it predates the amstrad/grove rename+addition below.
`design_handoff_baretext/THEMES.md` is the current authoritative theme spec;
`docs/theme-spec.md` hasn't been touched or reconciled with it.

**Two follow-up fixes right after the theme system landed:**
1. The Amstrad rename carried over the *old* "ayu" theme's H1–H4 markdown
   heading colors verbatim (`src/editor/theme.js`) — those were leftover
   orange/tan values from before this app's "ayu" theme was ever actually
   green, so Amstrad headings rendered brown/orange against its green body
   text. Fixed with graduated green shades derived from Amstrad's own accent
   (`#8fd670` / `#6fb050` / `#549040` / `#3d6c30`), matching how dark/light's
   H1–H4 are shades of their own accent rather than Dracula/Grove's
   multi-hue approach (a monochrome-terminal theme shouldn't have
   multi-colored headings).
2. **E2E/CDP-driven Electron launches now run fully hidden.** Every test run
   (and every ad hoc scratch verification script built on
   `test/e2e/harness.js`) was popping a real, focus-stealing window — flagged
   by the user as disruptive to their own work happening alongside it. Fixed
   by making the window's `show` option read `process.env.BARETEXT_HIDDEN`
   (`src/main.js`), set to `'1'` by `harness.js`'s `spawnElectron()`. CDP
   drives the renderer directly and doesn't need the window visible —
   confirmed all 55 E2E tests (including focus-dependent assertions) pass
   identically with the window hidden. Normal `npm start` is unaffected.

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
    `e8e141a`).
12. **⌘↵ scene-break shortcut + sprint timer pause/resume** (commit
    `a939ca1`) — see the "⌘↵ scene break and sprint pause" describe block in
    `test/e2e/smoke.test.js` for the regression coverage.
13. **Rail drag-and-drop + typewriter first-line centering fix** (commit
    `f56317c`).
14. **5-theme system (Ember/Parchment/Amstrad/Grove/Dracula) + Theme
    Picker view**, plus two immediate follow-ups (Amstrad heading-color fix,
    hidden E2E test windows) — see "Earlier work in detail" below.
15. **Accessibility pass** (`design_handoff_baretext/ACCESSIBILITY.md`,
    commit `0f0bdf1`) — see "Earlier work in detail" below.
16. **Status-bar mode switcher** (`design_handoff_baretext/MODE_SWITCHER.md`)
    — see "Earlier work in detail (mode switcher + a quick fix)" below.
17. **Focus mode also hides the sprint edge line** (quick fix).
18. **Fixed rail/corkboard drag-and-drop (real bugs, not test gaps) and
    reworked scene naming into a non-manuscript waypoint** (commit
    `62b00ba`) — see "Earlier work in detail" below.
19. **Editor-mode manuscript surface: number gutter + named/unnamed scene
    treatment** (`design_handoff_baretext/MANUSCRIPT_SURFACE.md`) — see
    "Earlier work in detail" below.
20. **Fullscreen background-color gap + a titlebar drop shadow** (quick
    fixes, same session as #19) — see "Earlier work in detail" below.
21. **Rail drag-and-drop: fixed a real data-loss bug (empty scenes vanishing
    on reorder) and added drop-position feedback** — see "Earlier work in
    detail (rail drag-and-drop: data loss + drop feedback)" below.
22. **Spellcheck no longer flags a word while the caret is still inside
    it** — standard-practice fix, matches macOS/Google Docs/VS Code.
23. **`--` auto-converts to an em dash**, careful not to collide with the
    `---` scene-break marker.
24. **Fixed a real CodeMirror keymap bug**: Cmd-I silently ran the
    built-in `selectParentSyntax` (expand selection) instead of italics,
    because `@codemirror/commands`' own `defaultKeymap` claimed `Mod-i` at
    equal precedence, registered earlier in the extension list. Read to the
    user as "Cmd-I selects all."
25. **Cold Storage** — a persistent rail section for parking cut scenes
    without deleting them; excluded from the manuscript's word count and
    the "N ch" chapter count; the underlying `<!-- COLD STORAGE -->` marker
    only exists in the file while actually in use.
26. **Headings no longer render bold in the monospace font** (all three
    levels, both modes) — bold monospace glyphs render heavier/uneven and
    break the font's own fixed-width alignment. Serif/sans keep their
    existing bold headings.
27. **Rail/corkboard jump navigation now scrolls to the top of the
    viewport instead of centering** — centering was burying the heading
    (and everything after it) mid-screen instead of letting you read
    forward from it.
28. **Architecture review + fixes** — a full report (correctness,
    duplication, structure), then acted on: a real silent-save-failure bug
    fixed, five duplicated UI helper functions consolidated into shared
    modules, the 5-theme registry partly unified, and new test coverage for
    the previously-untested git-backed backup system. See "Most recent work
    in detail" below.

## Most recent work in detail (spellcheck timing → architecture-review fixes)

Seven pieces of work across several turns, each live-verified via CDP
before writing regression coverage, each rebuilt/reinstalled to
`/Applications/Baretext.app` as it landed. None of it committed.

**1. Spellcheck flagged words mid-keystroke.** User report: "It's making a
word invalid before you're done typing it... Look for the standard/best
practice and do that." `src/editor/spellcheck.js`'s `build()` flagged every
misspelled word on every doc change, with no exception for the word the
caret is actively inside — reproduced live (typing "helllo" character by
character showed `helllo`, and even transient substrings like `hel`, flag
red mid-type). Fixed by excluding the word containing a *collapsed* cursor
(an active selection still flags normally) from the flagging pass, and
triggering a rebuild on `update.selectionSet` too, not just
`update.docChanged`, so the flag appears the instant the caret leaves —
matches macOS/Google Docs/VS Code, and mirrors this codebase's own existing
precedent in `live-preview.js` (raw markdown only shows on the caret's own
line). 2 new E2E tests.

**2. `--` auto-converts to an em dash.** Standard editor convenience (Word,
Google Docs, iA Writer, Scrivener all do it) — user asked for it directly
after noting the one real risk: this app's own `---` scene-break marker is
a load-bearing three-dash token, so converting eagerly on the second dash
would corrupt every scene break mid-type. New `EditorView.inputHandler` in
`src/editor/em-dash.js`: only converts when the character immediately
*after* the two dashes is itself not a dash — by the time that's known, the
line can no longer trim down to a bare `---`/`----` marker, so it's
unambiguously inline prose. Also skips inside code/URL syntax ranges via a
new shared `src/editor/skip-ranges.js` (extracted from spellcheck.js's own
skip-range logic, now used by both). 3 new E2E tests (inline conversion,
`---` marker survives untouched, a run of 4+ dashes stays literal).

**3. Cmd-I silently ran "select all" instead of italics.** Root cause,
found via live CDP repro (not guessed): `@codemirror/commands`' own
`defaultKeymap` binds `Mod-i` to `selectParentSyntax` ("expand selection to
the enclosing syntax node") at default precedence, and since
`historyAndKeymaps()` is spliced into `api.js`'s extension list *before*
`boldItalicKeymap()`, it won at equal precedence — Cmd-I never reached
`wrapSelection('*')` at all, it just kept expanding the selection, which
read to the user as "Cmd-I selects all" (Cmd-B was unaffected only because
nothing else claims `Mod-b`). Fixed with `Prec.highest(keymap.of([...]))`
on `boldItalicKeymap()` (`src/editor/history-commands.js`) instead of
relying on extension order, so the app's own Mod-b/Mod-i bindings always
win regardless of future reordering. 2 new E2E tests using a real
mouse-drag selection (not a hand-set browser Selection, which CM6 ignores
since it didn't originate the change) — assert both the wrap text *and*
that the selection stays on the word instead of ballooning out.

**4. Cold Storage** — a place to park scenes you don't want in the
manuscript but aren't ready to delete. User asked what other apps call
this; landed on "Cold Storage" (a designer preference over "the fridge"/
"cutting room floor"/"the drawer" — reads as a real feature name, not
whimsical, without the trash-coded connotation of "cut"). Architecture,
built to reuse every existing chapter/scene primitive rather than add a
parallel system:
- `src/editor/outline.js`: a literal `<!-- COLD STORAGE -->` line is its
  own item type, resetting scene numbering exactly like an `h1` — checked
  before the generic name-comment regex so it's never mistaken for a
  scene's own name comment.
- `src/features/scene-nav/model.js`: `getManuscript()` now *always*
  appends a `coldStorage: true` bucket as the chapters array's last entry
  — present even with zero scenes, so "does Cold Storage exist yet" never
  needs a special case anywhere downstream. Dropping the first scene into
  it and reorder.js writing the marker for the first time is just an
  ordinary cross-chapter move, same code path as moving a scene between
  two real chapters.
- `src/features/scene-nav/reorder.js`: `buildDocument()` always serializes
  the `coldStorage` entry LAST regardless of where it sits in the input
  array (found by its flag, not position), and writes nothing at all when
  it's empty — an unused Cold Storage never touches the file on disk, and
  dragging the last scene back out cleanly erases the marker again on the
  next rebuild. Real bug caught before it shipped: the existing
  `reorderScenes`/`reorderChapters`/`deleteScene` functions each did a
  shallow copy of the chapters array (`{ title, synthetic, scenes }`) that
  silently dropped the `coldStorage` flag — fixed by carrying it through.
- `src/features/scene-nav/rail.js`: a persistent "❄ Cold Storage" section
  pinned to the bottom of the rail, always visible (with a "drag a scene
  here to park it" hint when empty). Not a chapter-drag target itself (no
  "Ch. N" numbering, excluded from the header's "N ch · M" count and the
  status bar's word count), but scenes inside it get full rename/delete/
  reorder via the exact same code paths real chapters use. Refactored the
  scene-row-rendering code into a shared `buildSceneRow()` so real chapters
  and Cold Storage render identically instead of forking the markup.
- `src/app.js`: found and fixed a related bug while wiring this up —
  `ctx.setDoc()` (what every rail/corkboard action calls) deliberately
  suppresses the editor's own `onChange` listener, which meant the status
  bar's word count never refreshed after ANY scene-nav action (reorder,
  delete, rename — not just Cold Storage), just went stale. `setDoc()` now
  also calls `updateCounts()` directly.

9 new tests (unit: outline marker parsing, model bucket construction,
reorder serialize-last/self-cleaning/flag-preservation; E2E: full drag
round-trip with word-count assertions at each step).

**5. Headings don't render bold in the monospace font.** User: "in
monospace font, the chapter title should not be bolded, none of the
headings should." Bold monospace glyphs render heavier/uneven (no true
bold design cut the way serif/sans have — it's synthesized) and it breaks
the fixed-width alignment mono is chosen for in the first place.
`src/editor/markdown-language.js`'s h1 weight was hardcoded `'700'` (h2/h3
were already CSS-var-indirected from the manuscript-surface work) —
parametrized to `var(--ms-h1-weight, 700)`, and a new
`html[data-font="mono"]` rule in `src/index.html` drops all three heading
weights to 400 for the mono font specifically, in both modes (Editor
mode's own h2/h3-unification override already forced 400 there regardless
of font, so this mostly closes the gap for h1 and for Sprinter mode's
h2/h3, which had no prior override at all). `app.js`'s `setFont()` now also
sets a `data-font` attribute on `<html>`, matching the existing
`data-theme`/`data-mode` convention, to drive the new CSS rule. 4 new E2E
tests, including one that caught the test's OWN methodology bug first: the
weight has to be read off the HighlightStyle-generated inner `<span>`, not
the `.cm-heading-N` line div itself (a decoration-only class from
`block-spacing.js`) — reading the line div gave a false failure that
looked like the fix hadn't worked.

**6. Rail/corkboard jumps scroll to the top, not centered.** User:
"clicking the scene or chapter should take you to the top of the screen,
not middle in editor mode." `jumpTo()` in both `rail.js` and `corkboard.js`
called `centerCursor()` (`y: 'center'`) after `setCursorPos()`. Added a new
`scrollToTop()` in `src/editor/api.js` (`y: 'start', yMargin: 24`),
deliberately separate from `centerCursor()` — typewriter mode's own
re-centering in `app.js` is a different, legitimate use of the same
underlying `centerCursor()` and was left untouched. 2 new E2E tests
measuring the heading's actual position as a fraction of the viewport
height after a jump.

**7. Architecture review, then fixes.** User: "Run an analysis on what
needs to be fixed, what can be improved, what can be simplified... flag
anything needlessly verbose." Full pass across `main.js`/preload/IPC, the
backup system, every editor extension, every feature module, and the test
suite — findings and file:line evidence gathered directly (`wc -l`,
targeted `diff`s to prove duplication was byte-identical, checking the
actual built `.asar` before flagging a hypothesis as real). Report only,
no code changed in that pass. Then: "keep fixing everything" (with
"dangerously approve" — see "Working conventions" below).

Fixed:
- **Silent save failures — the most important one.** `index.html` had a
  `#save-error` status-bar dot with `.visible` CSS wired up, and `app.js`
  correctly *cleared* it on success — but nothing ever *set* it. A disk-full/
  permissions/deleted-path write failure in `main.js`'s `saveToFile()` only
  ever hit `console.error`, invisible unless DevTools was open, while the
  app kept behaving as if the save had gone through. Worse, found along the
  way: manual save (Cmd-S) replied `'save-confirmed'` **unconditionally**
  right after calling the writer, regardless of whether the write actually
  succeeded — a failed Cmd-S told the user "saved," toast and all, even
  though nothing was written. Fixed: `saveToFile()` now returns true/false
  and sends a new `save-error` IPC event (with the real error message) on
  failure; `save-now`'s handler only replies `save-confirmed` when the
  write actually succeeded; the same try/catch + discriminated-result
  pattern was applied to `export-file`, which had no error handling at all
  before. Live-verified by replacing the target file with a directory
  (`EISDIR`) mid-session — confirmed the indicator lights up with the real
  message, a failed Cmd-S no longer shows "saved," the toast is throttled
  to once (not re-shown on every 500ms autosave retry while broken), and
  recovery correctly clears the indicator. 3 new E2E tests.
- **Five duplicated UI helper functions, consolidated.** `el`/`btn`/`icon`
  (byte-identical DOM-creation primitives) were independently redefined in
  6 files; `makeDeleteButton()` (the two-click arm/confirm delete pattern)
  and `beginEdit()` (inline rename swap) were duplicated near-verbatim (one
  byte-identical) between `rail.js` and `corkboard.js`. Extracted to new
  `src/dom.js` (`el`/`btn`/`icon` + a new shared `injectStyle(id, css)`) and
  new `src/features/scene-nav/ui-helpers.js` (`makeDeleteButton`/
  `beginEdit`, both now take their CSS-class/render-callback as a parameter
  instead of closing over a specific file's own naming). `rail.js` shrank
  754→646 lines, `corkboard.js` 447→339.
- **The `injectStyle()` boilerplate, deduplicated 14x.** Every feature/
  editor-extension file independently reimplemented the same 5-line
  "check `getElementById`, create `<style>`, set id, set textContent,
  append to head" — now one call to `dom.js`'s shared `injectStyle()` per
  file, each file's own named export (`injectSpellcheckStyle`, etc.)
  unchanged so no call site needed to move.
- **The 5-theme registry, partly unified.** The theme id/name list was
  independently duplicated across `main.js`, `index.html`'s CSS blocks,
  `theme-picker.js`'s gallery, and `core.js`'s command-palette entries —
  only the main.js/index.html pairing had a regression test guarding it.
  New `src/themes.js` is now the single source for id/name/order, imported
  by both `theme-picker.js` and `core.js` (icon and the "(dark)"/"(light)"
  label suffix stay local to `core.js` as genuinely palette-specific
  presentation, not part of a theme's core identity). `main.js` is a
  separate CommonJS module graph and can't import that file directly — it
  now at least derives its own `VALID_ACCENT_THEMES` from `THEME_BG`'s keys
  instead of keeping a second independent array in sync by hand. The actual
  per-theme CSS palette (accent/text/syntax colors) still lives only in
  `index.html`'s `[data-theme]` blocks; not practical to centralize further
  without introducing a build step for what's currently plain CSS.
- **Test coverage added for the git-backed backup system.**
  `src/backup.js`/`src/backup-providers/local-git.js` — the app's last
  line of defense against data loss — had zero tests despite being pure
  Node logic with no Electron dependency. New `test/unit/backup.test.js`
  (6 tests) uses real temp dirs and the real `git` binary: init creates a
  repo + initial commit and is idempotent, `flush()` commits real writes
  and the committed content matches disk, a missing file path is a safe
  no-op, unchanged content doesn't produce an empty duplicate commit, and
  `onSave()`'s 5-minute rate limit actually throttles (two saves with
  genuinely different content, milliseconds apart, produce at most one
  commit between them — proven regardless of what state earlier tests in
  the same run left behind, since the module's rate-limit state is global
  and shared across every test in the file).

**Left alone, on purpose — lower value or higher risk than what's above,
not part of a concrete finding:** splitting `app.js` (726 lines, the
central controller) or `test/e2e/smoke.test.js` (2900+ lines, though
already well-organized into ~17 independent `describe` blocks); extracting
`index.html`'s ~700-line inline `<style>` block to a separate file; adding
a linter/formatter (nothing currently enforces the conventions this
session's dedup pass just established). Worth doing if they start actively
hurting, not urgent today.

## Earlier work in detail (rail drag-and-drop: data loss + drop feedback)

**The user's report:** "If I make a scene in one chapter, and drag over
say, chapter 1, the scene disappears. Plus there's no clear feedback where
a scene will drop into place... it doesn't really seem like drag and drop
is working fully or well." Two separate, real bugs, confirmed live via CDP
before touching any code (a scratch repro script: add an empty scene,
real-mouse-drag it to another chapter, count rail rows before/after —
3 → 2, confirmed exactly).

**Bug 1 — data loss** (`src/features/scene-nav/reorder.js`): `+ add scene`
inserts a bare `---` marker with nothing typed after it yet (by design — the
rail/corkboard already treat this as a normal "draft" scene, `wordCount:
0 < DRAFT_WORD_THRESHOLD`). `buildDocument()`'s scene-joining step filtered
`chapter.scenes.filter((s) => cleanScene(s) !== '')` before rebuilding the
document — any scene with no prose yet was silently dropped from the
output entirely. This filter had actually been *deliberately* encoded as
correct behavior in an existing unit test
(`'empty scenes are dropped from the rebuilt document'`) — from some
earlier, different motivating case (the test comment only says
"whitespace-only after stripping the marker", no scenario), but it directly
conflicts with "+ add scene" being a supported, expected workflow: a
scene the user explicitly created has no legitimate reason to vanish the
next time anything reorders the manuscript, with no error and no
undo-worthy trace it ever existed. Fixed by removing the filter — every
scene passed to `buildDocument()` is now kept, period; deleting a scene
happens only through the explicit delete button (two-click confirm),
never as a side effect of a reorder.

Removing the filter alone wasn't quite enough: `joinScenes()`'s existing
"a scene at position 0 doesn't need its own `---` marker" convention (it
relies on `outline.js`'s implicit-first-scene detection instead, which
only recognizes a scene once *real content* follows the chapter heading)
meant an empty scene landing at the very front of a chapter would still
render as **nothing at all** — no marker, no content, structurally
indistinguishable from an empty chapter — even with the filter gone. Fixed
by giving `joinScenes()` a narrow exception: a bare scene at `i === 0` gets
an explicit marker specifically when its body is empty; a *written* first
scene keeps the existing markerless convention exactly as before (this
only changes anything for the one case that was actually broken).
Verified live for both the "moved to the end of a chapter" and "moved to
the very front of a chapter" cases; the existing unit test was rewritten
(not deleted) to lock in the corrected behavior, and a new E2E test
(`test/e2e/smoke.test.js`, "rail drag-and-drop" describe block) does a
real mouse-driven drag of a freshly-added scene across chapters and
asserts the total rail row count is unchanged.

**Bug 2 — no drop-position feedback** (`src/features/scene-nav/rail.js`):
a drop always inserted BEFORE whatever row it landed on (`toSceneIndex:
si`), regardless of where on that row the cursor released — dropping near
a row's top and dropping near its bottom looked and behaved identically.
Fixed with a genuine before/after model: each scene/chapter row's
`dragover` handler now checks `e.clientY` against the row's own vertical
midpoint (`getBoundingClientRect()`) and toggles a `drop-before`/
`drop-after` class accordingly; a thin 2px accent line (CSS `::before`/
`::after` on the row) renders at whichever edge is active, so the exact
insertion point is visible *during* the drag, not just guessable after the
fact. The `drop` handler reads the same class to decide `toSceneIndex: si`
vs. `si + 1` (scenes) or `toIndex: ci` vs. `ci + 1` (chapters). A chapter
header still uses the old whole-row wash highlight (`.drag-over`) with no
before/after split when it's receiving a *scene* drop specifically — that
interaction is "append to this chapter" with no position to choose among
its scenes, so a line indicator wouldn't mean anything there; it only
applies when two chapter headers are being reordered against each other.
A `clearDropIndicators()` helper wipes every row's drag-feedback classes
on every `dragend`, so a drag released outside any valid target (or a
mid-drag re-render) can't leave a stale line/wash behind.

Fixing this surfaced a **pre-existing gap in the test suite's own drag
helper**: `smoke.test.js`'s `dragScript()` (used by most of the
synthetic-event drag tests in the "rail drag-and-drop" describe block)
dispatched a bare `Event`, which has no `clientY` at all — reading as
`undefined`, and `undefined < row.height/2` is always `false`, so every
synthetic drop the WHOLE existing test suite performed would have silently
started landing on the "after" side instead of "before" the instant this
feature shipped, breaking multiple tests that never touched the actual
bug. Fixed the helper itself (constructs a real `MouseEvent` with
`clientY` pinned near the target's top, matching what those tests already
assumed) rather than patching each affected assertion. The one **real**
mouse-drag test (CDP `Input` domain, not synthetic events) had a related
but distinct problem: it dragged to the target row's exact pixel center,
which is a genuine tie at the before/after midpoint — adjusted to land
clearly in the top quarter instead, which is also more representative of
an actual drag (nobody releases at the exact geometric center of a row).
Verified live via CDP with the real 12-step, 30ms-per-step mouse pacing
`realDrag()` uses internally (a hand-rolled 2-step version was tried
first and didn't give the browser enough intermediate moves to fire
`dragover` on the actual final target — a test-script mistake, not an app
bug, caught by cross-checking against a screenshot of the mid-drag
indicator state). New tests: a real-mouse-drag-driven check that dropping
in a row's bottom half moves the dragged scene strictly *after* the
target (own fixture with named scenes — the shared describe-level fixture
uses unnamed scenes, whose rail labels are positional ("Scene 1", "Scene
2"...) and shift every time something reorders, so they can't be used as
a stable identity to assert against), plus a direct check that the
`drop-before`/`drop-after` classes toggle correctly on `dragover` and
clear on `dragleave`.

## Earlier work in detail (this session — fullscreen background-color gap + titlebar shadow)

Two small, purely visual fixes reported directly by the user from a
screenshot. **The fullscreen gap**: `src/main.js`'s `BrowserWindow` had
`backgroundColor: '#1a1a1a'`, a value matching none of the app's 5 themes.
With `titleBarStyle: 'hiddenInset'`, macOS reserves a thin strip at the
very top of the screen in fullscreen (for the auto-hide menu bar) that
sits outside the web content entirely and paints that raw color — visible
as a mismatched-color seam at the top edge in fullscreen specifically (not
windowed mode, where the custom titlebar covers the same area). Fixed with
a `THEME_BG` lookup (id → hex, mirroring each theme's `--bg` token in
`src/index.html`) applied at window creation and kept in sync at runtime
via `mainWindow.setBackgroundColor()` in the existing `accent-theme-changed`
IPC handler. A new unit test (`test/unit/theme-window-bg.test.js`) parses
both files independently and fails if they ever drift apart — two
hardcoded copies of the same fact is exactly the kind of thing that goes
stale silently otherwise (a native `BrowserWindow` option can't reference
a CSS custom property directly, so *some* duplication here is unavoidable,
but drift between the two copies doesn't have to be).

**The titlebar shadow**: `#titlebar` was flat `--bg` with zero visual
separation from the content below it, per the user: "to make it look more
deliberate... add a minor box shadow." Added `box-shadow: 0 2px 6px
rgba(0,0,0,.15)` — deliberately smaller than the app's existing
`--shadow-panel`/`--shadow-window` elevation tokens, since this is
drag-region chrome, not a floating surface, and the user asked for
"minor." Needed `position: relative; z-index: 1` on `#titlebar` too, since
without it the shadow would paint *under* `#content-row` (later DOM
siblings paint on top by default). Verified via computed-style checks +
screenshot; new E2E test locks in the shadow, its color (this app's
"black, no mid-tones" elevation language), and that the positioning that
makes it actually visible is present.

Both fixes verified against the actual packaged app, not just the dev
harness: rebuilt (`npm run build`) and reinstalled to
`/Applications/Baretext.app` (quit via `osascript -e 'quit app "Baretext"'`
first — the running app didn't respond to a window close alone, since
macOS's `window-all-closed` is a no-op on `darwin` by long-standing
convention across every native Mac app, not a bug in this one; the app
was still running in the background with its window closed when a
`cp -R` over its bundle was first attempted).

## Earlier work in detail (this session — manuscript surface / number gutter)

Design handoff refresh added `MANUSCRIPT_SURFACE.md` (+ `Manuscript
Surface.dc.html`): Editor mode's writing surface gets a right-aligned
chapter/scene number gutter hanging in the left margin (`1`, `1.1`, `1.2`…),
larger chapter/scene typography (chapter title 56px/700/`--accent`, scene
heading 28px/400/`--text-dim`), and a genuinely different treatment for
named vs. unnamed scenes. A new `--scene` token (warm accent, distinct from
`--accent`, one value per theme) was added to all 5 themes for the
unnamed-scene ornament. Everything is gated to `html[data-mode="editor"]`
— Sprinter mode is pixel-identical to before this session, verified via CDP
screenshot diff.

The mockup's own demo page hard-codes a 60ch measure, and the first pass
here copied that by overriding `.cm-content`'s `max-width` in Editor mode.
Caught in review on a real document: the gutter has plenty of room to hang
in the window's existing margin (the writing column doesn't run edge to
edge) — narrowing the measure was unnecessary and made the actual writing
column noticeably tighter for real prose. Reverted: Editor mode's
`.cm-content` keeps exactly `--editor-measure` (75ch), same as Sprinter;
only top/bottom padding differ (72px / 40vh, for the extra breathing room
the design calls for). The `--measure` token from that first pass was
removed entirely since nothing uses it anymore.

**Layout:**
- `src/index.html`: `--gutter`/`--gap` tokens, `--scene` added to all 5
  `[data-theme]` blocks, and an `html[data-mode="editor"] #editor-host`
  block that re-points `--text-h1`, `--h1`, and the new `--ms-h2-*`/`--h2`
  tokens for the larger chapter/scene typography, plus top/bottom padding
  on `.cm-content` (not its `max-width` — see above).
- `src/editor/markdown-language.js`: h1's line-height and h2's
  size/weight/line-height are now CSS-var-indirected (`--ms-h1-lh`,
  `--ms-h2-size/weight/lh`) the same way h1's font-size already was, so the
  editor-mode block above can retint/resize them without a mode-aware
  branch in the highlight style itself.

**New number gutter** (`src/editor/manuscript-gutter.js`): a `StateField`
(not a `ViewPlugin` — CodeMirror throws "Block decorations may not be
specified via plugins" if you try) providing a block-widget decoration
immediately before every chapter/scene line (h1, h2/h3, a named scene's
name-comment line, or a bare unnamed marker line — the implicit,
markerless first scene of a chapter gets no number at all if unnamed,
since there's nothing to anchor it to). Deliberately a **block** widget,
a DOM *sibling* of `.cm-line` rather than a child inside it: an inline
widget renders inside the line and shows up in `.cm-line.textContent`,
which silently broke several `test/e2e/smoke.test.js` assertions that do
exact heading/marker text matches (`lines.indexOf('Chapter Two')` etc.) —
two failed outright, others were passing by accident (a negative
`Array.indexOf` fallback masking the same underlying pollution). The block
widget is zero-height with the number pulled back over the following line
via `position: absolute`, so `.cm-line`'s own subtree — and therefore its
textContent — stays exactly the document's real text. Three per-anchor
vertical alignments needed tuning (see the CSS in that file): chapter/real
h2/h3 headings align at `top: 0`; a named scene's heading-styled
name-comment line also aligns at `top: 0` (after removing a redundant
`margin-top` — the collapsed marker line above it already provides the
gap); an unnamed scene's ornament is *vertically centered* in its own
collapsed 2.6em line, so its gutter number needs a matching
`calc(1.3 * var(--text-body))` offset instead of `top: 0`.

**Named vs. unnamed scene treatment** (`src/editor/scene-breaks.js`): a
marker line immediately followed by a name-comment now gets an extra
`cm-scene-break-named` class. In Editor mode: a named marker's ornament is
hidden entirely (`display: none` on its `::before`/`::after`) and its
collapsed height shrinks (the heading below it now carries the visual
weight); an unnamed marker's ornament recolors from `--accent` to
`--scene`; and the name-comment line itself switches from a small centered
italic caption (unchanged in Sprinter) to a real left-aligned heading
(28px/400/`--text-dim`, via `--ms-h2-*`) using the exact same
`content: attr(data-scene-name)` mechanism, just restyled — no JS decoration
changes needed for that part, CSS only.

**Untitled fallback** (`src/editor/chapter-placeholder.js`): a blank
chapter's ghost-text placeholder now reads "Untitled" (`--text-dimmer`,
weight 400, **regular** — not italic; caught in the same review as the
measure above, never asked for, this app's editor text is always regular
monospace) in Editor mode instead of "Chapter N" — the gutter already shows
the chapter's number there, so a duplicate numbered label reads worse than
a generic one. Sprinter keeps "Chapter N" unchanged. The rail/corkboard's
own "Chapter N" fallback (`model.js`'s `displayTitle`) is untouched either
way — that's a different surface with no adjacent number of its own.

**Mode reactivity** (`src/editor/mode-state.js`, new): a small
`editorModeField`/`setEditorModeEffect` StateField+effect pair, exactly
mirroring `live-preview.js`'s existing `renderedModeField` pattern, so
`chapter-placeholder.js` and `scene-breaks.js` (both of which switch
between genuinely different *text content*, not just CSS, depending on
mode) can react to a mode switch even when it happens without a document
change. `app.js`'s `activateMode()` now calls
`window.BaretextEditor.setEditorMode(view, modeDef.id === 'editor')`
alongside its existing `data-mode` attribute write. The number gutter and
the heading token overrides don't need this — they're pure CSS, driven
directly off `html[data-mode="editor"]`, which updates instantly.

Verified live via CDP throughout (computed-style assertions plus
screenshot captures across Ember/Parchment/Amstrad, both modes) before
writing regression coverage: `test/e2e/smoke.test.js` gained a new
"manuscript surface" describe block (gutter-number-to-textContent purity,
correct numbers per line kind, named/unnamed visual treatment incl. the
`--scene` token, the Untitled fallback — regular, not italic — and a
Sprinter-mode-unchanged check), and the existing "editor line measure is
75ch" test picked up a clarifying rename/comment (still asserts the same
thing it always did: `--editor-measure` is 75ch and `.cm-content` resolves
to a real pixel value) since it's now also documenting that the manuscript
surface deliberately does *not* touch it.

**The h3 bug** (`src/editor/markdown-language.js`): all of the above
initially only extended the manuscript-surface heading treatment to `##`
(`tags.heading2`) — `###` (`tags.heading3`) was left on its original,
independent styling (`fontSize: 1.28em`, `fontWeight: 600`, `color:
var(--h3)`, no `--ms-h3-*` indirection at all). The user's real document
uses `###` for scene titles, so its scene headings kept rendering bold,
~19px, and a distinctly more saturated green (Amstrad's old `--h3:
#549040`) right next to a 28px gutter number — which reads exactly like a
baseline-misalignment bug (that's how it was first reported) even though
the two elements' top edges were pixel-identical; it's a *size* clash, not
a position one. `outline.js` (and this feature's own gutter-numbering scan
in `manuscript-gutter.js`) already treat `##` and `###` as equally valid
scene-level markers — the heading *style* just hadn't caught up. Fixed by
giving h3 its own `--ms-h3-size`/`--ms-h3-weight`/`--ms-h3-lh` tokens
(mirroring h2's `--ms-h2-*` exactly, both default to h3's original values)
and pointing Editor mode's override block at both `--ms-h2-*` and
`--ms-h3-*` identically — Sprinter mode's h3 styling is completely
unaffected (separate tokens, not a shared alias, specifically so this
doesn't leak into Sprinter the way blindly reusing `--ms-h2-*` for h3 would
have). `test/e2e/smoke.test.js`'s manuscript-surface describe block gained
a `### ` scene to its fixture and two new assertions: an h3 scene heading
matches h2's 28px/400 exactly in Editor mode, and stays on its original
600-weight/non-28px sizing in Sprinter mode.

**The alignment bug — attempt 1** (`src/editor/manuscript-gutter.js`): once
the h3 fix above landed, the scene heading itself looked right, but the
gutter number next to it was still visibly off — reported with a
screenshot annotated with a down-arrow showing the "1" in "1 Untitled"
floating well above "Untitled"'s own baseline. The original implementation
positioned the number with plain CSS: `position: absolute; top: 0` on a
zero-height block sibling placed immediately before the target line, on
the theory that giving the number the *same* font-size and line-height as
its target (`--ms-h1-lh`/`--ms-h2-lh`/`--ms-h3-lh`, all shared with the
number's own `.cm-gutter-num-*` classes) would make them land on the same
baseline. Measured precisely (`getBoundingClientRect()` on the actual
visible text, not the `.cm-line` container) across three cases — all using
*identical* font-size/line-height on both the number and its target — and
got three different gaps in three different directions: a blank chapter's
"Untitled" ghost widget sat 16.5px *below* where the number assumed it
would; a real chapter title sat 7.5px *above*; a real `##` heading sat 3px
*below*. The common cause: a CodeMirror line's own line box is governed by
the block's *inherited* line-height (`--lh-body`, sized for 15px body
text, since `.cm-line` itself is never given its own override), and a much
larger heading-sized inline span sitting inside that produces a
top-of-line-box to top-of-glyph gap that depends on exactly what's on the
line — not a fixed, reproducible constant no matter how carefully the CSS
declarations are matched.

**Attempt 2 (JS-measured):** rewritten to stop predicting that gap and
instead measure the real one — a companion `ViewPlugin` ran after each
render and repositioned every number via `getBoundingClientRect()`/`Range`
against whatever its target actually rendered. This fixed the three cases
above (verified 0.0px delta) and a regression test asserted that directly.
It looked done. **It wasn't** — the next screenshot (the user's own real
document, annotated this time with red guide lines and dots under "1
Untitled" and "1.1 January 22, 2026") showed both rows still visibly off.
The sub-1px test had been tautological: it independently re-implemented
the *exact same* measurement the app code used and checked that they
agreed with each other, which they always would — it never verified that
"matching measured tops" was the right thing to match. The real problem:
matching *bounding-box tops* doesn't guarantee matching *baselines* unless
every character involved has identical ascent, and digits vs. mixed-case
heading text (particularly text with descenders like "y" in "January")
don't.

**Attempt 3 — the actual fix:** stop computing a position in JS at all.
Make the gutter number genuinely inline content sharing the same line box
as its heading text, and let the browser's own text-layout engine do the
baseline alignment — the same mechanism that correctly lines up a digit
next to a capital letter in ordinary prose, and the only approach in this
whole investigation that got every case right without per-case tuning.
Two structural problems had to be solved to get there:

1. **Keeping the number out of `.cm-line.textContent`** while genuinely
   inline (not a block sibling anymore): the widget's own DOM node now has
   *no real text* — `content: attr(data-gutter-num)` on its own `::before`
   carries the visible digits, exactly the trick `scene-breaks.js` already
   used for the scene-name caption, since CSS-generated content is never
   part of `.textContent` regardless of where in the DOM the host element
   lives.
2. **Render order on a named scene's line**, where the number and the
   scene-name caption both need to be inline siblings sharing one line
   box: a `::before` pseudo-element is *always* the structurally-first box
   in its host, ahead of any real DOM child no matter where that child is
   inserted — so the number (a real widget) could never reliably render
   before the name if the name stayed on the line's own `::before`. Fixed
   by moving the name to its *own* widget too (`SceneNameWidget` in
   `scene-breaks.js`, same empty-text-plus-own-`::before` trick), so
   ordering between the two becomes just their `side` values
   (`Decoration.widget`'s `side: -2` for the number, `-1` for the name) —
   deterministic regardless of which plugin's decorations happen to merge
   first.

Pulling the number into the left margin uses `margin-left: calc(-1 *
(gutter + gap))` (not `position: absolute`, which would pull it out of
flow and defeat the whole point) paired with `margin-right: gap` on the
*same* element — the two nearly cancel out (net horizontal footprint
zero), so the heading text that follows starts exactly where it would if
the number didn't exist at all, confirmed by checking `.cm-content`'s
overall width is unaffected. Hit the *exact* same `!important`-wildcard
gotcha from the very first version of this feature, twice more:
`.cm-scene-name-comment * { color: transparent !important }` (there to
hide the line's own raw, invisible `<!-- -->` text) caught both the new
number widget and the new name-label widget the instant they became real
DOM children of that line, silently rendering them fully transparent —
both needed a matching `color: ... !important` override.

**The regression-test journey, once more.** A direct pixel-delta check
(`getBoundingClientRect().bottom` on the number vs. a `Range` over the
heading text) was tried yet again for the new mechanism and produced a
*third* false result: comparing CSS-generated content (`content:
attr(...)`) against a real text node via `getBoundingClientRect()` doesn't
reliably agree with visual reality, even for descender-free text chosen
specifically to sidestep the earlier ascent/descent problem — a manual
pixel-column scan of the actual rendered screenshot (Python/PIL, sampling
which row each glyph's ink actually stops at) confirmed the real rendering
*was* pixel-aligned even where the DOM-measurement test reported a ~7px
gap. Given DOM-measured deltas had now produced false negatives *and*
false positives at different points in the same investigation, the test
was rewritten a final time to check the structural preconditions that
make native CSS baseline alignment apply — same `.cm-line` parent,
`display: inline-block`, `verticalAlign: 'baseline'` — plus that the
heading text doesn't shift horizontally, rather than trying to
independently re-derive a pixel position that had already been shown
untrustworthy to measure this way in both directions.

## Earlier work in detail (this session — drag-and-drop fixes + scene-naming rework)

User report after a fresh install: dragging didn't work anywhere in the
rail (chapters or scenes), scenes couldn't be dragged between chapters in
the corkboard, and naming a scene deleted its `---` break and inserted a
real `## heading` into the manuscript. All four turned out to be two real
bugs plus one intentional-but-unwanted behavior:

**1. Rail drag-and-drop was completely non-functional**, despite the
existing E2E suite's `rail drag-and-drop` describe block passing all along.
Root cause: the accessibility pass (`0f0bdf1`) converted the drag handle
into a real `<button>` built from the shared `btn()` helper, which attaches
`mousedown → e.preventDefault()` to every button (the app-wide "don't steal
focus from the editor on a chrome click" trick). Chromium never starts a
native HTML5 drag from a mousedown whose default action was prevented — so
`row.draggable = true` was being set correctly, but the browser's own drag
gesture never began. Confirmed with a **real, OS-level mouse press+move+
release dispatched through CDP's `Input` domain** (`Input.dispatchMouseEvent`)
rather than the test suite's existing approach of hand-dispatching
`DragEvent` objects (`el.dispatchEvent(new Event('dragstart'))` etc.) — the
zero drag events observed on a real mouse drag (vs. a clean sequence with
synthetic dispatch) is what pinned this down, and is exactly why the
existing tests never caught it: a hand-built `DragEvent` runs the app's own
`dragstart`/`dragover`/`drop` handlers directly, without ever exercising
the browser's "should a drag even start here" decision. Fixed by rebuilding
`makeDragHandle()` (`src/features/scene-nav/rail.js`) without `btn()` —
just `stopPropagation()` on the handle's mousedown, no `preventDefault()`.
**2. Corkboard's cross-chapter drop silently failed** whenever the drop
landed on anything other than the target grid's exact bare background
pixels or an existing card — which in practice is most drops, and *always*
true for a genuinely empty chapter (the only thing rendered there is the
dashed "new scene" tile). The grid's catch-all dragover/drop handler
required `e.target === grid` exactly; any bubbled target (the tile, its
icon, a stray text node) failed that check, so `preventDefault()` was never
called on `dragover`, and the browser silently rejected the drop (`dragend`
fired with no `drop` in between — confirmed live). Fixed by checking
`e.target.closest('.scene-card')` instead (bail only when an actual card,
which has its own more specific handler, is under the pointer) in
`src/features/scene-nav/corkboard.js`. Both fixes verified live via CDP
(same-chapter reorder, cross-chapter via chapter-row drop, chapter reorder,
corkboard drop into an empty chapter) and covered by new regression tests
built on real mouse simulation, not synthetic events: `test/e2e/cdp-
client.js` gained `mouseEvent()`/`realDrag()` helpers wrapping
`Input.dispatchMouseEvent`, used by one new test in the `rail drag-and-drop`
describe block and a new `corkboard cross-chapter drag` describe block.

**3. Scene naming reworked to be a rail/corkboard navigation waypoint, not
manuscript content.** Previously, naming a bare scene (a `---` marker, or
the implicit first-content scene) rewrote its marker line into a real
`## Title` heading (`rename.js`'s "bare scene" branch) — which both deleted
the `---` symbol and inserted new prose-level text the reader would see.
The user was explicit that scene names are waypoints for the rail, not
meant to appear in the manuscript at all. Since Baretext has no metadata
layer (everything is derived from the document text itself), the name now
lives as an **HTML comment** — invisible in any rendered/exported markdown
— placed immediately after the `---` marker with no blank line between
them (that adjacency is what distinguishes a named scene from an unnamed
one's ordinary `"---\n\n"` spacing), or directly before the content for the
markerless implicit-first scene. Changes, all with the matching read/write
side kept in sync:
   - `src/editor/outline.js` (`getOutline()`): recognizes a `<!-- Name -->`
     comment adjacent to a marker (or preceding a chapter's first real
     content) and uses it as the scene's `text` instead of the auto
     `"Scene N"`, tagging the item `named: true`. A comment seen while
     awaiting a chapter's first content is held in `pendingName` until real
     content actually arrives, so the comment line itself is never mistaken
     for the scene start.
   - `src/features/scene-nav/model.js`: propagates `named` onto each scene
     object; strips the comment line before computing `wordCount` (so a
     name doesn't inflate the count) and from `synopsisFrom()` (so it never
     leaks into the card synopsis). The marker line itself still counts as
     one "word" — a pre-existing quirk, deliberately left alone rather than
     changed opportunistically.
   - `src/features/scene-nav/rename.js`: the bare-scene branch now inserts
     or replaces the comment in place (checked both forward, for the
     marker-adjacent case, and backward past blank lines, for the implicit-
     first-scene case) instead of promoting to a heading.
   - `src/features/scene-nav/reorder.js`: `stripLeadingSceneBreak()` also
     strips a marker-adjacent *or* standalone leading name comment when
     "cleaning" a scene for a rebuild; `joinScenes()` re-emits the comment
     (adjacent to a re-inserted `---`, or alone if the scene lands first in
     its chapter) for any scene flagged `named`. Caught one real bug in
     testing here: a named implicit-first scene moved to a non-first
     position would double its comment (once from the un-stripped leading
     line, once from `joinScenes()` re-adding it) until
     `stripLeadingSceneBreak()` got a second, marker-independent branch for
     a standalone leading comment.
   - `src/editor/scene-breaks.js`: visually hides the raw `<!-- -->` syntax
     in the editor the same way the marker's raw dashes already are (`color:
     transparent` + a `data-scene-name` attribute consumed by a CSS
     `content: attr(data-scene-name)` pseudo-element), so the name reads as
     a small dim italic label rather than raw comment syntax cluttering the
     writing view.
   - Editor bundle rebuilt (`npm run build:editor`) since both `outline.js`
     and `scene-breaks.js` are part of it.

Regression tests: `test/unit/outline.test.js` (6 new — name-comment
parsing for both the marker-adjacent and implicit-first-scene cases,
including that a lone comment doesn't itself count as content, and that a
titled h2/h3 scene ignores a preceding comment), `test/unit/rename.test.js`
(rewrote the two tests that had encoded the old promote-to-heading
behavior as correct; added two more for in-place re-rename without
duplicating the comment), `test/unit/reorder.test.js` (3 new, covering the
double-comment bug found above), and `test/e2e/smoke.test.js` (rewrote the
one test that asserted the old behavior by name; added a new isolated
`naming a bare marker-line scene` describe block — kept separate from the
main shared-state smoke suite specifically because several later corkboard
undo/redo tests key off an earlier rename landing on an exact scene/name,
which a same-suite marker-scene test would have disturbed).

## Earlier work in detail (this session — mode switcher + a quick fix)

`design_handoff_baretext/MODE_SWITCHER.md` (task 2 of the current handoff's
suggested order — task 1, accessibility, was done and committed earlier
this session; task 3, Theme Picker, and task 4, theme rename, were done in
an even earlier session). Moves mode switching out of being palette-only
into a persistent, always-visible control:

- **`#statusbar` is now a 3-column CSS grid** (`grid-template-columns: 1fr
  auto 1fr`) instead of `flex + justify-content: space-between`, so the new
  center column stays truly centered regardless of how wide the two side
  clusters are. The right `.status-group` gets `justify-self: end` to stay
  pinned right (targeted via `:last-child` — both groups share the same
  class, so this avoids needing a second class name).
- **`#mode-switch`** — a `role="tablist"` of two real `role="tab"` buttons
  (Sprinter / Editor), styled deliberately subtle per the spec: no accent
  fill anywhere (a raised `--bg` chip + `font-weight:600` + a soft shadow
  reads as "selected" on its own) — the accent stays reserved for the
  writing surface itself (H1, cursor), not chrome.
- **One choke point for all three mode-switch entry points.** Extracted the
  palette's "switch mode, and if switching to Sprinter also open the sprint
  setup like ⌘⇧S would" logic (previously inline in `modeGroup()`'s `fn`)
  into a standalone `switchMode(modeId)` in `src/app.js`, called by both the
  palette items and the new tabs — so clicking the Sprinter tab gets the
  exact same "opens sprint setup" bonus the palette already had, confirmed
  live via CDP. `activateMode()` itself gained a call to a new
  `updateModeSwitch()` so the tabs' `aria-selected`/roving `tabindex` stay
  correct regardless of *what* triggered the mode change — including ⌘⇧D,
  which (deliberately, matching its existing pre-this-session behavior)
  still calls `activateMode()` directly and does *not* get the sprint-setup
  bonus; only the tabs and palette were asked to be "two entry points to
  the same action" per the spec, ⌘⇧D wasn't part of that ask and its
  behavior was left untouched.
- **Keyboard model exactly as specified: manual activation, not automatic.**
  ←/→ only move a roving `tabindex` between the two tabs (the pair is one
  Tab stop); Enter/Space activates whichever tab currently has focus. This
  is deliberately *not* the "arrow key immediately switches" pattern some
  tab implementations use — confirmed live that an arrow press alone never
  changes `data-mode`, only a following Enter/Space does.
- **No first-paint flash.** The existing theme-boot-flash-prevention
  pattern (`<head>`'s inline script sets `data-theme`/`data-mode`
  synchronously before the stylesheet parses) already covered `data-mode`,
  but the new tabs' active-look was initially only driven by a JS-set
  `aria-selected` attribute, which wouldn't apply until `app.js` ran a beat
  after first paint. Added a CSS fallback keyed off `html[data-mode="…"]`
  directly (same specificity class as the `[aria-selected="true"]` rule, so
  once JS does run and sets `aria-selected` to agree with `data-mode`, as
  it always does, the two rules simply reinforce each other rather than
  conflicting) — the correct tab is highlighted from the very first frame,
  not just after the module script executes.

Regression tests: `test/e2e/smoke.test.js`, `accessibility pass` describe
block gained 3 more tests (tablist roles + click-switches + stays in sync
with ⌘⇧D, roving-focus-doesn't-activate + Enter does, the grid layout
itself). 70 E2E total now.

**Quick fix: focus mode (⌘.) now also hides the sprint edge line.** User
report: toggling focus mode hid the status bar but left the minimized
sprint's thin accent-colored progress line on screen — it's an
absolutely-positioned sibling in `sprint-timer.js`, not a descendant of
`#statusbar`, so hiding the status bar alone never touched it.
`toggleFocus()` (`src/app.js`) now also toggles a `focus-mode` class on
`#app`; `sprint-timer.js`'s own stylesheet adds one rule keyed off that
class (`#app.focus-mode .sprint-edge { opacity: 0; pointer-events: none; }`)
rather than `app.js` reaching into another feature's private DOM refs.
Confirmed live it restores correctly when focus mode toggles back off.
Regression test added to the `sprint pause/resume` describe block. 71 E2E
total now.

## Earlier work in detail (commit `0f0bdf1` — accessibility pass)

A second design handoff update (same `design_handoff_baretext/` package,
new `CLAUDE.md` + `ACCESSIBILITY.md` + `MODE_SWITCHER.md` files added via a
follow-up zip) listed 4 tasks in suggested order; this session did **task 1
only** (the accessibility pass) — tasks 2 (bottom-bar mode switcher) and 3
(Theme Picker, already done previously) remain, task 4 (theme rename) was
already done too. `ACCESSIBILITY.md`'s own "suggested order of work" (5
steps, items 1-4 called "broad, mechanical, low-risk", item 5 "the deeper
widget work") was followed as the task breakdown:

1. **Root-cause fix: every span/div+mousedown control is now a real
   `<button type="button">`.** This was the single fix that unblocked
   everything else (focus, keyboard operability, ARIA roles all come free
   once something is a real button). Touched `src/features/sprint-timer.js`
   (duration chips, goal steppers, minimize/pause/end pills, the status
   chip), `src/features/scene-nav/rail.js` and `corkboard.js` (corkboard-
   open button, edit/delete/drag-handle/add-scene/footer/undo/redo/back),
   and `src/index.html` (`#tw-status-indicator`). Pattern used everywhere:
   `mousedown` still calls `preventDefault()` (preserves the existing
   "don't steal focus from the editor" trick), the actual action moves to a
   `click` listener (fires for both mouse and Enter/Space activation, free
   on a real button). `all: unset` in each control's CSS strips browser
   button chrome back to what the design already specified.
   - Real, non-obvious bug this surfaced: nested icon-only controls (e.g.
     the rail's drag-handle) needed their own `click`-propagation stop too
     — a plain click on the handle (press+release, no drag) would otherwise
     bubble up and fire the *row's* click handler as well, e.g.
     accidentally toggling the chapter it belongs to.
   - Second one: a delegated tree keydown handler (see below) has to check
     that the event's real target *is* the row itself, not a nested button
     — nested buttons already get native Enter/Space activation, so
     without that check a rename button's Enter would *also* replay as the
     row's own Enter handler (double-activation).
2. **Scene rail is now a real ARIA tree with a full keyboard model.**
   `role="tree"` on the list, `role="treeitem"` + `aria-expanded` on
   chapter rows, `role="group"` per chapter's scene list, `role="treeitem"`
   + `aria-current` on the active scene row. Keydown handler delegated on
   `#scene-rail` (survives re-renders without re-attaching): ↑/↓ move
   between rows, ←/→ collapse/expand a focused chapter, Enter/Space
   activates (toggle or jump), F2 opens rename, Delete arms the delete
   button (same two-click confirm as a mouse click), **⌥↑/⌥↓ reorders the
   focused row** — the keyboard alternative to drag-and-drop the audit
   explicitly asked for (chapters reorder among chapters; scenes reorder
   within their own chapter only, matching `reorderScenes`/
   `reorderChapters`'s existing "insert before toIndex" convention from the
   prior drag-and-drop work). Rebuild-driven actions (toggle, reorder)
   explicitly restore keyboard focus to the equivalent row afterward, since
   `render()` replaces the DOM wholesale and would otherwise drop it.
3. **Global `:focus-visible` ring + `prefers-reduced-motion` guard**
   (`src/index.html`) — one selector list covering every interactive
   pattern in the app (button, treeitem, option, radio, tab, tabindex),
   `:focus-visible` (not `:focus`) so mouse clicks don't show it. The
   reduced-motion media query collapses all animation/transition durations
   to near-instant, which also stops the sprint panel's infinite pulsing
   dot for these users without a dedicated rule (it's just another
   `animation` the generic query catches).
4. **Hit targets + un-hover-gated rail/corkboard action buttons.** The
   smallest controls (goal steppers, corkboard-open, edit/delete/drag-
   handle) got an invisible `::before { inset: -Npx }` hit-layer so the
   click target grows without the visible glyph growing (kept the compact
   look). `.sprint-pill` got `min-height: 28px`, `.rail-footer` the full
   `44px`. Rename/delete/drag-handle were `opacity: 0` until row `:hover`
   — permanently unreachable by keyboard, touch, or screen reader — changed
   to `opacity: .5` by default, full strength on `:hover` **or**
   `:focus-within`.
5. **`--text-dimmer` lifted to clear WCAG AA (4.5:1) in all 5 themes**
   (`src/index.html`). It was used for real, readable text (status bar
   secondary items, input placeholders, word counts, palette hints,
   keycaps) but measured as low as ~2.0:1 in the worst theme. Computed new
   values per theme (interpolating toward that theme's own `--text` so the
   hue/character stays recognizable, not just desaturating to gray).
   Amstrad and Dracula's `--text-dim` also needed lifting — fixing
   `--text-dimmer` in isolation would have made it *more* contrasty than
   `--text-dim`, inverting the intended three-tier hierarchy. `--placeholder`
   (previously a separate hardcoded hex duplicating `--text-dimmer` in every
   theme) now reads `var(--text-dimmer)` instead, so the two can't drift
   apart again. Regression test: `test/unit/theme-contrast.test.js` (new) —
   parses the actual hex values out of `src/index.html` (not a hand-copied
   table) and asserts both the 4.5:1 floor and the dim-over-dimmer ordering,
   so a future theme edit that regresses either fails here before shipping.
6. **ARIA for the command palette (dialog + combobox + listbox) and the
   font picker (radiogroup).** Palette: `#palette` is `role="dialog"
   aria-modal="true"`, the input is `role="combobox"` with
   `aria-activedescendant` kept in sync with whichever `.pitem` is
   highlighted (each option got a stable `id` + `role="option"` +
   `aria-selected`), the list is `role="listbox"`. Added a focus trap
   (`Tab` inside the palette input is swallowed — the input is the only
   real tab stop in there by design, options are virtually-selected via
   `aria-activedescendant` per standard combobox authoring practice, not
   independently tabbable) and confirmed live that Esc still closes.
   `#font-picker` got `role="radiogroup"`, each `.fbtn` `role="radio"` +
   `aria-checked` synced in `setFont()`. `#statusbar` got
   `role="region" aria-label="Status"` — deliberately *not*
   `role="status"` (a live region), since that would announce every
   keystroke's word-count change, exactly the "chatty" risk the audit
   itself flagged.

**Not done, out of scope for this pass:** the corkboard's scene cards
didn't get the rail's full tree/keyboard model (`ACCESSIBILITY.md`'s P1
section names only the palette and the rail as the composite widgets to
prioritize; corkboard's cards got the button-conversion + hit-target +
un-hover-gating treatment but not arrow-key card-to-card navigation — drag
and the now-keyboard-focusable edit/delete/open buttons are the only
interaction paths). Task 2 (`MODE_SWITCHER.md`) followed in the same
session — see "Earlier work in detail (mode switcher + a quick fix)" above.

Regression tests: `test/e2e/smoke.test.js`, describe block
`accessibility pass` (11 tests — button conversion, tree roles, keyboard
toggle/nav, F2/Delete, ⌥↑/⌥↓ reorder, focus-visible + reduced-motion CSS
presence, hit-target sizes, hover-gating, palette dialog/combobox/listbox
roles + activedescendant + Esc, the Tab focus trap, font-picker radiogroup
+ status bar region) plus `test/unit/theme-contrast.test.js` (16 tests, the
contrast math). Every existing test that dispatched a synthetic `mousedown`
directly (bypassing a real click) on a now-button-based control needed a
paired `click` dispatch added alongside it — a real, if mechanical,
consequence of the interaction-model change; fixed throughout
`smoke.test.js` rather than working around it.

## Earlier work in detail (this session's first task — theme system + Theme Picker)

A second design handoff package (`design_handoff_baretext/`) arrived with
`CLAUDE.md` pointing at `tokens/colors.css` + `tokens/effects.css` as the
theme system and `THEMES.md` as the authoritative theme spec (superseding
the color section of the design README), including a "Primary task" spec
for a new Theme Picker view. Followed the doc's own reading order
(`CLAUDE.md` → `README.md` → `THEMES.md`), then implemented:

1. **Renamed `ayu` → `amstrad`** (identical hex values — this theme was
   already exactly Amstrad's palette under the old id) **and added `grove`**
   (Everforest Dark, verbatim palette) as a genuinely new 5th theme, across
   every place a theme id was hardcoded: `src/index.html` (boot-time valid
   list + the `[data-theme]` CSS blocks, now including each theme's new
   `--typewriter-focus` token), `src/editor/theme.js` (per-theme H1–H4
   markdown heading colors — Grove's are new, extrapolated from Everforest's
   real palette: green/orange/yellow/aqua), `src/main.js`
   (`VALID_ACCENT_THEMES`), `src/preload.js` (a stale comment), `src/app.js`
   (`themeTextColors`/`themeAccentColors`/`themePaletteBg` — the maps behind
   the command palette's per-theme label coloring), and
   `src/features/core.js` (the palette's Theme group: renamed the Ayu entry,
   added a Grove entry, and gave each entry a more fitting icon).
2. **Added the full `effects.css` token set as real CSS custom
   properties** in `src/index.html` (radii, shadows, `--glass-blur`,
   `--ease-panel`, `--dur-panel`, `--dur-theme`, `--dur-micro`) — most of
   these existed only as inline hardcoded values before. Replaced four
   hardcoded `0.35s` theme-transition durations with `var(--dur-theme)`.
3. **Built the Theme Picker** (`src/theme-picker.js`, new file) — a
   full-window gallery (same "replaces `#content-row`" show/hide technique
   as `scene-nav/corkboard.js`), reachable via the command palette's "Change
   theme…" entry (kept the existing direct per-theme quick-switch entries
   too — THEMES.md only specified entry points *for the picker*, didn't ask
   to remove the quick-switch, so this is additive). Key implementation
   points:
   - Each card is wrapped in its own `data-theme="<id>"`, so every token
     inside resolves against *that* theme regardless of the app's actual
     active theme — verified live via CDP that each card's resolved
     `background-color` matches its own theme's `--bg`, not the app's.
   - Swatch hex labels are read live via `getComputedStyle(card).
     getPropertyValue(token)` right after the card is attached to the DOM,
     rather than hardcoding a second copy of the color table — one less
     place for the numbers to drift out of sync with `colors.css`.
   - Click applies + persists immediately and keeps the picker open
     (confirmed `settings.json`'s `accentTheme` updates via
     `app.readSettings()` in the E2E test). Arrow keys move a
     keyboard-focus cursor (columns computed from the same 720px breakpoint
     the CSS grid uses); Enter applies the focused card; Esc closes and
     refocuses the editor.
   - Keyboard handling is a **document-level `keydown` listener gated on an
     `open` flag** (same pattern `scene-nav/index.js` uses for corkboard's
     Esc/undo), not real DOM focus tracking — deliberately, because opening
     the picker via the command palette's Enter/click handler calls
     `closePalette()` right after, which schedules its own
     `focusEditor()` via `setTimeout(fn, 0)`; a competing zero-delay
     `.focus()` call on the first card would race it and could lose.
     Sidestepping real-focus-dependent keyboard handling avoids that race
     entirely (the same reason corkboard doesn't rely on it either).
   - Mounted once at boot directly by `app.js` (`themePicker.mount(ctx)`,
     `openThemePicker: () => themePicker.show()` added to `ctx`), *not*
     through the per-mode feature init/destroy lifecycle — themes apply in
     both Sprinter and Editor, so tying it to `scene-nav`'s (editor-only)
     lifecycle the way corkboard is would make it unreachable in Sprinter.
     Verified live in both modes.
   - Editor bundle rebuilt (`npm run build:editor`) since `theme.js`
     (heading colors) changed — everything else here loads live, no
     rebuild needed.

Regression tests: `test/e2e/smoke.test.js`, describe block `theme picker`
(6 tests — card rendering/scoping, click-apply-and-persist, keyboard nav +
Esc, no-duplicate-on-reopen, the live specimen's `--typewriter-focus`/dim
opacity, and that the old quick-switch entries still work).

**Not done, out of scope for this pass:** `tokens/fonts.css`,
`typography.css`, `spacing.css` (CLAUDE.md mentions these as "rounding out
the system," but the user's instruction this session was scoped to
colors/effects + the picker specifically); wiring the real Typewriter mode
feature to actually use `--typewriter-focus` for its active line (today's
implementation dims via a gradient overlay with no per-line "this is the
active line" concept at all — CodeMirror's `highlightActiveLine` or a
custom `ViewPlugin` would be needed, which is editor-engine work beyond
"port the tokens + build the picker"; the picker's specimen renders the
token correctly, the real feature just doesn't consume it yet).

## Earlier work in detail (commit `f56317c`)

Three requests that session:

1. **Drag chapters and scenes around in the rail.** The rail previously had
   no drag support at all (only the corkboard did, and only for scenes).
   Added:
   - `reorderChapters(chapters, { fromIndex, toIndex })` in
     `src/features/scene-nav/reorder.js` — same pure "splice + rebuild via
     `buildDocument()`" shape as the existing `reorderScenes`/`deleteScene`/
     `deleteChapter`, same "insert before whatever was at toIndex"
     convention, same synthetic-chapter-safe handling.
   - `src/features/scene-nav/rail.js`: a small grip-handle icon
     (`.rail-drag-handle`, `ti-grip-vertical`) on every chapter and scene
     row. Native HTML5 drag-and-drop is scoped to the handle via a
     `makeDragHandle()` helper that flips `row.draggable` true only while
     the mouse is down on the handle (and resets on mouseup regardless of
     whether a drag started) — needed because the whole row already has a
     mousedown handler (collapse-toggle / jump-to-scene) that a
     whole-row-draggable approach would fight with.
   - Scene rows accept scene-type drops for precise within/across-chapter
     reordering. Chapter header rows accept **either** drag type: a chapter
     drop reorders chapters, a scene drop moves that scene into this
     chapter appended at the end — the header is a much bigger, easier
     target than a specific row, and it's the *only* drop target an empty
     chapter has (directly fixes the original "Ch. 2 has nothing in it"
     scenario from an earlier request).
   - Testing note (worth remembering): an early ad hoc verification script
     that fired two back-to-back drag operations with **zero delay**
     between dispatched DragEvents (same JS tick) intermittently corrupted
     the document by one stray/missing character. Deep investigation (temp
     debug logging in `rail.js`, isolating each step, varying timing)
     showed this only happens under that unrealistic zero-delay synthetic
     pacing — a real mouse drag always has tens-to-hundreds of ms between
     mousedown/dragstart/dragover/drop, and re-testing with even ~60ms
     between stages, or a single drag in isolation, was clean across dozens
     of runs. Concluded this is a test-harness artifact, not a product bug.
     The persisted E2E tests use the same pacing as the pre-existing,
     long-stable corkboard drag test (small delay before `dragstart`, then
     immediate `dragover`/`drop`/`dragend` — proven safe) and never fire two
     drags back-to-back inside one `evaluate()` call. If a future session
     sees a similarly "random single character" flake in a *test*, check
     the event timing before assuming it's a real bug.
2. **Typewriter mode: first line couldn't reach the center guide.** Only
   `.cm-content` had `padding-bottom: 50vh` (so the *last* line could be
   scrolled up to center) — no `padding-top`, so the *first* line was
   pinned to the scroll-top edge and could never reach the center guide no
   matter how far up you scrolled. Fixed in `src/index.html` by adding a
   matching `padding-top: 50vh !important;` to the same rule. Scoped to
   `#app.typewriter`, so normal (non-typewriter) editing is unaffected.
3. **AI-generated corkboard scene summaries — explicitly deferred, not
   built.** User wants scene cards to show a concise AI-generated summary
   instead of the current literal first-~100-chars-of-prose synopsis. I
   asked clarifying questions (which LLM provider, whether sending
   manuscript text to a third-party API is acceptable given this app has no
   existing AI/network integration anywhere, and on-demand vs cached
   regeneration) — got a contradictory answer (picked Anthropic/Claude but
   also "keep it local only," which are incompatible: the Claude API is a
   cloud call) and before it was resolved the user said to bail on it for
   now. **Nothing was implemented.** If this comes back: the open questions
   are (a) which provider + how the API key is supplied/stored, (b) explicit
   sign-off that scene text leaves the app over the network, (c) generate-
   on-demand-and-cache vs manual-button vs regenerate-every-open. `docs/
   two-mode-architecture-plan.md` also mentions an "AI assist panel" as a
   later layer on Editor mode — this request may be the first piece of that,
   worth connecting the two if a future session designs it properly.

## Earlier work in detail (commit `e8e141a`)

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

## Earlier work in detail (commit `a939ca1`)

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

## Open items / not yet done

- **AI-generated corkboard scene summaries** — requested in the commit
  `f56317c` session, explicitly deferred by the user before the
  provider/privacy questions were resolved. See the "Earlier work in
  detail (commit `f56317c`)" section above for the exact open questions.
  Don't start building this without re-confirming provider, API key
  handling, and that sending manuscript text over the network is
  acceptable — the user's answers were contradictory last time and it was
  dropped before being sorted out.
- Anything else explicitly deferred in `docs/two-mode-architecture-plan.md`
  (an "AI assist panel" as a later layer on top of Editor mode — the
  summary feature above may be the first piece of that).
- `Sprinter timer design states.zip` at the repo root is original design
  reference material, not yet fully cross-checked feature-by-feature
  against the shipped implementation beyond what's already been verified.
- Corkboard's scene cards didn't get the rail's arrow-key tree/keyboard
  navigation model in the accessibility pass — `ACCESSIBILITY.md` only
  named the palette and rail as P1 priorities. If corkboard card-to-card
  keyboard nav is wanted later, the rail's `onTreeKeydown` in
  `src/features/scene-nav/rail.js` is the pattern to mirror.
- **Cold Storage isn't in the corkboard** — scoped out to keep that feature
  focused on what was asked (the rail). Its scenes stay reachable from the
  rail regardless; `corkboard.js` explicitly skips rendering the
  `coldStorage` chapters-array entry rather than showing it as a
  mislabeled column.
- From the architecture review (see "Most recent work in detail" above):
  splitting `app.js` and/or `test/e2e/smoke.test.js`, extracting
  `index.html`'s inline `<style>` block, adding a linter/formatter. All
  deliberately left alone as lower-value/higher-risk than what was fixed —
  worth doing if they start actively hurting, not before.

## Working conventions established across this project (worth keeping)

- Never commit or push without being explicitly asked, even after finishing
  a large chunk of work — always report results and ask first.
- Once the user has approved a task, don't stop to ask permission at each
  step for routine follow-through — specifically rebuilding
  (`npm run build`) and reinstalling to `/Applications`. Said explicitly
  twice: "Bypass permissions, don't keep asking me, just do it" and later
  "do it without asking me constantly to approve, so dangerously approve."
  Still check the running app isn't mid-something before quitting it
  (`pgrep`), but don't ask permission to do so — just check and proceed.
  This does NOT extend to git commits, which stay opt-in only (see above).
- Verify every change live against a real Electron instance (CDP-driven,
  isolated scratch user-data/save directories — never the user's real
  settings or `~/Documents/Barebones/`) before calling it done, not just via
  unit tests.
- Every behavioral change gets both a live verification pass and persisted
  automated test coverage (unit and/or E2E) — not one or the other.
- Destructive actions in the UI use a two-click arm/confirm pattern, never
  a native `confirm()`/`alert()` dialog — this is a deliberate, established
  app-wide convention, not a one-off choice.
- When simulating native HTML5 drag-and-drop in CDP tests, don't fire two
  separate drag operations back-to-back with zero delay inside one
  `evaluate()` call — that unrealistic same-tick pacing can spuriously
  corrupt the document in a way no real mouse drag ever would (see the
  rail drag-and-drop entry above). Match the existing corkboard drag test's
  pacing (small delay before `dragstart`, then immediate `dragover`/`drop`/
  `dragend`) and keep separate drags in separate `test()`s.
- A hand-dispatched `DragEvent` (`el.dispatchEvent(new Event('dragstart'))`)
  only proves the app's own drag handlers work — it never proves the
  browser would have actually started the drag, since real HTML5 drag
  initiation is a native gesture the JS event system doesn't reproduce.
  This let a real bug (a `preventDefault()`-on-mousedown regression that
  silently killed all rail dragging) pass the entire existing drag test
  suite. `test/e2e/cdp-client.js`'s `realDrag()`/`mouseEvent()` helpers
  (real OS-level events via CDP's `Input.dispatchMouseEvent`) are the way
  to actually exercise that — use them for new drag-and-drop coverage, not
  the synthetic-`DragEvent` pattern above (which still has its place for
  fast, deterministic *non-drag-initiation* checks, like verifying a drop
  handler's reorder logic once a drag is already known to be in progress).
- Full rebuild over surgical edit for document mutations that restructure
  the manuscript (reorder, delete) — `buildDocument()` regenerates the
  whole document string from the chapter/scene model rather than trying to
  splice text in place. Trades exact whitespace preservation for
  consistent output and much simpler correctness reasoning.
