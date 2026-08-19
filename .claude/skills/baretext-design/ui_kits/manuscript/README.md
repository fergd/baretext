# Manuscript rail — UI kit

The primary navigation surface of Baretext's **Manuscript** mode: a floating rail
listing chapters and their scenes, with a frozen "Cold Storage" section for cut
material. Composes the design-system components (ChapterHeader, SceneRow,
Connector, TextButton, IconButton, Icon) — it does not re-implement them.

- `index.html` — the full interactive rail (collapse chapters, select scenes,
  hover a row to swap its count for edit/delete).

Recreated from the working Manuscript rail component; values are on the 4px grid.
