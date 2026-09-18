# Baretext

Distraction-free writing for Mac, with live markdown styling, a chapter/scene
rail and corkboard, find/replace, and a sprint timer for focused
writing sessions.

Baretext has two modes:
- **Sprinter** — the minimal writing surface: markdown editor, typewriter
  focus mode, and the sprint timer. No navigation chrome.
- **Editor** — the same writing surface plus the chapter/scene rail,
  corkboard and find/replace, for structuring and revising a
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
rendering, search, typewriter focus-dimming) is real source in
`src/editor/`, built with CodeMirror 6 packages and compiled to
`src/editor-bundle.js` via esbuild:

```
npm run build:editor
```

`src/editor-bundle.js` is committed, so a plain `npm install && npm start`
works without this step — only run `build:editor` after changing anything
under `src/editor/`. The rest of the app (`src/app.js`, `src/features/`)
reads `src/editor-bundle.js` directly and doesn't need rebuilding.

## Writing surface
Headings, emphasis, links, code, and lists stay formatted while editing.
Moving the caret or selecting text never exposes Markdown syntax, and there
is no source-view toggle. Blank lines remain visible and writable, including
beside chapter and scene headings. Files still save as plain Markdown.

## Chapters and scenes (Editor mode)
Use the copy icon beside rename on a rail row or corkboard card/header to copy
a scene or an entire chapter. The clipboard includes titles and Markdown
formatting, but excludes private book-title, cold-storage, and scene-link records.
Copying a linked scene copies that scene alone.

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

To link scenes, click **link** on a corkboard card, then click anywhere on
another card. Eligible cards have a dashed outline; **cancel** or Escape
exits selection. Cards can be in different chapters and stay in place until
you drag a member, which moves the group together in manuscript order.
Use **unlink** on a card to remove it from its group. Links support undo and
survive reopening. Deleting a scene still deletes only that scene.

A chapter with no title yet shows a non-persisted "Untitled" placeholder
(in both the rail and the editor) instead of rendering blank. Named chapters
always show the writer's text verbatim; Baretext does not add "Part N" or
another generated prefix.

The rail header defaults to the Markdown filename (without `.md`). Clicking
that title creates an independent book title at the beginning of the
manuscript without renaming the file. The rail and manuscript are two editors
for that same title, so changing either updates the other.

Chapters and scenes can be deleted from either the rail or the corkboard:
click the delete icon once to arm it (it turns red), click again within a
few seconds to confirm. There's no native confirmation dialog by design —
undo (⌘Z) is the safety net.

## Backup
Every save is also committed to a local git repo alongside your save
directory (`src/backup.js` + `src/backup-providers/local-git.js`), so you
always have version history independent of the file itself. This is
provider-based — a second provider now covers real cloud sync.

**Google Drive** (`src/google-drive.js` + `src/google-drive-auth.js` +
`src/google-drive-api.js` + `src/backup-providers/google-drive.js`) mirrors
every manuscript in your save folder to Google Drive — a "Baretext Backups"
folder by default, or one you pick yourself — rate-limited like local-git
(at most once per 5 minutes of activity, plus one attempt on quit). Requires
a one-time setup:

1. In [Google Cloud Console](https://console.cloud.google.com), create a
   project, enable the **Google Drive API**, and add an **OAuth consent
   screen** (**External** user type — Internal is only offered for
   Workspace-linked accounts and, confusingly, can appear as the default
   even on a personal account; Testing publishing status — add your own
   account as a test user, no verification needed for personal use).
2. On the consent screen's **Data Access** tab, explicitly add the
   `https://www.googleapis.com/auth/drive.file` scope (find it under
   "Google Drive API" once that API is enabled, or paste the scope URL into
   "Manually add scopes" if it doesn't show up) — a scope requested by the
   app but not declared here gets silently dropped from the granted token,
   which surfaces later as a Drive API "insufficient authentication scopes"
   error rather than as anything at consent time.
3. Create an **OAuth client ID** of type **Desktop app**.
4. In Baretext, open **Baretext → Backup Settings…**, paste the Client ID
   and Secret, click **save**, then **connect google drive** to sign in.
   (If you change the Data Access scopes after already connecting once,
   disconnect and reconnect — an existing grant doesn't retroactively pick
   up newly-added scopes.)

The Client ID/Secret and refresh token are encrypted with macOS Keychain,
same as the OpenAI key below; Baretext only ever sees files/folders it
creates itself or that you explicitly pick (`drive.file` scope), never the
rest of your Drive.

**Choosing the backup folder** — by default Baretext finds-or-creates
"Baretext Backups" at the root of your Drive. To point it at an existing
folder instead:

1. Enable **Google Picker API** in the API Library (separate from the Drive
   API above).
2. Credentials → Create Credentials → **API key**, then restrict it to just
   the Picker API.
3. Paste that key into Backup Settings' **Picker API key** field and
   **save**. A **choose folder…** button then appears once connected —
   Google's own folder picker opens, and Baretext only gains access to
   whatever you select there (still `drive.file` scope — this is the
   standard, narrow way to grant an app access to one existing item without
   widening its Drive permissions). **use default** reverts to the
   auto-managed "Baretext Backups" folder. If a chosen folder is later
   deleted or trashed in Drive, Baretext surfaces a clear error rather than
   silently falling back to the default folder.

## AI helpers (personal builds)
The Editor corkboard has optional, on-demand AI helpers:

- **summarize all** in the corkboard toolbar generates concise summaries for
  every scene card;
- each card also has its own summarize action;
- **suggest name** actions beside scene and chapter titles offer three naming
  suggestions, and only apply one when you click it.

Choose **Baretext → AI Settings…** (or **AI settings…** in the command
palette) and save an OpenAI API key. Electron encrypts it through macOS
Keychain; the renderer can replace or remove the key but can never read it
back. The same panel accepts examples under **titles I like**; Baretext uses
them together with the book, chapter, neighboring scenes, and existing title
vocabulary when suggesting names. `OPENAI_API_KEY` remains available as a development-only fallback.
`BARETEXT_AI_MODEL` can optionally override the default `gpt-5.6-luna`.
Naming uses `gpt-5.6-terra` with low reasoning by default and can be overridden
separately with `BARETEXT_AI_NAMING_MODEL`.
Requests are made only after an explicit click. Credentials and provider
logic stay in Electron's main process, and responses use strict structured
output. Scene summaries are cached locally by a hash of their prose, so an
unchanged scene is not sent again; editing it naturally invalidates the
cached result. Applied AI summaries and names surface an immediate undo
action; undoing a summary removes its cache entry too. The provider boundary lives in `src/ai.js` and
`src/ai-providers/`, ready to swap to a hosted service before distribution.

## Shortcuts
- ⌘K — command palette (everything lives here)
- ⌘B / ⌘I — bold / italic selected text
- ⌘S — save
- ⌘P — print
- ⌘N — new file
- ⌘O — open file
- ⌘⇧E — export markdown
- ⌘⇧O — jump to chapter or scene
- ⌘↵ — insert scene break
- ⌘⇧T — typewriter mode
- ⌘⇧F — change font
- ⌘. — focus mode (hide status bar)
- ⌘⇧D — switch between Sprinter and Editor mode
- ⌘⇧S — start (or restore) a writing sprint, Sprinter mode
- ⌘⇧H — hide the sprint timer, Sprinter mode
- ⌘F — find & replace, Editor mode
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
  (`sprint-timer`, `find-replace`, `scene-nav/`). Each
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
  scene-break/block-spacing rendering, search, outline
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

Sprinter is a temporary writing session: choose the Sprinter tab to set up a sprint.
Canceling setup, ending the sprint, or reaching the timer limit returns to Editor
at the cursor. Fresh launches open Editor. Re-select Sprinter to reveal a hidden
or minimized timer; there is no duplicate sprint control in the footer.

## Icons
The interface uses locally bundled Lucide SVGs in `src/icons/lucide/`, including
the rail controls. `src/icons/lucide.css` renders them as CSS masks that inherit
the control color and font size. No icon font or icon CDN is required. The
vendor version and license are recorded beside the assets.
