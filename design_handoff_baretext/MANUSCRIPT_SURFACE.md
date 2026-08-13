# Baretext — Manuscript Surface (Editor mode)

The document reading/writing surface in **Editor mode**. Chapters and scenes carry a right-aligned number gutter that hangs in the left margin; the prose column is centered in the viewport. Sprinter mode does **not** use this — it stays stripped (no gutter, no numbers). Visual reference: `Manuscript Surface.dc.html`.

## Layout model

The **text measure is centered in the viewport**; numbers hang into the left margin — they do not shift the text off-center.

- Wrapper: `max-width: var(--measure)` (`60ch`), `margin: 0 auto`, `padding: 72px 40px 40vh` (generous bottom padding so the last line can scroll to a comfortable position).
- Each chapter/scene header is `position: relative`; its number is `position: absolute; right: calc(100% + var(--gap)); top: 0; width: var(--gutter); text-align: right`. This pins the number in the margin, right-aligned toward the text, without affecting the centered column.
- Body paragraphs are plain full-measure blocks (no gutter cell).

### Tokens (layout)
| token | value | meaning |
|---|---|---|
| `--measure` | `60ch` | text column width |
| `--gutter` | `88px` | number column width (right-aligned) |
| `--gap` | `40px` | space between gutter and text |

## Typographic scale (JetBrains Mono — placeholder)

> ⚠ Font is **JetBrains Mono** as a stand-in for verification. Confirm the production manuscript font before shipping; only `font-family` changes, the scale holds.

| element | size | weight | line-height | color |
|---|---|---|---|---|
| Chapter title (H1) | 56px | 700 | 1.05 | `--accent` |
| Chapter number (gutter) | 56px | 400 | 1.05 | `--text-dimmer` |
| Scene heading (H2) | 28px | 400 | 1.1 | `--text-dim` |
| Scene number (gutter) | 28px | 400 | 1.1 | `--text-dimmer` |
| Body paragraph | 19px | 400 | 1.65 | `--text` |

Body paragraphs: `margin-top: 24px`, `text-wrap: pretty`. Numbers use `font-variant-numeric: lining-nums`.

## Numbers

- **Chapter:** the chapter index alone — `1`.
- **Scene:** `chapter.scene` — `1.1`, `1.2`, … (prefixed by chapter).
- **Color:** always `--text-dimmer` — deliberately subdued, shadow-like, so the gutter anchors structure without competing with the prose. Never accent.
- **Alignment:** right-aligned within the gutter (toward the text column).

## Chapter title

- Renders the chapter name as H1 in `--accent`.
- **Fallback:** if the name is empty/blank, render **"Untitled"** in `--text-dimmer`, italic, weight 400 — reads as a placeholder, not a real title. (Compute the fallback in logic; don't put the `|| 'Untitled'` in the template.)

## Scenes — named vs unnamed

- **Named scene:** the name as an H2 heading (28px, `--text-dim`), number in the gutter.
- **Unnamed scene:** no heading. Render a **centered ornament divider** in `--scene`, number still in the gutter. This is how a scene break reads in flowing prose.
  - The divider is a **Hugeicons glyph** (⚠ in the mockup it's a hand-drawn line·ring·line placeholder — swap for the real Hugeicons scene-break icon; confirm the exact icon name). Center it, tint `--scene`, keep it small and quiet.

## `--scene` accent

A distinct warm accent for scene-break ornaments, separate from `--accent`. **Now a real semantic token in `tokens/colors.css`** (added to all five theme blocks alongside `--accent`), so it recomposes per theme like every other token — reference `var(--scene)`, never hard-code.
| theme | `--scene` |
|---|---|
| Ember (`dark`) | `#d98a3f` |
| Parchment (`light`) | `#a8631a` |
| Amstrad | `#7dc45a` |
| Grove | `#e69875` |
| Dracula | `#8be9fd` |

## Responsive

- **< 900px:** hide the entire chapter/scene number aside (`.gutter-num { display: none }`) — there isn't enough left margin to hang it. The centered prose, named-scene headings, and the ornament divider all remain, so structure stays legible without the numbers.

## Notes for implementation
- This is Editor-only. Gate it on `data-mode="editor"`; Sprinter renders the stripped surface.
- All colors from theme tokens — no hard-coded hex. `--scene` is already in the token set. (The reference DC inlines the token values in a `<style>` block because standalone mockups can't link the system stylesheet — in the app, link `styles.css` and reference the tokens.)
- The number gutter is presentational; keep headings as real `<h1>`/`<h2>` for document outline / a11y. The ornament divider is `aria-hidden="true"`.
