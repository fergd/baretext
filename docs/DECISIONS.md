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
- Formatting comes from shortcuts (⌘B, ⌘I, ⌘↵ scene break, ⌘⇧↵ pause), a
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
- Body rhythm: JetBrains Mono 15/24. Chapter title 40/64, scene title 28/48
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
- Hovering the spine peeks the outline as glass; ⌘\ pins it as a column
  (see `docs/reference-tokens` and the old writing-rail handoff).

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
