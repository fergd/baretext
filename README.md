# Baretext

Distraction-free writing for Mac, with live markdown styling, a chapter/scene
rail and corkboard, spellcheck, find/replace, and a sprint timer for focused
writing sessions.

Baretext has two modes:
- **Sprinter** — the minimal writing surface: markdown editor, typewriter
  focus mode, and the sprint timer. No navigation chrome.
- **Editor** — the same writing surface plus the chapter/scene rail,
  corkboard, find/replace, and spellcheck, for structuring and revising a
  longer manuscript.

Switch between them with ⌘⇧D, the command palette's Mode group, or the
Sprinter/Editor tabs centered in the status bar.

## Quick start (dev mode)
```
nvm use
npm install
npm start
```
`nvm use` reads the included `.nvmrc` file and switches your terminal to
Node 18 automatically — run this every time you open a new terminal tab/window
for this project, even if you've run it before. Skipping this step is the
#1 cause of "Cannot find module" errors if your shell's default Node version
has drifted to something older (common with nvm across terminal restarts).

If `nvm use` says it can't find Node 18, install it once with:
```
nvm install 18
```
then `nvm use` will work from then on.
This now shows "Baretext" in the menu bar and uses the custom Dock icon
while running — no extra build step needed for everyday use.

## Build a real standalone app (recommended)
Dev mode is still technically running the generic Electron binary under the
hood. For a proper double-clickable .app with the icon and name fully baked
in (correct everywhere — Dock, Finder, Spotlight, Cmd+Tab):

```
npm install
npm run build
```

This creates `dist/mac/Baretext.app`. Drag it into `/Applications` and
launch it like any other Mac app. From then on you can skip `npm start`
entirely — just open Baretext from Launchpad or Spotlight.

Re-run `npm run build` any time you want to update the packaged app after
making changes.

## Editor internals (src/editor/)
The text-editing engine (markdown live-preview, scene-break/block-spacing
rendering, search, spellcheck, typewriter focus-dimming) is real source in
`src/editor/`, built with CodeMirror 6 packages and compiled to
`src/editor-bundle.js` via esbuild:

```
npm run build:editor
```

`src/editor-bundle.js` is committed, so a plain `npm install && npm start`
works without this step — only run `build:editor` after changing anything
under `src/editor/`. The rest of the app (`src/app.js`, `src/features/`)
reads `src/editor-bundle.js` directly and doesn't need rebuilding.

## Markdown styling
Type markdown and it styles live — `# Heading` becomes a large heading, `**bold**`
shows bold, `*italic*` italic, `` `code` `` is tinted, etc. Press ⌘⇧M to toggle
between seeing the raw markdown symbols and a cleaner "rendered" view that hides
them. Files always save as plain markdown regardless of view mode.

## Chapters and scenes (Editor mode)
Chapters are `# Heading` lines; scenes within a chapter are `---` breaks (or
`##`/`###` sub-headings, which use their own heading text as the scene
title). Two views onto the same manuscript model:

- **Rail** — an always-visible left sidebar. Collapsible chapter rows, each
  with a per-chapter "add scene" row so a new scene lands in the chapter you
  clicked, not always at the end of the manuscript. Click a scene to jump to
  it. Drag the grip handle on a chapter or scene row to reorder — drag a
  scene onto another chapter's header to move it there (the easiest way to
  get a scene into a currently-empty chapter), or onto another scene row for
  precise positioning within a chapter. Fully keyboard-operable too: it's a
  real ARIA tree — ↑/↓ move between rows, ←/→ collapse/expand a chapter,
  Enter/Space activates, F2 renames, Delete arms the delete confirm, and
  ⌥↑/⌥↓ reorders the focused row without touching the mouse.
- **Corkboard** (⌘⇧C) — a full-window card view for restructuring: drag
  scene cards to reorder within or across chapters. Interacting with a card
  (creating, editing, dragging, deleting) never navigates away — the
  corkboard stays open until you dismiss it (Esc) or click a card's
  "open in manuscript" button to jump to that scene deliberately.

A chapter with no title yet shows a non-persisted "Chapter N" placeholder
(in both the rail and the editor) instead of rendering blank — it's a
default label, not a saved value, so typing a real title replaces it.

Chapters and scenes can be deleted from either the rail or the corkboard:
click the delete icon once to arm it (it turns red), click again within a
few seconds to confirm. There's no native confirmation dialog by design —
undo (⌘Z) is the safety net.

## Backup
Every save is also committed to a local git repo alongside your save
directory (`src/backup.js` + `src/backup-providers/local-git.js`), so you
always have version history independent of the file itself. This is
provider-based — adding real cloud sync later means writing one more
provider module with the same `init`/`onSave`/`flush` shape.

## Shortcuts
- ⌘K — command palette (everything lives here)
- ⌘B / ⌘I — bold / italic selected text
- ⌘S — save
- ⌘N — new file
- ⌘O — open file
- ⌘⇧E — export markdown
- ⌘⇧M — toggle markdown symbols visible/hidden
- ⌘⇧O — jump to chapter or scene
- ⌘↵ — insert scene break
- ⌘⇧T — typewriter mode
- ⌘⇧F — change font
- ⌘. — focus mode (hide status bar)
- ⌘⇧D — switch between Sprinter and Editor mode
- ⌘⇧S — start (or restore) a writing sprint, Sprinter mode
- ⌘⇧H — hide the sprint timer, Sprinter mode
- ⌘F — find & replace, Editor mode
- ⌘⇧P — toggle spellcheck, Editor mode
- ⌘⇧C — toggle corkboard, Editor mode

The active sprint panel also has a **pause** button (next to minimize/end)
for stopping the countdown without ending the sprint — no shortcut, click
it or use the palette's "Pause sprint" entry. Paused state carries through
minimized and hidden views (the chip reads "paused"; "hidden" still shows
nothing more specific than "sprinting", by design).

## Themes
Five themes, all keyed off the same semantic CSS custom properties
(`tokens/colors.css`-derived — see `src/index.html`'s `:root`/`[data-theme]`
blocks) so every component is theme-agnostic:

| id | display name | one-liner |
|---|---|---|
| `dark` | Ember (native) | amber lamp on charcoal |
| `light` | Parchment | warm parchment, never white |
| `amstrad` | Amstrad | toned-down Amstrad CPC green-phosphor terminal |
| `grove` | Grove | Everforest Dark, verbatim palette |
| `dracula` | Dracula | the standard Dracula palette |

Switch instantly from the command palette (each theme is its own quick-switch
entry), or open the full **Theme Picker** — palette → "Change theme…" — a
gallery of all five, each card rendered live in its own theme with a swatch
row and a mini writing-surface specimen (including the Typewriter focus
line) so you can judge a theme in context, not just as color chips. Click a
card to apply it immediately (picker stays open so you can keep comparing);
arrow keys move between cards, Enter applies, Esc closes.

Files auto-save to ~/Documents/Barebones/ (change via "Set save location" in
the command palette). The app reopens your most recently edited file on launch.

## Architecture
- `src/main.js` / `src/preload.js` — Electron main process: window, file
  I/O, save-location, backup hook-up.
- `src/app.js` — app shell: DOM refs, the CodeMirror view, the command
  palette engine, and mode activation (`activateMode`, mounting/unmounting
  feature modules).
- `src/modes.js` — the two-mode registry (`sprinter` / `editor`), each a
  list of feature ids.
- `src/features/*.js` — one self-contained module per feature
  (`sprint-timer`, `find-replace`, `spellcheck`, `scene-nav/`). Each
  exports `{ id, init(ctx), destroy(), commandGroups(), keybindings() }`;
  `ctx` gives it the CodeMirror view, `window.api`, and shared helpers like
  `getDoc`/`setDoc`. Adding a new feature means adding one file here plus
  one line in `modes.js`.
- `src/theme-picker.js` — the Theme Picker view. Mode-agnostic (themes apply
  in both Sprinter and Editor), so unlike `src/features/`, it's mounted once
  at boot directly by `app.js` rather than through the per-mode feature
  lifecycle. Same `mount`/`show`/`close`/`toggle`/`isOpen` shape as
  `scene-nav/corkboard.js`.
- `src/editor/` — the CodeMirror 6 engine itself (markdown live-preview,
  scene-break/block-spacing rendering, search, spellcheck, outline
  parsing, typewriter focus-dimming), compiled to `src/editor-bundle.js`
  via esbuild (`npm run build:editor`). This is the one layer that needs a
  rebuild step — `src/app.js` and `src/features/` load the bundle directly
  and don't.
- `docs/` — design/architecture reference docs (theme tokens, the
  Sprinter/Editor mode split). `PROGRESS.md` (repo root) is a running log
  of what's been built and what's next, meant to be read at the start of a
  new session.

## Accessibility
Every interactive control is a real, keyboard-operable `<button>` (or, for
the rail's rows, a proper ARIA `treeitem`) — nothing is mouse-only. A global
`:focus-visible` ring shows on keyboard focus (never on a mouse click), and
`prefers-reduced-motion` collapses animations/transitions to near-instant
system-wide, including stopping the sprint panel's pulsing dot. The command
palette is a `dialog`/`combobox`/`listbox` with a focus trap; the font
picker is a `radiogroup`; the scene rail is a full `tree` (see the rail
bullet above for its keyboard model); the status-bar mode switch is a
`tablist` (←/→ move focus, Enter/Space activates). All 5 themes' `--text-dimmer` clears
WCAG AA (4.5:1) against both `--bg` and `--bg-alt` — regression-tested in
`test/unit/theme-contrast.test.js` against the actual theme values, not a
hand-copied table.

## Testing
```
npm test          # unit + E2E
npm run test:unit # pure-function tests (test/unit/) — no Electron needed
npm run test:e2e  # drives a real Electron instance via CDP (test/e2e/)
```
E2E tests launch the app with an isolated scratch user-data/save
directory — they never touch your real settings or `~/Documents/Barebones/`.
The window also never shows or steals focus (`BARETEXT_HIDDEN=1`, read in
`src/main.js`) — CDP drives the renderer directly and doesn't need it
visible.
