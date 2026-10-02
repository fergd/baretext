# Baretext — Settled Decisions

Decisions agreed with the user (2026-09-28) while planning the fresh build.
Where this file and `AGENT_SPEC.md` disagree, **this file wins** — each
override is marked. Anything not covered here follows the spec. If you want
to change a decision, raise it with the user; don't silently diverge.

---

## 1. Stack and editor architecture

- **Electron + TypeScript + ProseMirror** (ProseMirror used directly, no
  Tiptap). Chosen because the manuscript is a tree (spec §3.1) and
  ProseMirror's schema, transactions, position mapping, and IME handling
  map one-to-one onto the spec's model and invariants (§4.4, §14.2).
- **The ProseMirror document *is* the manuscript model.** Schema:
  `doc → book_title, chapter+, cold_storage`;
  `chapter → chapter_title, scene+`; `scene → scene_heading?, block+`.
  Chapters and scenes are `isolating`. Titles/names are `text*` single-line.
- **Structural guard:** a `filterTransaction` rejects any transaction that
  changes the set or order of chapter/scene identities unless it is tagged as
  an explicit structural command. Fails closed.
- **Render the whole manuscript.** No `content-visibility`, no estimated or
  "remembered" heights, no DOM virtualization — the user rejected these as
  bug-prone. Performance comes from locality: ProseMirror's incremental DOM
  updates, CSS containment on scenes (layout/paint, not size), viewport-only
  decorations, and per-node memoized derived data (WeakMap keyed by node).
- **Performance gate:** a generated 150k-word manuscript must type with
  imperceptible latency (<16ms keystroke-to-paint), open fast, and save
  without stutter. Measure; don't assume.
- **Package layout:** `packages/format` (pure serializer/parser, zero deps,
  most-tested code), `packages/editor` (schema, commands, plugins),
  `app/main`, `app/preload`, `app/renderer`.
- Save pipeline (serialize → parse-back verify → destructive guard →
  recovery copy → temp write + fsync + rename) runs in the **main process**.

## 2. Formatting

- **No inline Markdown.** No input rules that convert typed syntax (`**`,
  `#`, `---`, `>`). Only the spec's `--` → em dash remains.
- Formatting comes from shortcuts (⌘B, ⌘I, ⌘↵ scene break, ⌘⇧↵ pause, ⌥⌘↵
  chapter break), a
  **Linear-style selection toolbar**, and the command palette.
- **Selection toolbar:** appears after a mouse selection settles or a
  keyboard selection pauses; hides on typing, Esc, collapse, or scroll-away;
  never during IME composition. Never steals focus or drops the selection.
  Reflects mark state (incl. mixed). `role="toolbar"`, keyboard-reachable.
  Centered above the selection, flips below near the top, pixel-snapped.
  Proposed contents: Bold, Italic, Link, Add note, Quote/Epigraph.
- **Built (2026-09-29), modeled on Linear's issue editor:** Bold · Italic ·
  Link | Quote. Add note joins when notes exist. Appears on mouse-up (never
  mid-drag) or after a 400ms keyboard-selection pause; ⌘B/⌘I keep it open
  and update it; hides while the selection is scrolled out of view and
  returns with it. Mixed state = accent dash under the icon. Tooltips show
  the shortcut after 500ms. ⌥F10 moves focus into it (arrows move between
  buttons, Esc returns). Link (toolbar button or Format → Link…; no shortcut) swaps the buttons
  for an address field; the selection stays highlighted; Enter applies
  (bare domains get https://, emails mailto:, anything else is refused),
  Esc cancels, Remove clears. Quote wraps/unwraps the selected paragraphs
  within one scene; quoting a scene's last paragraph adds an empty line
  after it (a scene always ends in a plain paragraph).

## 3. Visual system and polish

- Quality bar is **Linear**: precise alignment, consistent states, calm.
- **4px grid** for all spacing, sizes, and positions (strokes such as 2px
  ticks are exempt). Figma values off-grid get rounded (e.g. 26→24/28,
  18→16/20, 21→20).
- Body rhythm: 15/24 (was JetBrains Mono; IBM Plex since 2026-10-01, see §9). Chapter title 40/64, scene title 28/48
  (mono → weight 400, never synthesized bold).
- Text uses `text-box` trimming (cap/alphabetic) for optical centering in
  controls; tabular numerals for counts, timer, numbering.
- Tokens only — a lint rule forbids literal px/colors outside token files.
- Dev-only tools: a grid/baseline overlay, and a hidden component gallery
  rendering every component × state × theme.

### Figma
File `Jst87dEdmvRGn1Jlkz7LST` (Baretext Design System).
- Manuscript: node `2125:518`
- Sprinter: node `2162:805`
Pull exact values from Figma when implementing each component.

### Signature design (must keep)
- **Margin numbers:** chapter (`4`) and scene (`4.2`) numbers hang in the
  left margin, right-aligned toward a centered text column. Same size and
  line-height as their heading, in the **heading's color at reduced
  opacity** (opacity is a token). Baseline alignment is structural: heading
  and number share one grid row/line box. Non-editable, non-selectable,
  `aria-hidden`; clicking one puts the caret in its heading. Hidden in
  Sprinter and when the window is too narrow.
- The right-hand number column in Figma exists only to center the text —
  achieve centering however is cleanest in code.
- The divider inside scene 4.2 without a number in the Figma frame is
  **design drift — ignore it.**

### Tick spine (minimized scene navigator)
- Thin strip at the left edge, vertically centered. One **short** tick per
  scene; the **long** tick is the current scene. Extra gap between chapter
  groups. Clicking a tick navigates to that scene (via the navigation
  controller).
- **When the book is too long to fit:** every non-current chapter collapses
  to **one short tick**. The **current chapter always stays expanded**.
  Clicking a collapsed chapter expands it (animated) into its scene ticks;
  clicking one of those navigates. One extra chapter open at a time.
  Entering a new chapter expands it and collapses the old one.
- Switching between normal/collapsed uses hysteresis (no flicker on resize).
- Each tick owns a full-width hit row (no dead gaps); hover shows number +
  title. If even collapsed chapters don't fit, pitch shrinks to 4px, then
  the spine scrolls.
- **Motion (2026-09-29):** the long tick is one indicator that glides
  (240ms) to the current tick. **Scrolling by hand** (wheel, trackpad,
  scrollbar) makes the spine and breadcrumb follow the scene at the middle
  of the window, expanding chapters as you pass through; typing, moving the
  caret, or choosing a tick hands them back to the caret. Choosing a tick:
  nearby scenes glide into place (FLIP, 360ms, `--ease-jump`); distant ones slide 32px and
  fade up, never a long scroll.
- **The two modes are Manuscript and Sprinter** (2026-09-29; the spec text
  now matches). One name everywhere: UI, docs, code
  (`data-mode="manuscript"`). "Editor" means only the text-editing component
  (`packages/editor`), never the mode.
- **Every launch starts in Manuscript mode with typewriter and focus mode
  off** (2026-09-29; spec §2.2, §6 and §14.1 now match).
  They are per-session and never written to settings; old settings files'
  values are ignored. Theme and paragraph spacing still persist.
- **Esc steps out one layer at a time** (2026-09-29): an open surface
  (link field, selection toolbar; later palette, find, corkboard…) claims
  Esc by stopping the event; only an unclaimed Esc leaves focus mode. Esc
  never enters focus mode and is ignored during IME composition. Every new
  surface that uses Esc must stop propagation (ProseMirror cancels every Esc
  in the editor, so `defaultPrevented` is not a usable signal).
- **Focus mode hides the spine** (fades out over 220ms; no clicks or hover
  while hidden; fades back when focus mode ends). 2026-09-29.
- **Focus is a button, not a switch (user, 2026-10-01):** the status
  bar's "◎ Focus" enters focus mode and goes with the rest of the
  chrome, so a switch you never see "on" was wrong. Entering shows a quiet
  hint, "Esc or ⌘. to leave focus" (the toast, ~2.4s); leaving sooner takes
  it with it.
- **Focus mode vignette (user, 2026-10-01):** the space around the
  manuscript dims toward the window's edges, deepest in the corners, the
  full window height (the emptied title and status bars become page). It
  stays `--vignette-clear` (160px) clear of the text column on each side —
  never over the text or its hanging numbers — and vanishes when the window
  has no room. The page's own color deepened: toward black on dark themes;
  on Light toward its ink at 40% depth (black made a grey smear). Fades
  with focus mode; tested in `modes.test.ts`.
- **Focus mode dissolves the text at the window's top and bottom (user,
  2026-10-01)** instead of cutting it off at the emptied bars: a 32px mask
  on the scroller (`--focus-fade`; no layout change). The caret is kept
  `--focus-caret-margin` (48px) from the edges in focus mode, so the line
  being written is never in the fade. Full bleed (text under the bars) was
  considered and declined as not worth the scrolling/typewriter changes.
- ~~Hovering the spine peeks the outline as glass~~ — **dropped
  (2026-09-30, user):** hover-to-open didn't feel right; the outline opens
  only by a deliberate action. A floating version may return later only as
  its own deliberate action, if at all.
- **Outline (2026-09-30; no Figma frame yet, built from the palette's
  styling and tokens):**
  - A sidebar icon button at the start of the title bar (after the traffic
    lights), ⌘\, View → Outline (checkbox) and the palette's Outline switch
    open and close it as a 296px column (248px when the window is narrower
    than 1,100px, so the page keeps room for its margin numbers; user,
    2026-10-01). The page recenters beside it; the
    caret's line stays put; the spine hides while it is open. The state
    persists (`outline` in settings). The button never takes focus from
    the manuscript.
  - ⌥⌘\ (View → Move to Outline) moves keyboard focus into the tree on the
    current scene, opening it if closed. Esc returns to the manuscript.
    Clicking rows never takes focus from the manuscript.
  - Rows: chevron · number · name · word count. A folded chapter shows
    `scenes · words`. Clicking a chapter's name opens its first scene; the
    chevron folds. Current scene: accent wash; current chapter's number in
    accent. It opens with the current scene in view and is never scrolled
    by a click or refresh.
  - Counts refresh 250ms after typing pauses; structure changes at once.
  - Focus mode hides the column and restores it after (with the same motion).
  - **Motion (2026-09-30, user asked for "modern" open/close):** the layout
    changes at once; the column slides in from the left edge (420ms,
    `--ease-sidebar` cubic-bezier(0.32, 0.72, 0, 1)) while the page glides
    from its old center to its new one (FLIP, transform only, so the
    manuscript is never re-laid out mid-motion). Rows in view cascade in
    (12px slide + fade, whole wave within 160ms). Closing reverses the slide;
    the column stays painted until it has gone. Reduced motion: instant.
  - **Rename (2026-09-30):** F2 on a row, double-click a name, or click the
    book title opens an inline field in place (name pre-selected). Enter or
    clicking away renames; Esc cancels. Keys inside the field never reach
    the tree or focus mode. A blank scene name makes the scene unnamed; a
    blank chapter title is allowed (shown as "Untitled"). Names are
    trimmed and kept on one line. Each rename is one undo step and never
    moves the caret. Focus returns where it came from (the row for F2, the
    manuscript for the mouse). Model: `rename(id, name)` in
    `packages/editor` (fuzzed); parked scenes are refused.
  - **Add (2026-09-30):** a + on each chapter row (in place of its count,
    on hover or keyboard focus; ⌘↵ on a focused chapter row does the same,
    echoing ⌘↵ = new scene on the page) adds an empty, unnamed scene at the
    end of that chapter and puts the caret there. "New chapter" at the
    foot of the outline adds an untitled chapter (one empty scene) at the
    end of the book, caret in it, and opens its title field in the outline
    (Esc leaves it Untitled). Palette "New chapter" with the outline closed
    puts the caret in the title on the page. Format menu: New Scene at End
    of Chapter, New Chapter. Each add is one undo step. Model:
    `addScene(chapterId)`, `addChapter(afterId?)` (fuzzed).
  - **Header stays (2026-09-30, user):** removing the book title and word
    total felt awkward (the column needs a top bar), so they stay even
    though the title bar and status bar repeat them.
  - **Drag to reorder (2026-09-30):** press and move a row 4px to lift it:
    a copy follows the pointer (88% opacity, slight lift), the original
    dims, an accent line (drawn above the lifted row) shows where it will
    land. Scenes drop between scenes or onto a chapter row (lit with an
    accent ring = its end, works for folded chapters). Chapters drop
    between chapter blocks and carry their scenes. The list scrolls within
    32px of its edges. Esc or dropping in place changes nothing (the copy
    settles home). On drop, rows glide to their new places (FLIP) and the
    moved row flashes. A drag never navigates or takes focus; the caret
    stays in its own text (travelling with its scene if it was inside).
    One undo step per move. **A chapter's only scene can't be dragged out**
    (the format requires a scene in every chapter; no drop line shows).
    Model: `moveScene(id, chapterId, index)`, `moveChapter(id, index)`
    (fuzzed: scenes are never lost, duplicated or altered). Keyboard
    reorder (⌥↑/⌥↓, spec §8.1) not built yet.
  - **Icon:** closed shows the empty sidebar frame ("Show outline"); open
    becomes "Hide outline": the left pane fills in and a chevron points
    left. The two morph with the same timing.

## 4. Typewriter mode — OVERRIDES spec §6 "focus by sentence"

- Focus is **by line**, not sentence. The center line is always fully
  visible; lines above and below fade away quickly.
- Implemented as a **viewport-fixed gradient mask** on the text layer (the
  caret line is always centered, so the band at center is the current
  line). Band height follows the current line's box (24 body, 48/64 in
  titles). No per-line computation.
- **Gradient guide lines** in the left and right margins mark the
  typewriter line; never across the text; decorative, non-interactive.
- **Line-advance motion:** a smooth, subtle, quick animation when the caret
  moves to a new line (~120–160ms ease-out, no overshoot). Scroll is
  committed instantly; only a compositor transform animates (FLIP).
  Rapid Enters retarget from the current offset — never queue. Typing within
  a line causes no motion. Reduced motion → instant.
- Sprinter fades more steeply than Manuscript (one token per mode).
- When the user scrolls away manually, the fade relaxes until they type or
  navigate again.

## 5. Sprinter chrome (from Figma 2162:805)

- Minimal 36px chrome: traffic lights only; a small chevron tab at top
  center pulls down the app menu.
- Footer (32px): sprint indicator ("Sprinting…") left, cloud-sync icon
  right. **Sprint progress is a thin line along the footer's top edge.**

## 6. Data safety — local layers

| Layer | When | Keeps |
|---|---|---|
| Undo | every edit | session |
| Save copies | before every overwrite | last 100 |
| **Point-in-time snapshots** | every 15 min of active writing, on open, and before risky ops (Replace All, big structural deletes, restoring a version) | **last 10** |
| Daily snapshots | once per day | 30 days (configurable) |

- Stored outside the manuscript folder (app data), content-deduplicated.
- History panel: time, word count, word delta, preview; restore is one
  undoable step and snapshots the current state first.
- **Built (2026-09-29).** Store: `app/main/snapshots.ts` in
  `<app data>/Snapshots/<file>/` (index + content by hash; one queue per
  manuscript; a damaged index is set aside and rebuilt from the content).
  Taken: a Daily on open or the first save of the day (the day's starting
  state); an Autosave point at most every 15 min of saving; "Opened";
  "Before Replace All"; "Before restore"; and **manual snapshots with an
  optional label (kept until deleted)**. Automatic ones identical to the
  newest are skipped; named ones are always listed (content stored once).
  **History…** / **Save snapshot…** in the File menu and palette. The panel
  lists time, reason or label, words and the change since the previous
  version; the preview shows the version read-only with its change vs now;
  **Restore this version** needs no confirmation because it snapshots the
  current version first and is one ⌘Z. 120k-word history + preview: ~100 ms.
- **OVERRIDES spec §10.6:** no local git/version-control history — the
  snapshot store replaces it.

## 7. Integrations — DEFERRED (build after the main app works)

Build the main app first. When integrations are built, follow this design.

### Why the old build's Drive auth kept breaking
1. The Google OAuth client was in **Testing** mode → refresh tokens expire
   after **7 days**.
2. Unsigned/ad-hoc rebuilds change code identity → Keychain (safeStorage)
   access can break per rebuild; the old code swallowed the failure and
   reported "not connected".
3. The client ID was build-time generated; missing config silently disabled
   Drive.

### Target architecture: app ↔ Railway server
- **Users sign in** (the user wants a real login; others may use the app
  later). Standard desktop pattern (like Linear/Slack/Figma): the app opens
  the system browser → sign in with Google on the web → redirect back to the
  app (`baretext://auth/...` custom scheme, PKCE + state; loopback
  fallback) → the app exchanges the code with **its own server** for a
  Baretext session stored in the Keychain; the session refreshes silently.
- **One sign-in grants Drive permission** (`drive.file` + `openid email`,
  OAuth client published to **production**). Then the user picks the backup
  folder (Google Picker, hosted on the server's web origin) or uses the
  default "Baretext Backups".
- **Server (Railway) holds:** the Google refresh token (encrypted at rest),
  the Anthropic key (env var), the Picker page. OVERRIDES spec §10.8 "user
  brings their own OAuth credentials" and §12/§16 "no hosted AI, user
  supplies key".
- **Backups upload directly from the Mac to Drive** using a short-lived
  (1h) access token issued by the server — manuscripts never transit the
  server. Uploads verified by checksum.
- **AI: Anthropic only**, via the server proxy. Proxy authenticates the
  Baretext session, checks an allowlist (initially just the user), may
  rate-limit per user, stores no prose. Fallback: a user-entered Anthropic
  key stored in the Keychain.
- **API keys never ship inside the app** (an Electron app is easily
  unpacked). Only public identifiers (e.g. OAuth client ID) may be built in.
- **"Cloud sync" means backups only** — no multi-device sync.

### Connections subsystem (main process)
- Explicit, visible states: Connected · Retrying (transient: network/5xx/
  429, backoff + jitter) · Needs reconnect (invalid_grant / missing scope —
  one click, keeps folder choice) · Credential unreadable (Keychain) — never
  conflated with "disconnected".
- Proactive checks on launch, wake from sleep, and network regained.
- Durable on-disk backup outbox; catches up after outages/crashes.
- Status shows "Backed up · N min ago" and warns when stale (>24h).
- Diagnostics panel (token age, last refresh, scopes, Keychain status,
  recent errors), copyable.
- Tested against fake Google/Anthropic servers: 7-day expiry, revocation,
  missing scope, locked Keychain, offline, sleep/wake. Tests never touch
  real accounts.
- If the server is down, writing is unaffected; backups queue, AI pauses.

### Signing
- Sign every build with one **stable** identity (self-signed code-signing
  certificate is fine for personal use) so Keychain access persists across
  rebuilds.
- Distributing to others later requires Apple Developer ID + notarization.

## 8. Implementation decisions made while building (2026-09-28)

- **Jumping to a scene** (spine, outline, palette) lands on its first line
  of prose, not in its name.
- **⌘B / ⌘I on a partly formatted selection** add the mark unless the whole
  selection already has it (word-processor behavior).
- **Scene numbers:** named scenes show `c.s` beside the name; unnamed scenes
  after the first show it beside the line–ring–line ornament. The first
  scene of a chapter, if unnamed, shows its number (`1.1`) at body size
  beside its first line; clicking it names the scene (2026-09-29).
- **Cold storage** can only change through explicit commands; ordinary
  input can never edit it, and the selection can never rest inside it.
- **Raw line breaks** in text (dictation, IME) become spaces; paragraphs are
  always nodes.
- **Imports never rewrite the original.** Opening a file Baretext didn't
  write (plain Markdown, or a file from the previous Baretext app) saves a
  converted copy beside it, `<name> (Baretext).md`, and edits that.
- **Previous-app files** are recognized and converted: first-line
  `<!-- BOOK TITLE -->`, one line = one paragraph, `#` chapters, `##`/`###`
  named scenes, `---` + `<!-- name -->` named breaks, `<!-- COLD STORAGE -->`,
  `<!-- SCENE GROUP: id -->` / `<!-- SCENE LINK -->` links.
- **One line = one paragraph** in every imported file, not just
  previous-app files (the manuscript convention). Lines are never joined;
  a line underlined with `===`/`---` is still a heading. (2026-09-29)
- **Paragraph spacing is a setting** (Format → Paragraph Spacing): Full
  Line (24px, default), Half Line (12px), or None (first lines indented
  24px, except the first paragraph after a heading or break). It changes
  only paragraph-to-paragraph space; space around headings and breaks is
  fixed. Display only, never written into the file. (2026-09-29)
- **Typewriter fade (user direction, 2026-09-29):** lines next to the
  caret's line start at 40%, fall to 12% at 160px, and the top and bottom
  lines of the window are fully hidden. Tokens in `typewriter.css`.
  Scrolling eases the fade away (320ms) so reading back shows everything;
  the next edit or caret move eases it back (560ms). It also fades in when
  typewriter mode turns on. Never an instant switch.
- **Pause (section break within a scene), 2026-09-29:** ⌘⇧↵ and Format →
  Insert Pause. Mid-line it splits the paragraph; at a line's start it goes
  before the line; at its end, after it (a new line only if none follows).
  Never doubled, never first in a scene, never in titles, quotes, or cold
  storage. Full scene break stays ⌘↵ / Format → Insert Scene Break.
- **Imports:** `* * *` / `***` become pauses; `---` / `___` become scene
  breaks (previous-app files unchanged: every rule there is a scene break).
- **Numbering (user direction, 2026-09-29):** an unnamed scene's number
  (`6.4`) is the same size as a named scene's, centered on its ornament.
  Pauses are numbered within their scene (`6.4.1`, `6.4.2`) at body size,
  and renumber live. The pause ornament is the scene ornament's quieter
  sibling: short lines and a small ring, in the scene color at reduced
  opacity (`--pause-opacity`).
- **Unquoting a scene's last paragraph** removes the empty line quoting
  added, when it is still empty (a line with writing on it stays).
- **Input methods (IME):** composition is tested end to end with the same
  browser events a real IME produces (paragraph, title, across scenes, Esc
  mid-composition). Dictation and trackpad feel need a person to check.
- **Find & replace (2026-09-29):** ⌘F (selection pre-fills); a chevron at the
  left of the find bar shows/hides Replace (⌥⌘F opens with it, or jumps to
  it when find is already open); ⌘G / ⇧⌘G, Enter / ⇧Enter; Edit menu and palette. Searches every
  visible textblock (prose, quotes, chapter titles, scene names), never cold
  storage; matches may cross formatting, never blocks. Case-insensitive by
  default (Match case, Whole word toggles); straight and curly quotes match
  each other. Replacement takes the formatting of the first replaced
  character; Replace All is one undo step. The manuscript selection is left
  alone while searching and lands on the current match on Esc (no selection
  toolbar). Performance: block text prepared once per document version;
  only matches within about a screen are decorated (≤ 600); counts cap at
  10,000+. Measured on 120k words: ≤ 1.3 ms per keystroke.
- **Empty scene names from the file stay.** Only a name the writer just
  started with Name scene and left without typing is dropped, and only on a
  caret move (the fuzzer found both earlier rules could change a file).
- **Naming scenes (2026-09-29):** click an unnamed scene's ornament
  (tooltip "Name scene"), or Format → Name Scene, or the palette ("Name
  scene" / "Rename scene"). Unnamed → an empty name with the caret in it
  ("Untitled" placeholder); named → the name is selected to retype. Enter
  moves to the scene's first line. Backspace in an empty name makes the
  scene unnamed again. Leaving a name that is already empty drops it (not an
  undo step — it holds no text, and undo never resurrects it); a name
  emptied by a larger edit is kept. Never in cold storage or titles.
- **Command palette built (2026-09-29).** Targeted, not exhaustive: only
  commands that exist and apply now (Format appears only with a selection).
  Groups: Navigate, Insert, Format, View, File (Mode/Theme/AI/Backup join
  when those features exist). Toggles show on/off; choices show ✓. Search:
  every word must match; label before keywords; prefix > word start >
  anywhere > letters in order; numbers match exactly. Paragraph spacing is
  one command that opens its three choices (keeps the list short). **Go to chapter or
  scene** (⌘⇧O, or from the palette) is a view of the same palette: current
  scene marked and preselected, Backspace on empty returns to commands.
  Performance rules (the previous app's palette lagged): input focused
  synchronously on open; rows built once per opening, typing only re-ranks;
  one delegated listener; no backdrop blur. Measured on 120k words: open
  ≤ 2.1 ms, keystroke ≤ 0.9 ms.
- **⌘K is the command palette** (spec §7.3). Link has no shortcut: selection
  toolbar button or Format → Link….
- **On/off controls are switches** (2026-09-30, user direction): an
  outlined pill with a sliding knob before the label, filled with the
  accent when on (`.bt-switch`, tokens `--switch-*`), `role="switch"` /
  `aria-checked`. Used by the status bar (Typewriter, Focus) and the
  palette's toggle commands. Find's Aa / ab stay pressed-state buttons
  (toolbar options). Breadcrumb names keep the writer's capitalization;
  only the book title is set in capitals.
- **Turning typewriter off moves nothing** (2026-09-30, bug fix): the
  caret's line keeps its place on screen (scroll compensates for the
  removed centering padding), focus stays in the manuscript (status
  switches never take focus), and the fade eases out before the mask is
  dropped. Palette rows are a grid: label | switch/✓ column | shortcut
  column, so controls line up.
- **Title bar alignment** (2026-09-30): traffic lights at (12, 11) so they
  center on the 36px bar's midline; title text shifted down 1px
  (`--chrome-optical-offset`) so its capitals center there too (measured
  17.93px, tested); title starts at 88px (`--chrome-inset`) to clear the
  wider buttons on recent macOS. Native buttons can't be captured in hidden
  test windows; the user confirmed the alignment by eye.
- **Window size and position are remembered** (2026-09-30): the normal
  frame plus zoomed/full-screen state, saved as it changes and on close,
  restored at launch if still on a connected display (else centered on the
  main display). First launch: up to 1440×900, never over 90% of the screen.
  Hidden test windows stay 1100×800 unless a test sets a size.
- **Development documents live in the project's `samples/` folder**
  (new documents, the Open/Save default). Never the previous app's
  `~/Documents/Baretext`. The packaged app's location is undecided.
  (2026-09-29)
- **Own data folder** (`~/Library/Application Support/Baretext Next`), never
  shared with the previous app.

## 9. Typography: IBM Plex (2026-10-01, user)

- **IBM Plex throughout**, bundled in `app/renderer/fonts` (SIL Open Font
  License, `fonts/LICENSES/IBM-Plex-OFL.txt`); JetBrains Mono removed.
- **Numbers are IBM Plex Mono** (`--font-num`): chapter and scene numbers
  in the outline and the page margins, word counts, the spine tip number.
  Mixed strings ("1 of 12") stay in the interface face with tabular
  figures; the status bar sets only the count in mono.
- **Everything else in the interface is IBM Plex Sans Condensed**
  (`--font-ui`), including chapter and scene names in the outline.
- **Prose: the writer chooses Mono, Sans or Serif** (IBM Plex Mono / Sans /
  Serif; default Mono). The page's chapter and scene headings follow the
  prose font. Saved as `proseFont` in settings; Format → Prose Font and
  the palette's "Prose font…". The caret's line stays put when it changes.
  This is the first setting of the future Style section (theme, fonts…).
- Apple's SF Pro / New York / SF Mono were considered: SF Pro is reachable
  in Electron via `system-ui`, but New York and SF Mono are not (hidden
  system fonts; loading their files directly is a licensing gray area),
  and none may be bundled. Not used.
- Title bar optical offset is 0 with Plex (JetBrains Mono needed 1px).

## 10. Appearance (2026-10-01, user)

- **One place for appearance:** Baretext → Settings… (⌘,) and the palette's
  "Appearance…" open a panel: prose font (Mono/Sans/Serif), theme, paragraph
  spacing, prose width (Narrow ~55 chars, today's 500px / Wide ~70 chars,
  ~660px), font size (Small 14/24 · Medium 15/24 · Large 17/28 · Extra large
  19/32). A live sample window shows the choices; **nothing changes until
  Save**; Cancel/Esc discards. **Overrides spec §11** ("applies a theme on
  selection" and "each theme has its own palette entry"). The separate
  Prose Font / Paragraph Spacing menu and palette entries go away.
- **Themes: Dracula (default), Dark, Light, Grove, High Contrast.** The
  first four come from the old app's reference tokens, extended to every
  color the app uses. **High Contrast** is dark and meets **WCAG AAA**
  (all text ≥ 7:1 on every surface, titles and accent ≥ 4.5:1), enforced
  by its own tests. The green-phosphor CRT
  theme (Amstrad) is **not** carried over. Default: Dracula.
- Every theme passes an automated WCAG AA check
  (`app/renderer/test/themes.test.ts`): body, dim and dimmest text ≥ 4.5:1
  on every surface; titles and accent ≥ 3:1 on the page. This lightened
  Dracula's dimmest text slightly (#91929b → #9fa0a8; it was 4.3:1 on
  popovers). Light uses stronger margin-number opacity (0.4 / 0.65).
- The saved theme is applied before first paint (window background per
  theme; `data-theme` set first thing in the renderer).
- **Built (2026-10-01):** the panel (`app/renderer/appearance.ts`) has
  theme cards (each drawn in its own theme), then Prose font, Font size,
  Paragraph spacing, Prose width as segmented choices; a sample window
  with the writer's current scene; Reset to defaults; Cancel / Save.
  Keyboard: one tab stop per group, arrows choose (wrapping), ⌘↵ saves,
  Esc cancels (and is claimed, so it never leaves focus mode). Opens on the
  theme in use. Theme tokens apply to any element with `data-theme`, so the
  sample and cards can show a theme the app isn't using.
- **Tweaks (2026-10-01, user):** the panel is as tall as its controls
  need whenever the window allows (scrolls only when it can't); the
  sample fills its side edge to edge (no inner frame); no "Nothing
  changes until you save" hint.
- Font size scales the prose line and the full-line paragraph gap (half
  gap: 12 / 12 / 16 / 16px). Heading sizes don't change.
- Margin numbers hide when the page area (not the window) is too narrow:
  under 740px for Narrow prose, 900px for Wide.
- The Format menu's Prose Font and Paragraph Spacing submenus and their
  palette entries are gone; the app menu is built explicitly to hold
  Settings… (⌘,).

## 11. Quality pass (2026-10-01)

- **A failed save stays in view until resolved** (`app/renderer/saving.ts`).
  A notice above the status bar explains it. A refused large deletion
  offers **Undo** or a two-step **Save anyway** ("Confirm: save"; disarms
  after 4s); any other failure offers **Try again**. The status bar keeps
  "not saved". `bridge.save(…, force)` passes the confirmation to the guard
  for that one save.
- **The destructive-save guard also counts prose:** refusing a save that
  removes 90% or more of the words of a manuscript of 100+ words, in
  addition to the size thresholds (structure keeps a short or many-scened
  book's file large even with every word gone). Word counts of the last
  write are remembered, so the previous file is parsed at most once.
  The guard counts every word in the file, Cold Storage included (§14), so
  parking scenes never trips it.
- **Problems are sheets on the window** (`dialog.showMessageBox(win, …)`),
  never app-blocking alerts.
- **Launch explains a last manuscript that didn't reopen** (moved/renamed,
  or unreadable) instead of silently starting a new one; the file is never
  touched. Toasts stay long enough to read (about 400ms a word, 15s max).
- **Covering panels own the keyboard:** while Appearance or History is
  open, every command except Save is ignored (shortcuts and menu alike).
  Opening another manuscript closes find, History, Appearance and the
  palette.
- **Find never acts on old positions:** Replace, stepping and closing
  re-search first if the manuscript changed since the last search.
- **Selections never reach into Cold Storage:** one that runs into it is
  trimmed to the last manuscript line (keeping its direction), not
  collapsed to a caret.
- **Code rules now enforced by tests/compiler:** `noUnusedLocals` and
  `noUnusedParameters`; a token lint (`app/renderer/test/tokens-lint.test.ts`)
  fails on literal colors or px sizes outside `tokens.css` (allowed: 0–2px
  strokes, black alpha masks, custom-property definitions, query
  breakpoints).
- Module layout (renderer): `index.ts` wires the window; `saving.ts`,
  `palette-commands.ts`, `test-hooks.ts`, `outline-drag.ts` and the
  appearance helpers in `appearance.ts` hold what used to sit in it.

## 12. Polish (2026-10-01, user)

- **Typewriter off fades back in:** the dimmed lines return and the guide
  lines fade out together over 400ms (`--dur-tw-off`, ease-in-out), evenly
  enough to see; previously a front-loaded curve read as a snap (90% done
  in 80ms) and the guides vanished instantly. Nothing moves.
- **The outline's current-scene highlight glides:** one wash element moves
  between rows (240ms, `--dur-glide`) as the current scene changes, by
  caret or by reading back; the rows' text brightens and dims with it.
  After a rebuild (structure change, reorder) it snaps. When the current
  row leaves the list's view, the list scrolls smoothly to it.

## 13. Outline: delete (2026-10-01)

- **Two steps (spec §0.8):** a trash button on each row (with + on chapter
  rows) takes the count's place on hover or keyboard focus; ⌫/Delete on a
  focused row does the same. The first press **arms** the row (red tint,
  "Delete 1.3 “Name”?" / "Delete chapter 2 and its 4 scenes?", a red
  Delete button); a second press (click, ↵, ⌫ or Delete) deletes. Esc,
  clicking anywhere else, any other key, or 4 seconds cancels.
- **Safety:** a snapshot ("Before deleting …") is taken first; the delete
  is one ⌘Z; a toast says what was deleted and how many words, with
  "⌘Z brings it back". Deleting most of a book at once trips the save guard
  (DECISIONS §11), which asks again before writing it to disk.
- **Structure stays valid:** deleting a chapter's only scene leaves an
  empty scene; deleting the book's only chapter leaves an empty chapter.
  The caret, if inside, moves to the nearest line of prose.
- Model: `deleteScene(id)`, `deleteChapter(id)` (fuzzed: every scene not
  deleted survives word for word).

## 14. Cold Storage (2026-10-01, user)

- **One document.** Parked scenes stay in the manuscript document (at its
  end), hidden. Opening one shows it alone on the page and makes it
  editable: one undo history, one save, the same guards. The structure
  guard lets text change only inside the open scene; everything else in
  Cold Storage changes only through commands (`packages/editor/src/cold.ts`).
- **Wording:** "Move to Cold Storage" / "Restore" (user). Toasts: "Moved
  2.2 “Name” to Cold Storage. ⌘Z undoes it." / "Restored “Name” as 2.2."
- **Snowflake** is Cold Storage's mark (user): the section header, the
  "Move to Cold Storage" row action and the open scene's bar
  (`app/renderer/icons.ts`, shared interface icons).
- **Each theme has its own Cold Storage blue** (`--color-cold`; user):
  Dracula cyan, Dark glacier `#9cc2d9`, Light ink `#2c5f86`, Grove aqua
  `#85beb6`, High Contrast ice `#9fdcff`. Used only for the heading areas
  (the open scene's bar, tinted 12%; the outline's section heading in the
  blue) and the background (the open scene's page, washed 6%). Prose and
  titles keep the theme's colors. The theme test checks the blue on its
  bar and in the outline, and prose/titles on the washed page (AA; AAA in
  High Contrast).
- **Moving:** outline row action (snowflake, on hover/focus), dragging a
  scene onto the Cold Storage section, palette "Move scene to Cold
  Storage", Format → Move Scene to Cold Storage. Newest first. A chapter's
  only scene leaves an empty one. One ⌘Z.
- **Where it came from is remembered** (chapter + position) in the file's
  bookkeeping comment (`origins`; older files without it read unchanged).
  **Restore** puts it back there (end of the last chapter if that chapter
  is gone); dragging a parked scene into the outline restores it at that
  spot. It forgets its origin once restored.
- **The outline's Cold Storage section** follows the chapters (hidden when
  empty): folding header with count and words; parked rows show name and
  words (origin in the tooltip) with Restore and Delete (two steps); F2 /
  double-click renames. Click (or ↵) opens one.
- **Open on the page** (user: page shows only that scene): a slim bar —
  "COLD STORAGE · Name", **Restore**, **Back to manuscript (Esc)**. The
  caret opens on its first line of prose. The status bar counts the
  scene's words; the breadcrumb reads "Cold Storage · Name"; the spine
  hides; the outline marks the row. Esc (after any open surface) returns
  to exactly where the writer was (caret and scroll); so does deleting the
  open scene. Going anywhere in the manuscript (outline, palette jump,
  new scene/chapter, Find) closes it first.
- **Kept out of the manuscript:** word counts, find, the spine (export and
  print will exclude it unless opted in).
- **Rename and delete work on parked scenes** (this reverses the earlier
  "parked scenes are refused" in rename).
- Known: undoing, after going back, an edit made inside a parked scene
  changes the (hidden) parked text; the outline's counts show it.

## 15. No keyboard reorder (2026-10-01, user) — OVERRIDES spec §8.1

- ⌥↑/⌥↓ to reorder in the outline was built, then removed at the user's
  request ("I don't need it"). Clicking a row puts the caret in the text,
  where ⌥↑/⌥↓ keep their macOS meaning (paragraph by paragraph); drag and
  drop is the way to reorder. The shared row glide (FLIP) stays in
  `outline-drag.ts`.

## 16. Notes (2026-10-01, user)

- **Two places (user):** a note about a passage **floats in the right margin
  beside it** (cards stack in passage order without overlapping; the active
  card sits level with its passage); a **notes panel flies in from the
  right** for everything, including **general notes** about the book (no
  passage). When the margin is too narrow for cards (window size, panel
  open), each note shows as a small marker in the note color that opens it
  in the panel. **Margin notes float whenever the manuscript is shown, except
  with the notes panel open, in typewriter mode, or in focus mode (user,
  2026-10-01)**; then clicking a noted passage opens its note in the panel.
- **Resolving removes the passage's highlight** (it reads as plain text
  again).
- **Cards (user, 2026-10-01):** no border; a shadow made from the page's
  own color darkened (`--shadow-note`, never plain black), **the same on
  every card — one light source (user)**; a card not in use dims its
  contents, never its shadow. **Resolve is a circled check in the
  top-right corner, like a Google Docs comment**, shown on hover/active —
  and only once the note is saved.
- **Writing a note (user, 2026-10-01), as a Google Docs comment:** a text
  box with **Cancel** and **Save**; **↵ saves, ⇧↵ adds a line, Esc
  cancels**; Save, ↵ and Esc return the caret to the manuscript. Nothing is
  stored until saved. A saved note reads as plain text; click it (or ↵ on
  it) to edit. Clicking away saves what was written; a new note left empty
  goes with its anchor; an edit emptied keeps the saved text. Revealing a
  saved note (clicking its passage) never takes the caret out of the
  manuscript. One component for margin and panel (`note-body.ts`).
- **Anchors are an invisible `note` mark** on the passage
  (`packages/editor/src/notes.ts`): they follow the text through edits,
  moves and Cold Storage; undoing a deletion brings them back; they are not
  undo steps; notes may overlap; they attach only within one scene's prose.
  A copy-paste never duplicates one; a cut-paste keeps it (the passage
  moved). The manuscript file never contains them (`docToModel` ignores the
  mark; fuzzed).
- **Storage (user):** `<name>.notes.json` beside the manuscript, written
  atomically ~0.5s after a change (and on quit); each anchor saved as
  { scene, quote, offset } and found again on reopening (nearest the old
  place; anywhere in the book if its scene is gone). No notes, no file. A
  damaged file is set aside, never overwritten.
- **Creating:** ⇧⌘M (Format → Add Note), the selection toolbar's note
  button, or the palette, on a selection; with nothing selected, ⇧⌘M starts
  a general note in the panel. A new note cancelled or left empty is let go
  (with its anchor).
- **Panel motion (user, 2026-10-01): as the outline's** — slides in from
  the right edge while the page glides, cards in view cascade in, it slides
  away on close and with focus mode; reduced motion skips it. One helper
  for both columns (`sidebar-motion.ts`).
- **Hand-off (user, 2026-10-01):** opening, the floating notes fade out
  (drifting toward the panel, `--dur-notes-out`), and only then does the
  page make room and the panel slide in; closing, the panel slides out and
  the floating notes drift back in over the slide's settle
  (`--dur-notes-in`, from 60% of the slide). Every way of opening the
  panel goes through this (button, ⇧⌘N, a marker, revealing a note).
- **Magnet (user, 2026-10-01):** the page leads both ways. Closing, it
  pushes the column out; opening, it pulls the column in behind it. The
  column starts at once on its own curve (`--ease-sidebar-follow`: gentle
  start, catching up as the page slows, soft settle), ending with the page.
  A delay was tried and rejected: a pause, then a lurch. Shared, so the
  outline moves the same way.
- **Panel (⇧⌘N, View → Notes, the title bar's notes button with the open
  count):** General, then In the manuscript (in order: quote, body, "2.3
  Name" / "Cold Storage · Name" / "Passage deleted", **Show in
  manuscript**, **Resolve**). **Resolve (user): hidden, recoverable** —
  "Show resolved" lists them with **Reopen** and two-step **Delete**.
- **A noted passage is washed in the theme's reserved note color (user,
  2026-10-01)** — not underlined: underlines are kept for spelling and
  grammar checking. The note color is a rose from each theme's own palette
  (Dracula pink #ff79c6, Dark rose #e0828f, Light rose #a03f55, Grove
  Everforest purple #d699b6, High Contrast magenta #ff8fd8): yellows and
  ambers go olive/brown as a wash on dark pages, and on Dark/Light they
  matched the selection. Washes mix in OKLab so they keep their hue: 10% at
  rest, 18% for the active note; square corners, so they run seamlessly
  across italics. Contrast-tested per theme (prose and epigraph text on
  both washes, AAA on High Contrast; the outline badge), and the note hue
  is ≥45° from the selection's. **Focus mode shows no note washes (user).**
  Clicking a passage brings its note forward. The outline shows each
  scene's open-note count.

## 17. Breaks: one family on ⌘↵ (2026-10-01, user)
- **⇧⌘↵ pause, ⌘↵ scene, ⌥⌘↵ chapter** — the modifier sets the size of the
  break (Shift: the soft break, as Shift+Enter is everywhere; Option: the
  stronger one, as ⌥ means on macOS). Format menu and palette list all three.
- **⌥⌘↵ splits the chapter at the caret** (`splitChapter`), as ⌘↵ splits a
  scene (same rules, shared code): mid-line the scene splits and its rest,
  with the chapter's later scenes, becomes a new unnamed chapter with a
  fresh identity; at a scene's start (or the end of a scene with more after
  it) the chapter splits between scenes, which move whole with their names
  and identities; at the chapter's end, a new chapter with one empty scene.
  The caret lands in the new chapter's name (↵ goes on to its text).
  Nothing at the very start of a chapter, in titles, or in Cold Storage.
  One undo step; fuzzed (60,000 cases). "New Chapter" (add one at the end)
  is unchanged.

