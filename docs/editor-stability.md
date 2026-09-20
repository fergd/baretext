# Editor stability contract

Branch: `refactor/editor-stability`. Baseline: `2abbe4b` (previous icons restored).

- CodeMirror owns the text, selection, and native editing behavior.
- Rail, floating outline, and corkboard use the same navigation controller.
  Resolve the current scene by session identity, reveal the editor, then make
  one selection/scroll request. Deleted targets do not jump to another scene.
- Typewriter centers explicit navigation and text edits, not mouse release,
  selection changes, modifier keys, or manual scrolling.
- Closing the corkboard without selecting a scene restores the saved viewport.
  Map that viewport through edits while the board is open.
- Structural commands may serialize text, but the editor applies a line diff
  with character-trimmed changes. Unchanged paragraphs retain their positions
  in CodeMirror's change and layout model. Each command is one undo step.
- Session outline identities follow mapped positions during typing, and unique
  scene content during structural moves. They are not saved in Markdown.
  Identical duplicate scenes can require positional disambiguation; this is
  not a persisted scene database or a new manuscript format.
- The rail subscribes to actual editor transactions, including paste and undo.
  Selection updates change highlights and breadcrumbs in place. Document edits
  rebuild the outline on a short debounce. Subscriptions end on mode exit.
- There is one formatted writing surface. The obsolete raw-source mode field,
  switch effect, and public setter are removed. Markdown still stores the file;
  formatting decorations remain, but never switch based on the cursor.

Verification includes repeated long-document jumps with typewriter on and off,
view round trips, stale row clicks, selected-scene moves, cold-storage exits,
linked-group undo, empty-scene typing, and manual scroll stability. These tests
provide specific regression coverage, not a claim that every interaction is
now defect-free.
