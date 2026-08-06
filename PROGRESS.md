# Baretext — progress log

A running record of what's been built, in what order, and what's still open.
Read this at the start of a new session to pick up where things left off —
it's context, not a spec; the code and `git log` are the source of truth for
exact behavior.

Also see: `README.md` (how to run/build/test, feature overview),
`docs/two-mode-architecture-plan.md` (the Sprinter/Editor mode split),
`docs/theme-spec.md` (design tokens), `TYPEWRITER_MODE.md` (typewriter
focus-mode spec).

## Where things stand (as of 2026-08-06)

Both Sprinter and Editor mode are feature-complete against the original
design handoff, and a full accessibility pass (`design_handoff_baretext/
ACCESSIBILITY.md`, task 1 of that handoff's suggested order) has landed:
every span/div+mousedown control converted to a real, keyboard-operable
`<button>`, a scene-rail keyboard/tree model (arrow-key nav, F2 rename,
Delete arm, ⌥↑/⌥↓ reorder), a command-palette dialog/combobox/listbox ARIA
pattern with a focus trap, WCAG AA contrast fixes across all 5 themes, hit
targets, and `prefers-reduced-motion` support. Full test suite: 105 unit +
67 E2E, all passing, stable across repeated runs. Nothing is mid-flight or
half-implemented — the next session starts from a clean slate unless new
requests come in. One idea was raised and explicitly deferred, not started:
see "Open items" below (AI-generated corkboard summaries). **Nothing from
this session (theme system, hidden test windows, accessibility pass) is
committed yet.**

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
    this session, most recent) — see below.

## Most recent work in detail (this session — accessibility pass)

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
interaction paths). Tasks 2 (`MODE_SWITCHER.md` — bottom-bar mode switcher)
from the handoff's suggested order is not started.

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
- Corkboard drag-to-reorder across chapters — implemented, but hasn't had
  the same depth of adversarial E2E testing as the delete feature did; if
  bugs turn up in that area, that's likely why.
- Anything else explicitly deferred in `docs/two-mode-architecture-plan.md`
  (an "AI assist panel" as a later layer on top of Editor mode — the
  summary feature above may be the first piece of that).
- `Sprinter timer design states.zip` at the repo root is original design
  reference material, not yet fully cross-checked feature-by-feature
  against the shipped implementation beyond what's already been verified.
- **`design_handoff_baretext/MODE_SWITCHER.md`** — task 2 of the current
  handoff's suggested order (a bottom-bar mode switcher turning `#statusbar`
  into a 3-column grid with a centered `role="tablist"` Sprinter/Editor
  switch). Not started; only task 1 (accessibility) was done this session.
- Corkboard's scene cards didn't get the rail's arrow-key tree/keyboard
  navigation model in the accessibility pass — `ACCESSIBILITY.md` only
  named the palette and rail as P1 priorities. If corkboard card-to-card
  keyboard nav is wanted later, the rail's `onTreeKeydown` in
  `src/features/scene-nav/rail.js` is the pattern to mirror.

## Working conventions established across this project (worth keeping)

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
- When simulating native HTML5 drag-and-drop in CDP tests, don't fire two
  separate drag operations back-to-back with zero delay inside one
  `evaluate()` call — that unrealistic same-tick pacing can spuriously
  corrupt the document in a way no real mouse drag ever would (see the
  rail drag-and-drop entry above). Match the existing corkboard drag test's
  pacing (small delay before `dragstart`, then immediate `dragover`/`drop`/
  `dragend`) and keep separate drags in separate `test()`s.
- Full rebuild over surgical edit for document mutations that restructure
  the manuscript (reorder, delete) — `buildDocument()` regenerates the
  whole document string from the chapter/scene model rather than trying to
  splice text in place. Trades exact whitespace preservation for
  consistent output and much simpler correctness reasoning.
