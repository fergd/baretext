# Baretext

Distraction-free macOS writing app for long-form fiction. Fresh build.

Read before working:
1. `docs/AGENT_SPEC.md` — product spec and rules (read §0 first).
2. `docs/DECISIONS.md` — settled decisions; **overrides the spec where marked**.
3. `docs/PROGRESS.md` — what's built, verified and open; read the latest
   checkpoint at the end first.

Key rules (details in the docs above):
- Protect the manuscript above all. Nothing may silently lose or corrupt text.
- The manuscript is a ProseMirror tree. Markdown exists only in
  `packages/format` (serializer/parser).
- Structure is not text: the caret never enters a boundary; typing never
  damages structure.
- Visuals follow the user's Figma direction; Linear and Obsidian are the UI and
  experience influences; all appearance from tokens; 4px grid.
- Every behavior change needs live verification and automated tests. Bug fix =
  failing test first.
- Test windows run hidden with throwaway data dirs; never steal focus.
- Never commit or push unless asked.
- Integrations (Google sign-in, Drive, Anthropic proxy on Railway) are
  deferred — design is in `docs/DECISIONS.md` §7.
