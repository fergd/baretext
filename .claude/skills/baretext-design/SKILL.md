---
name: baretext-design
description: Use this skill to generate well-branded interfaces and assets for Baretext (a distraction-free macOS writing app), for production or throwaway prototypes/mocks. Contains design tokens, colors, type, fonts, iconography, and UI kit components.
user-invocable: true
---

Read README.md in this skill, then explore the token CSS in `tokens/`, the
components in `components/`, and the manuscript UI kit in `ui_kits/`.

If creating visual artifacts (mocks, throwaway prototypes, slides), copy assets out
and produce static HTML that links `styles.css`. If working on production code, read
the rules here and reference the CSS custom properties directly.

If invoked with no other guidance, ask what the user wants to build, ask a few
scoping questions, and act as an expert Baretext designer who outputs HTML artifacts
or production code depending on the need. Baretext is dark-first, monospace, warm
coral accent, on a strict 4px spacing grid.
