# Two-mode architecture: Sprinter + Editor

## Context

Baretext is meant to have two modes: **Sprinter** (today's minimal, distraction-free
writer, eventually with a sprint timer) and **Editor** (same writing surface, but with
find/replace, spellcheck, scene/chapter cards, and later an AI assist panel layered on
top). Right now there's only one mode, and all of its behavior — file commands, theme,
font, typewriter/focus mode, markdown toggle, scene break, outline jump, and the command
palette engine itself — lives in one 600-line inline `<script>` block in `src/index.html`.

Before any Editor-only feature gets built, the app needs a foundation where a "feature"
(find/replace, spellcheck, scene cards, AI, ...) is a self-contained module that a mode
can list as on or off, instead of every feature growing the same flat script. This plan
scaffolds that foundation and moves *existing* functionality into it. **It does not build
any new Editor feature** (no find/replace, no spellcheck, no cards, no AI) — those become
follow-up sessions once each is designed, and each should only require adding one new file
plus one line in the mode registry.

Out of scope / untouched: `src/backup.js`, `src/backup-providers/`, the app icons, and
`electron-builder` packaging — all currently mid-flight uncommitted work, unrelated to this.

## Architecture

**App shell** — `src/app.js` (new), loaded via `<script type="module" src="app.js"></script>`,
replacing the current inline script in `index.html`. Owns everything that isn't tied to a
specific feature: DOM refs, CodeMirror view creation, the command-palette engine
(render/open/close/keyboard nav — currently `index.html:800-1031`), toast, outline rendering,
font-picker wiring, the global keydown fallback, and the `window.api.onFileLoaded` /
`onAutoSaved` / `onSaveConfirmed` listeners. It also owns mode activation:

```js
function activateMode(modeId) {
  // destroy() every feature in the outgoing mode, init() every feature in the incoming one,
  // merge their commandGroups into the palette's `commands` array,
  // merge their keybindings into window.BaretextEditor.registerKeys(),
  // re-render the palette, update the status-bar mode label, persist via window.api.setMode
}
```

Each feature receives a shared `ctx`: `{ view, editor: window.BaretextEditor, api: window.api,
state, showToast, getDoc, setDoc, focusEditor }`.

**Feature module shape** — `src/features/*.js`, one per feature, default export:
```js
export default {
  id: 'find-replace',
  commandGroups: [...],   // same {group, items:[{label, icon, keys, fn}]} shape the palette uses today
  keybindings: {...},     // merged into registerKeys()
  init(ctx) {},           // mount UI / wire listeners when the feature turns on
  destroy(ctx) {},         // tear down when the mode switches away
}
```

**`src/features/core.js`** (new) — the current functionality (file ops, theme, font,
typewriter, focus mode, markdown source/preview toggle, scene break, outline jump —
`index.html:611-761`) extracted verbatim into this shape. It's the one feature every mode
includes.

**`src/modes.js`** (new):
```js
export const DEFAULT_MODE = 'sprinter';
export const MODES = {
  sprinter: { id: 'sprinter', label: 'Sprinter', features: ['core'] },
  editor:   { id: 'editor',   label: 'Editor',   features: ['core'] }, // features land here later
};
```
Adding find/replace later is: write `src/features/find-replace.js`, add `'find-replace'`
to `editor.features`.

**Mode switching UX**:
- New "Mode" group in the command palette: "Switch to Sprinter" / "Switch to Editor",
  checkmark on the active one (same pattern as the existing Theme group).
- Shortcut `⌘⇧D` toggles between the two (only unused `Mod-Shift-*` binding left).
- Status bar gains a mode label next to the file name (same dim styling as `#md-mode`).

**Persistence** — mirrors the existing `accentTheme` pattern exactly:
- `src/main.js`: add `mode` to `settings.json` (validated against `['sprinter','editor']`,
  default `sprinter`), pass it through the same query-string mechanism used for `theme`
  (`loadFile(..., { query: { theme, mode } })`) so a mode with visible chrome (Editor,
  later) never flashes the wrong layout on launch, and add an `ipcMain.on('mode-changed', ...)`
  handler that persists it.
- `src/preload.js`: add `setMode: (mode) => ipcRenderer.send('mode-changed', mode)`.
- `index.html`'s existing pre-paint script (currently only reads `?theme=`) also reads
  `?mode=` and sets `data-mode` on `<html>` for CSS hooks.

**`index.html` changes**: strip the inline script down to the DOM skeleton + the module
script tag; keep the pre-paint theme script, extended for mode. No CSP change needed —
`script-src 'self'` already covers local module files.

## Files touched

1. `src/index.html` — remove inline script body, add `data-mode`/`?mode=` read, add
   `<script type="module" src="app.js">`
2. `src/app.js` (new) — shell described above
3. `src/modes.js` (new) — mode registry
4. `src/features/core.js` (new) — today's functionality, wrapped
5. `src/main.js` — `mode` in settings + IPC handler + query string
6. `src/preload.js` — `setMode` bridge

## Verification

- `npm start`: Sprinter mode should behave identically to today — typing, autosave,
  every existing shortcut, outline jump, themes, fonts, typewriter/focus mode.
- Switch to Editor via palette and via `⌘⇧D`; confirm the status bar label updates.
- Quit and relaunch; confirm it reopens in whichever mode was last active
  (`settings.json` has `mode` set).
- Confirm autosave/backup still fires on `content-changed` — unchanged code path, just
  now owned by `core.js` instead of inline script.

## For screen design (Sprinter vs. Editor)

Current UI surface, for reference while mocking up Editor mode:
- Single-pane editor (`#editor-host`) filling the window below a draggable titlebar
- Thin status bar: word count, char count, markdown mode (preview/source), save-error dot, filename
- `⌘K` command palette (glass panel, grouped list: File / Navigate / Insert / View / Theme)
- `⌘⇧O` outline jump (same palette, filtered to headings + scene breaks)
- Floating font picker (mono/serif/sans), bottom-center
- Toast notifications, bottom-center
- Typewriter mode (centers cursor line) and Focus mode (hides status bar)
- 4 themes: dark, light, ayu, dracula — all via CSS custom properties

Editor mode needs to add, without disturbing the Sprinter layout underneath:
- Find/replace (likely a dismissible bar, not a modal — shouldn't block typing flow)
- Spellcheck (inline squiggles via CodeMirror, no separate panel expected)
- Scene/chapter cards (a new panel/view — sidebar? separate pane? modal grid? this is
  the open design question)
- AI riffing/tasks panel (later — likely shares layout space with scene cards)
