# Baretext

Distraction-free writing for Mac, with live markdown styling.

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

## Shortcuts
- ⌘K — command palette (everything lives here)
- ⌘B / ⌘I — bold / italic selected text
- ⌘S — save
- ⌘N — new file
- ⌘O — open file
- ⌘⇧E — export markdown
- ⌘⇧M — toggle markdown symbols visible/hidden
- ⌘⇧O — jump to chapter or scene
- ⌘⇧— — insert scene break
- ⌘⇧T — typewriter mode
- ⌘⇧F — change font
- ⌘. — focus mode (hide status bar)
- ⌘⇧D — switch between Sprinter and Editor mode
- ⌘⇧S — start (or restore) a writing sprint, Sprinter mode
- ⌘⇧H — hide the sprint timer, Sprinter mode
- ⌘F — find & replace, Editor mode
- ⌘⇧P — toggle spellcheck, Editor mode

Themes (dark / light / ayu / dracula) are in the command palette, along with
everything else.

Files auto-save to ~/Documents/Barebones/ (change via "Set save location" in
the command palette). The app reopens your most recently edited file on launch.
