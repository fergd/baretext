# Baretext — Agent Brief, Product Spec, and Technical Design

> **Audience:** an AI coding agent (or new engineer) about to work on
> Baretext. Read all of it before changing anything. It covers:
> - what the product is for,
> - what content and behavior each part of the app must provide, and why,
> - the rules the manuscript and editor must obey,
> - how the system should be structured,
> - how to verify your work.
>
> This document deliberately **does not**:
> - name libraries or frameworks;
> - treat Markdown as the app's working format (§3);
> - **prescribe layout or visual design.** It says which *areas* exist and
>   what *content* and *behavior* they need. Where things sit, their sizes,
>   colors, type, spacing, iconography and motion are **directed by the
>   user** through design handoffs and conversation.
>
> If the implementation and this document ever disagree, raise it — don't
> silently pick one.
>
> This is a **fresh-start specification**. It assumes no existing code and
> no prior implementation. Build to this document and to the user's design
> direction.

---

## 0. Instructions to the agent (read first)

1. **Protect the manuscript above all else.** A writer's words are the one
   irreplaceable thing in this app. No feature, refactor, or fix may risk
   silently losing, truncating, reordering, or corrupting text. When in
   doubt, choose the behavior that preserves text and is undoable.
2. **Think in manuscript structure, not Markdown.** The app works on a
   structured manuscript (§3). Markdown and plain text are **output
   formats**, produced by a serializer and read by a parser. If you find
   yourself reasoning about `#`, `---`, `**`, or comment markers outside
   that serializer/parser, stop — you're in the wrong layer.
3. **The user directs the design.** This spec defines areas, content, and
   behavior, not appearance.
   - Implement visuals from the user's design direction (mockups,
     handoffs, or explicit instructions).
   - When a design decision is needed and none exists, propose options and
     ask. Don't invent a new look.
   - Keep appearance driven by shared design tokens and themes, never
     hard-coded, so the user can restyle without code surgery.
4. **Formatting has to feel native.** Bold, italic, headings, scene
   boundaries, and titles behave like a polished word processor: what you see
   is what you have, and the caret and selection are predictable everywhere.
5. **Structure is not text.** Chapter boundaries, scene breaks, scene names,
   links, and cold storage are model properties, not characters in the prose.
   The caret can never be "inside" a boundary, and typing can never damage
   one (§4.4).
6. **Distraction-free is a product requirement, not a style.** The writing
   stays the focus. Supporting areas appear when summoned or when relevant,
   and get out of the way otherwise. How that looks is the user's call.
7. **Every control is a real, keyboard-operable button** (or a proper
   tree/tab/listbox item). Never a clickable non-control element.
8. **Destructive actions use a two-step arm/confirm, never a native
   dialog.** Undo is the safety net.
9. **Every behavior change needs both** live verification against a real
   running instance **and** persisted automated tests. When fixing a bug,
   write the failing test first and confirm it fails on the old code.
10. **Never commit or push unless explicitly asked.** Once a task is approved,
    do routine follow-through (build, package, install for the user to try)
    without asking at each step. If the user's copy of the app is running,
    quit it gracefully before replacing it.
11. **Test windows must never appear or steal focus** on the user's machine.
    Automated launches run hidden, with isolated, throwaway settings and save
    directories.
12. **Report honestly.** Separate pre-existing failures from new ones by
    comparing against the state before your change. Say what you did not
    verify.

---

## 1. What Baretext is

Baretext is a **distraction-free desktop writing app for macOS** for
long-form fiction and memoir: a novelist drafting and restructuring a
manuscript of chapters and scenes. It sits between a plain text editor and a
full writing studio.

- **Like a plain editor:** it opens straight to the page, and the manuscript
  lives in an ordinary, readable text file the writer owns.
- **Like a writing studio:** it understands chapters and scenes, and offers
  an outline, a corkboard, cold storage for cut scenes, margin notes, and
  timed writing sprints.
- **Unlike both:** formatting simply works, with no syntax, and everything
  except the writing stays out of the way until it's needed.

### Who it's for
A single writer on their own Mac, working on one manuscript at a time,
sometimes for hours. They value polish, calm, and absolute reliability.
They are not a programmer and should never see or think about markup.

### Product principles
| Principle | Meaning |
|---|---|
| The page first | Launch lands on the manuscript. Everything else is summoned. |
| Formatting just works | Formatting and structure behave like a good word processor, with nothing to learn and nothing to break. |
| Structure without friction | Chapters and scenes are created in one gesture and reorganized by drag, keyboard, or the corkboard. |
| Nothing is lost | Autosave, atomic writes, blocking destructive saves, recovery snapshots, local history, daily snapshots, optional cloud backup, and undo everywhere. |
| Portable output | The saved file reads cleanly in other editors, and export produces plain text or Markdown. |
| Calm | Supporting UI never competes with the prose. The user sets the specific visual language. |
| Opt-in intelligence | AI runs only on an explicit click and is undoable. |

---

## 2. Areas of the app

The window is made up of the **areas** below. Their placement, size,
styling, and whether they're docked, floating, or overlaid are design
decisions for the user. What's fixed is the content and behavior.

| Area | Must contain / do |
|---|---|
| **Manuscript area** | The writing surface (§4). Always the primary area. |
| **Document header area** | Document title, current chapter/scene context (a breadcrumb), and access to the outline, corkboard and search. Items irrelevant to the current view are hidden. |
| **Outline area** | Chapter/scene navigation and management (§8.1). Can be hidden, previewed on demand, or kept open. |
| **Corkboard area** | Replaces the manuscript area while open (§8.2–8.3). |
| **Notes area** | Notes for the current scene (§9). Opened on demand. |
| **Status area** | Word and character counts, typewriter state, sprint state, the mode switch, backup state, and the current filename, which reveals the file in Finder. Parts hide when irrelevant. |
| **Transient surfaces** | The command palette, jump palette, find/replace, font picker, theme picker, settings panels, sprint panel, and toasts. |

**Focus mode** (⌘.) hides the status area and other non-essential chrome
for maximum quiet. Turning it off restores them.

### 2.1 Modes
There are exactly two modes. A mode is a named set of features that is
mounted on entry and torn down on exit.

| Mode | UI label | Purpose | Features |
|---|---|---|---|
| Manuscript | "Manuscript" | Structuring and revising a long work | core, find/replace, chapter/scene navigation (outline, corkboard, cold storage), notes, structure numbering |
| Sprinter | "Sprinter" | A temporary, timed, stripped-down writing session | core, sprint timer. No navigation or numbering |

- The app **launches into Manuscript**, always (the mode is never restored).
- Choosing Sprinter opens sprint setup. Cancelling setup, ending the sprint,
  or the timer completing **returns to Manuscript at the caret**.
- Switch modes from the mode switch, the command palette, or ⌘⇧D. All three
  share one state.
- The mode switch is hidden while the corkboard is open.
- Anything that depends on mode is reapplied on every mode switch, never set
  once at startup.

### 2.2 View toggles (not modes)
These compose with either mode. Typewriter and focus mode last for the
session only (every launch starts with both off); font and theme persist.
- **Typewriter mode** (⌘⇧T, §6)
- **Focus mode** (⌘.)
- **Font** (⌘⇧F): a choice of writing typefaces
- **Theme** (§11)

---

## 3. The manuscript model

### 3.1 The in-app model is structured
The app edits a **tree**, not a string of markup:

```
Manuscript
├─ book title            (independent of the filename)
├─ chapters[]
│   ├─ title             (may be empty → shown as an "Untitled" placeholder)
│   └─ scenes[]
│       ├─ name          (optional; named scenes show their name)
│       ├─ blocks[]      (the prose)
│       └─ link group    (optional; §8.4)
└─ cold storage: scenes[] (parked scenes; §8.5)
```

- **Blocks:**
  - **paragraph**: text runs with inline marks;
  - **section break**: a pause *within* a scene, not a new scene;
  - **epigraph / block quote**;
  - **lists**, if needed.
- **Inline marks:** bold, italic, and link. They can overlap. Add others only
  if a real need appears.
- **Scene identity:** scenes may carry an identity so that selection,
  highlights, notes, and navigation follow them through edits and moves. The
  identity never leaks into the prose.
- **Titles:** an empty chapter title shows an "Untitled" placeholder that is
  never saved. Titles are shown verbatim, without automatic prefixes such as
  "Part N".
- **New chapters** start with one empty scene.

### 3.2 On disk: a readable text file, via a serializer
- The manuscript saves to a **single human-readable text file** that opens
  cleanly in any editor. Markdown is the recommended format because it is
  the most portable readable format for headings and emphasis.
- A **serializer** (model → file) and a **parser** (file → model) are **the
  only code that knows the file's syntax**.
- **Round-trip guarantee:** parse(serialize(model)) equals the model for
  every supported construct. It is enforced by exhaustive unit tests, the
  project's most important suite.
- **Reads like a manuscript elsewhere:** app bookkeeping (links, cold
  storage, notes, identities) is either unobtrusive in the file or kept in a
  sidecar.
- **External edits survive:** hand-edited files open without losing text,
  and unknown constructs are preserved as plain paragraphs.
- **Import:** opening an ordinary Markdown or plain-text file that Baretext
  didn't create imports it sensibly. Headings become chapters and scenes, and
  horizontal rules become scene breaks.
- **Prose never carries structure:** the writer's text is never the carrier
  of structure, and there are no hidden characters.

### 3.3 Where markup may appear
| Place | Markup? |
|---|---|
| Editor surface, caret, selection, typing | **Never** |
| Outline, corkboard, notes, AI inputs, search | **Never.** They read the model. |
| Clipboard copy (§8.6) | Rich text plus a plain-text fallback. Markdown only if the user explicitly chooses it. |
| Save file, export, print | Yes, through the serializer. Export offers plain text or Markdown. |
| Paste in | Formatting is converted into model marks and blocks. Pasted markup characters are just text unless the user explicitly imports them. |

### 3.4 Why not edit Markdown directly
A tempting shortcut is to keep the live document as Markdown text and
simulate structure by visually hiding syntax. **Don't.** It reliably
produces the worst class of bugs in a writing app:
- the caret landing inside hidden markers;
- typing that corrupts scene breaks;
- concealed formatting characters that capture input;
- scroll regions that are blank or jump around.

Keep Markdown inside the serializer/parser and nowhere else.

---

## 4. The writing surface

### 4.1 Formatting that just works
- There is one surface, with no source view and no visible syntax, ever.
- ⌘B / ⌘I toggle bold and italic on the selection. With no selection, they
  set the style for what's typed next. They toggle cleanly on partly
  formatted selections.
- **Mark boundaries behave like a word processor:** typing at the end of a
  bold word continues bold, and typing after toggling bold off continues
  plain. Formatting never swallows, duplicates, or reorders characters.
- `--` becomes an em dash as you type.
- Smart quotes are optional. If they're added, they must be consistent and
  easy to undo.
- Undo/redo covers every edit, formatting change, and structural command,
  and typing coalesces into sensible steps.
- **Paste:** formatted text brings its bold, italic, and paragraphs.
  Everything else becomes clean text.
- Input methods, dictation, and accented-character entry work correctly.

### 4.2 Manuscript content (Manuscript mode)
The manuscript area presents the book as a continuous, readable document.
It must show:

- the **book title**, editable in place;
- **chapter titles**, editable in place, with an "Untitled" placeholder when
  empty;
- **scene names** for named scenes, editable in place;
- a **visible boundary** for unnamed scenes, and a distinct, quieter marker
  for section breaks within a scene;
- **chapter and scene numbering** (chapter `1`, scenes `1.1`, `1.2`, …) that
  doesn't disturb the prose. The current scene's number is distinguishable.
  Numbering may be hidden when there isn't room;
- **heading hierarchy** that clearly separates book, chapter, scene, and
  body, with each heading visually belonging to the content it introduces;
- optionally, **opening-line emphasis** (a literary convention, such as the
  first words of a scene in small caps).

Sprinter shows the same prose with **less structure**: no numbering or
navigation. Scene boundaries are still visible.

**Engineering constraints, whatever the design:**
- A comfortable reading measure.
- The last line can scroll to a comfortable position.
- Spacing belongs to the block structure, not to per-line margins, which
  make scroll heights unstable on long, virtualized documents.
- Text renders identically in every theme.

### 4.3 Paragraphs and empty lines
- Enter ends a paragraph and starts a new one, and the caret always lands on
  a visible line.
- An empty paragraph is a real, visible, writable line.
- Paragraph separation comes from layout, not from empty paragraphs.
- Enter at the end of a scene's last paragraph adds a paragraph to that
  scene. It never creates a scene or touches the next one.

### 4.4 Caret and editing rules around structure (critical invariants)
1. **The caret moves only through editable text:** paragraphs, and titles or
   names while they're being edited. There is no invisible position between
   scenes. Arrowing down from a scene's last line reaches the next editable
   line, and arrowing up reverses it exactly.
2. **Clicking any non-text space** (around headings, boundaries, margins)
   places the caret on the nearest sensible editable line. Nothing in a gap
   is ever focused or selected.
3. **Titles and names behave like single-line fields in the flow.** Enter
   moves to the first paragraph and never splits a title into prose.
4. **Backspace at the start of a scene's first paragraph, or Delete at the end
   of its last, never merges scenes or removes a boundary.** Merging,
   deleting and moving scenes and chapters happen only through explicit,
   undoable commands (§8). A selection spanning scenes deletes the selected
   text but keeps the scene containers.
5. **Insert scene break (⌘↵)** splits the current scene at the caret. The
   caret goes to the new scene's first line.
6. All of the above hold for mouse and keyboard, with typewriter mode on or
   off, and after any undo/redo.

### 4.5 Scrolling and navigation stability
- **Manual scrolling is authoritative.** It never snaps back to the caret or
  another scene.
- Navigation from the outline, corkboard, notes, or jump palette goes
  through **one navigation controller**:
  1. resolve the target scene by identity;
  2. reveal the manuscript;
  3. make a single selection-and-scroll request.
  A deleted target doesn't jump elsewhere.
- Closing the corkboard without choosing a scene restores the exact
  manuscript viewport, adjusted for edits made while it was open.
- Structural commands never jump the viewport. Unchanged content keeps its
  on-screen position.
- The app reopens the last file at the last caret position.

---

## 5. Sprinter and the sprint timer

**Purpose:** timed bursts of drafting with nothing else to fiddle with.

The sprint has these **states**. The design of each is up to the user.

| State | Behavior |
|---|---|
| **Setup** | Opened by choosing Sprinter or pressing ⌘⇧S. Offers a few preset durations (default 15, 25, and 45 minutes) and a word goal. The goal is suggested from the duration (~20 words/min) and is editable. Enter starts the sprint. |
| **Active** | Shows the time remaining and progress toward the goal, with pause/resume, minimize, and end. |
| **Minimized** | A compact, unobtrusive presence that still shows the countdown and a paused state, and can be restored in one click. |
| **Hidden** (⌘⇧H) | Only a minimal indicator remains. It says "sprinting" even while paused, by design, and no countdown is visible. |
| **Complete** | A brief confirmation, then a return to Manuscript at the caret. |

- Selecting Sprinter again reveals a hidden or minimized timer. There are no
  duplicate sprint controls elsewhere.
- Focus mode also hides the minimized presence.
- Sprinter's typewriter focus effect is stronger than Manuscript's, meaning less
  surrounding text stays legible.

---

## 6. Typewriter mode

**Purpose:** keep the writer's eyes on one fixed line, like a typewriter
platen.

- **A standalone on/off setting**, independent of mode. Toggle it with ⌘⇧T or
  the palette. The status area shows its state and may offer a secondary
  toggle. It lasts for the session; every launch starts with it off.
- **Centering:** the caret's line stays at a fixed vertical position (by
  default the middle of the manuscript area). Moving to another line
  transitions smoothly, and typing within a line causes no motion.
- **When it re-centers:** only on explicit navigation and text edits. Mouse
  release, selection changes, modifier keys, and manual scrolling never
  trigger it.
- **Focus by sentence:** the current sentence is fully emphasized, and other
  sentences recede with distance. The user decides the exact strength and
  treatment.
- **Optional aids:** an indication of the writing line and softened edges
  of the area. They're design-directed, and none may accept input.
- **Corkboard:** its indicator is hidden while the corkboard is open. The
  setting is preserved, and centering resumes on return.
- **Stability:** Enter at a paragraph end or next to a heading never makes
  the view jump.

---

## 7. Command palette, shortcuts, find/replace

### 7.1 Command palette (⌘K)
The universal entry point: **every action is reachable here**.

- It is searchable and grouped: File, Navigate, Insert, View, Mode, Theme,
  AI, and Backup.
- Features add their commands when mounted and remove them when unmounted.
- Toggles show their current state.
- It follows the dialog/combobox/listbox pattern with a focus trap.

### 7.2 Jump (⌘⇧O)
A palette filtered to chapters and scenes. Choosing one navigates through the
shared controller.

### 7.3 Shortcuts
| Keys | Action |
|---|---|
| ⌘K | Command palette |
| ⌘N / ⌘O / ⌘S | New / open / save |
| ⌘P | Print |
| ⌘⇧E | Export (plain text or Markdown) |
| ⌘⇧O | Jump to chapter or scene |
| ⌘↵ | Insert scene break (split scene) |
| ⌘B / ⌘I | Bold / italic |
| ⌘⇧T | Typewriter mode |
| ⌘⇧F | Font picker |
| ⌘. | Focus mode |
| ⌘⇧D | Toggle Sprinter / Manuscript |
| ⌘⇧S | Start or restore a sprint |
| ⌘⇧H | Hide the sprint timer |
| ⌘F | Find & replace (Manuscript) |
| ⌘⇧C | Corkboard (Manuscript) |
| ⌘⇧M | Add note to selection |
| ⌘\ | Show / hide the outline area |

The native macOS menu mirrors the file commands, including **Open Recent**
(the last 10 existing files). When the manuscript is focused, Edit →
Undo/Redo uses the manuscript's history.

### 7.4 Find & replace (Manuscript, ⌘F)
- Counts matches, steps through them, and replaces one or all.
- Matches are visibly identified in the manuscript.
- It searches **the prose the writer sees**, never markup.
- Replacement keeps the formatting of the surrounding text.

---

## 8. Chapter and scene navigation (Manuscript mode)

All navigation areas read **the manuscript model**. For each scene, that
includes its title, word count, synopsis (its opening prose), link group,
cold-storage status, and open-note count.

- Views refresh after edits, including paste and undo, on a short debounce.
- Selection changes update highlights and the breadcrumb in place.
- Subscriptions end on mode exit.

### 8.1 Outline area
**Content:**
- **Book title:** defaults to the filename, and is editable here in sync with
  the on-page title.
- **Chapters:** number, title, scene count, word count, and collapse/expand.
- **Scenes:** number, title, word count, and open-note count. The current
  scene is clearly indicated.
- **Scene actions:** navigate (click), rename, copy, archive to cold
  storage, and delete (two-step). Actions may be revealed on hover or focus
  instead of always showing, but hover-revealed actions must also appear on
  keyboard focus.
- **Adding:** add a chapter, and add a scene *within a specific chapter*.
- **Cold Storage:** a section listing parked scenes (§8.5).

**Presence (content requirements, not design):**
- a **minimal overview** that shows the book's shape and where the writer is,
  using almost no space;
- a **quick preview** of the outline on demand, without committing space;
- a **persistent open outline**, toggled with ⌘\. The state persists.

**Interaction:**
- **Drag to reorder:**
  - a scene next to another scene;
  - a scene into another chapter, including an empty one;
  - a scene into Cold Storage to archive it;
  - chapters, too.
  - Rows are directly draggable.
- **Keyboard tree:** ↑/↓ move, ←/→ collapse/expand, Enter or Space
  activate, F2 renames, Delete arms deletion, and ⌥↑/⌥↓ reorder.
- **Inline rename:** clicks inside the field never fall through to
  navigation, and blank names are handled gracefully.
- **Scroll:** interactions never jump the outline's scroll position.

### 8.2 Corkboard — cards view (⌘⇧C)
**Purpose:** see and restructure the whole manuscript at a glance.

**Content:**
- The **entire manuscript**, grouped by chapter. Each chapter shows its
  number, title, and counts. Empty chapters still appear.
- One **card per scene:** title (inline renamable), synopsis or AI summary,
  word count, and a visible "draft" state for very short scenes (for example,
  under ~20 words).
- **Card actions:** open in manuscript, copy, suggest name, summarize,
  link/unlink, and delete (two-step).
- A way to **add a scene to each chapter**.

**Behavior:**
- Drag cards to reorder within or across chapters.
- **Interacting with a card never navigates away.** The board closes only on
  Esc, its toggle, or "open in manuscript".
- Actions preserve the board's scroll position.
- The selected card is clearly indicated.
- While the corkboard is open, the outline toggle, typewriter indicator,
  and mode switch are hidden.

### 8.3 Corkboard — outline view
The alternative to cards, switchable in the corkboard area.

- A compact list of chapters and scenes with **editable summaries**.
- **"Copy for Sheets"** copies the outline as tab-separated rows for pasting
  into a spreadsheet.

### 8.4 Scene links
Some scenes belong together, such as a flashback pair.

- **Linking:** start from a card. Eligible targets become identifiable, and
  choosing any card links it. Cancel or Esc exits without linking.
- **Placement:** linked scenes may sit in different chapters and stay where
  they are until a member is dragged. Then the **whole group moves
  together** in manuscript order.
- **Unlinking:** unlink removes a card from its group. Deleting a scene
  deletes only that scene.
- **Persistence:** links are part of the model, survive reopening, and are
  undoable.

### 8.5 Cold Storage
A parking lot for cut scenes the writer isn't ready to delete.

- Archiving and restoring are single undoable commands.
- **Excluded from the manuscript flow:** cold-storage scenes never appear
  while scrolling, in manuscript word counts, in print, or in export unless
  the user opts in.
- **Standalone view:** opening a cold-storage scene shows just that scene,
  editable, with a way back to the remembered manuscript position.
- **Actions:** the same as manuscript scenes, except archive becomes
  **restore**.
- **Corkboard:** not shown there, for now.

### 8.6 Copy scene / chapter
Copies a scene or chapter with its title as **rich text** (formatting intact
for word processors and email), plus a **plain-text** fallback.

- It never includes app bookkeeping.
- Copying a linked scene copies only that scene.
- It's available wherever scenes and chapters are listed.

---

## 9. Notes (margin comments)

**Purpose:** leave editorial notes on passages without touching the prose.

- **Creating:** select text and press ⌘⇧M (or use the palette). The note
  anchors to that text in its scene, and the notes area opens with the
  note's input focused.
- **Anchoring:** anchors follow the text through edits. If the anchored text
  is deleted, the note stays and says so.
- **Notes area:** shows open notes for the current scene, or all open notes
  when the caret isn't in a scene. Each note shows:
  - the quoted passage;
  - an editable body;
  - its scene ("scene moved" if the scene can't be found);
  - **show in manuscript** and **resolve** actions.
- **In the manuscript:** the text each note is anchored to is indicated
  there. Activating the indicator opens that note.
- **Counts:** navigation areas show open-note counts per scene.
- **Storage:** notes are stored separately from the prose and saved on a
  short debounce. A failure produces an error message.

---

## 10. Files, saving, and data safety

This is the most important subsystem. Its layers, innermost first:

1. **Autosave:** about half a second after the last change, covering every
   edit, including structural commands and applied AI titles. The caret
   position is persisted too. ⌘S saves immediately, and quitting flushes
   pending saves.
2. **Serialize, then verify:** the output is parsed back and compared with
   the model. On a mismatch, the save is refused and reported, and the old
   file is left untouched.
3. **Atomic write:** write to a temporary sibling file, then rename it over
   the original.
4. **Destructive-save guard:** a sudden gutting of an existing file is
   **refused**, with an explanation. Suggested thresholds: a file of 1KB
   or more becoming empty, or a file of 4KB or more shrinking to about 10%
   or less (256-byte floor).
5. **Recovery snapshots:** the previous file is copied to a per-file recovery
   folder in the app data directory before every overwrite. The last ~100
   are kept.
6. **Local version history:** rate-limited commits to a local
   version-control history beside the save directory.
7. **Daily local snapshots:** one dated copy per manuscript per day, stored
   outside the manuscript folder, with configurable retention and a manual
   cleanup. These never leave the machine.
8. **Cloud backup (optional):** mirrors the manuscripts in the save folder to
   the user's Google Drive, at most once per ~5 minutes of activity plus on
   quit.
   - The user brings their own OAuth credentials and signs in through the
     system browser via a loopback address.
   - The app uses the narrowest scope: it only sees files and folders it
     created or that the user picked.
   - Backups go to a default folder, or to one the user picks in Google's
     picker. The picker must be served from a real local web origin, not a
     file URL.
   - If the chosen folder is deleted, the app shows a clear error rather than
     silently falling back to another folder.
   - Missing scopes prompt the user to reauthorize.
   - Controls: connect/disconnect, choose folder / use default, and back up
     now. Backup state is visible in the status area.

**Backups are a provider list**, each provider with init, on-save and flush.
A failing provider never blocks the others or the save itself.

**Other file features:**
- The save directory defaults to a folder in the user's Documents and can be
  changed.
- New, Open, and Open Recent.
- **Export** as plain text or Markdown, with cold storage optionally
  included and bookkeeping never included.
- **Print** uses the native dialog, with a paper layout free of app chrome.
- The last file reopens on launch.
- The filename can reveal the file in Finder.

---

## 11. Themes, fonts, and visual system

The visual language belongs to the user. The system must make it easy to
apply and change.

- **Design tokens:** all appearance (color, type, spacing, radii, motion,
  surfaces) comes from shared, named tokens. Components reference tokens,
  never literal values.
- **Themes:** multiple named themes, switchable instantly and persisted. The
  theme is applied before first paint, so there's no flash. The user
  decides the set; expect a mix of calm light/dark themes and playful
  retro ones.
- **Theme picker:** previews each theme in context (not just swatches),
  applies a theme on selection while staying open for comparison, and is
  fully keyboard-operable. Each theme also has its own palette entry.
- **Fonts:** a choice of writing typefaces (for example mono, serif, and sans).
  Typography must stay coherent in each; for example, headings must not rely
  on synthesized bold in a monospaced face.
- **Contrast:** every theme's least prominent text still meets WCAG AA
  (4.5:1) against its backgrounds. An automated test enforces this against
  the real theme values.
- **Reduced motion:** all motion respects the system reduced-motion setting.

---

## 12. AI helpers (optional, personal)

**Purpose:** reduce the busywork of summarizing and naming scenes during
revision, without ever writing prose for the author.

- **Summarize:** for one scene, or all scenes at once, from the corkboard.
- **Suggest name:** for scenes and chapters. Offers **three** options from
  different angles (concrete, dramatic, and thematic). Suggestions use the
  book title, chapter, neighboring titles, existing title vocabulary, and
  the user's optional "titles I like" examples. **Nothing is applied until
  the user picks.**
- **Rules:**
  - runs only on an explicit action;
  - AI actions are consistently identifiable;
  - errors are reported plainly;
  - every applied result can be undone immediately. Undoing a summary also
    clears its cache entry, and titles use the editor's undo;
  - AI receives **plain prose from the model**, never markup.
- **Caching:** results are cached locally by a hash of the prose. Unchanged
  scenes are never re-sent, an edit invalidates the cache, and summaries
  survive renames.
- **Privacy:**
  - The API key is stored encrypted in the OS keychain.
  - Provider calls and credentials stay **on the privileged side only**.
  - The UI can set or remove the key but **never read it back**.
  - Responses use strict structured output.
  - The provider is swappable.

---

## 13. Accessibility requirements

- **Controls and roles:** every interactive element is a real button or a
  correct composite widget. The outline is a **tree**, the mode switch a
  **tablist** with a roving tab stop, the palette a **dialog/combobox/
  listbox** with a focus trap, and the font picker a **radiogroup**.
- **Focus:** a visible indicator on keyboard focus, and not on mouse click.
- **Reduced motion:** honored everywhere.
- **Screen readers:** decorative elements and structure numbering are hidden
  from assistive tech, and chapter and scene headings are exposed as
  headings.
- **Hover and targets:** anything revealed on hover is also revealed on
  keyboard focus. Targets are comfortably sized.

---

## 14. Technical design

### 14.1 Process architecture
- **Privileged side:** windowing, file system, settings, the save pipeline
  (§10), backup and AI providers, credential encryption, native menus,
  printing, and reveal-in-Finder.
- **UI side:** the editor, app shell, and features. It has **no direct file
  or network access for manuscript or credential operations**. It talks to
  the privileged side over a narrow bridge of named messages:
  - content and cursor changes; save now; open file;
  - load/save notes; export; print;
  - AI and backup actions;
  - persisted preferences: theme, paragraph spacing, and outline state (mode,
    typewriter, and focus are per-session and never restored).
- **Security and testing:** a strict content-security policy on the UI; a
  small, validated settings file; and the UI can launch hidden for tests.

### 14.2 Layers (UI side)
1. **Model:** the manuscript tree, its operations, and the undo history.
   - Every change is a **transaction** made of operations: insert/delete
     text, add/remove a mark, split/merge a paragraph, rename, move,
     split/delete a scene, archive, restore, link, and unlink.
   - Each transaction is one undo step and reports what changed.
2. **Serializer / parser:** the only place file syntax exists. It is pure and
   exhaustively tested.
3. **Editor surface:** renders the model and maps keyboard, mouse,
   clipboard, and input-method input into transactions.
   - It owns caret and selection rules (§4.4), typewriter behavior,
     numbering, note indicators, and search highlighting.
   - It stays smooth on a full novel, virtualized where needed, with stable
     scroll heights.
4. **App shell:** the palette engine, toasts, font picker, file wiring, and
   **mode activation**.
5. **Feature modules:** each self-contained, exposing
   `{ id, init(ctx), destroy(), commandGroups(), keybindings() }`.
   - `ctx` provides the model and editor APIs, the bridge, shared state,
     toasts, and focus.
   - Features: core, sprint timer, find/replace, and scene navigation.
6. **Mode registry:** mode → feature ids.
   - Adding a feature = one module + one line.
   - Switching modes tears down the outgoing features, initializes the
     incoming ones, merges their commands and keybindings, and exposes the
     active mode to the presentation layer. (The mode is not restored at the next
     launch: the app always starts in Manuscript.)
7. **Mode-agnostic views** are mounted once: the theme picker, notes, and
   settings.

### 14.3 Design rules
- **Views read the model, never text.** Commands are model operations; none
  regenerates a document string.
- **Minimal re-render:** after a transaction, only affected blocks
  re-render, and unaffected content keeps its on-screen position.
- **Hidden content takes no space:** it contributes no scroll height (cold
  storage, and everything outside an isolated scene view).
- **Spacing lives in block layout**, not per-line margins.
- **Appearance is token- and theme-driven**, and mode-specific presentation
  is driven by the active mode.
- **Performance:** typing latency is imperceptible on a 150,000-word
  manuscript, and opening and saving a novel feels instant.

---

## 15. Verification protocol

### 15.1 Test layers
- **Serializer/parser (highest priority):**
  - round-trips of every construct;
  - imported Markdown and plain-text files;
  - hand-edited files;
  - preservation of unknown constructs;
  - pathological input: empty, huge, odd whitespace, and prose that happens
    to look like markup.
- **Model and editor behavior:**
  - caret movement and clicks around every boundary;
  - Enter/Backspace/Delete at scene edges;
  - mark toggling and continuation;
  - undo/redo of every command;
  - paste.

  These assert on the **model**, never on markup strings or visual styling.
- **End-to-end:** the **real app, hidden**, with isolated scratch data and
  save directories, driven through the debugging protocol. Test files run
  **sequentially** because they share a port range.
- **Don't pin design in tests:** avoid asserting exact pixels, colors, or
  positions unless the user has fixed them. Test content, behavior, and
  state, so the user can change the design without breaking the suite.

### 15.2 Rules
- **Bug fix = failing test first**, confirmed failing on the unfixed code.
- **Assert against model or editor state, not the DOM selection.** Hidden
  windows make DOM selection unreliable.
- **Drag-and-drop:** prove a drag can start using real OS-level input events.
  Keep separate drags in separate tests, with realistic pacing.
- **Compare against a baseline:** run the same tests on a clean copy of the
  code before your change and diff the failing test names. Only new failures are yours.
- **Clean up interrupted runs:** they can orphan a hidden app that holds the
  debug port, which makes later runs fail en masse. Kill leftover test app
  processes before re-running.
- **Live-verify** in the real app, and state anything you couldn't verify.

### 15.3 Definition of done
- [ ] Content and behavior match this spec; visuals match the user's
      direction.
- [ ] No markup is visible or reasoned about outside the serializer/parser.
- [ ] The caret never lands in a gap, and typing never damages structure.
- [ ] Every command is one undo step and never jumps the viewport.
- [ ] Saved files round-trip exactly and read cleanly elsewhere.
- [ ] Works in both modes where applicable, in every theme, and with every
      font.
- [ ] Keyboard-operable, with visible focus and correct roles.
- [ ] Tests added. The full suite shows no new failures against the baseline.
- [ ] Built and installed for the user when the task calls for it. The
      installed copy is verified to match the build.
- [ ] The project's progress log is updated for significant work. **Nothing is committed
      unless asked.**

---

## 16. Out of scope for the first version

- **Hosted AI:** there's no hosted AI service. The user supplies their own
  key.
- **Collaboration:** there's no multi-user editing or syncing between
  devices. Cloud backup is a backup, not sync.
- **Cold storage on the corkboard:** not shown there, at least at first.
- **Spellcheck:** out of scope at first. If it's added, it must be
  mode-aware and never mark anything but prose.
- **Code signing and distribution:** these are personal builds, and signing
  and notarization can come later.
