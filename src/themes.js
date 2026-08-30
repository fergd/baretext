// Single source of truth for the theme id/display-name registry, shared by
// theme-picker.js's gallery cards and core.js's command-palette entries —
// previously each defined its own identical {id, name} list independently.
//
// This can't reach every duplicate: main.js is a separate (CommonJS) module
// graph from this one (ESM, loaded by the renderer) and can't import this
// file directly, so its own VALID_ACCENT_THEMES/THEME_BG stay put — that
// pairing already has a regression test (test/unit/theme-window-bg.test.js)
// guarding it against drift from index.html's --bg tokens. The actual CSS
// palette per theme (accent/text/syntax colors) lives in index.html's
// [data-theme="x"] blocks and isn't practical to centralize here without
// introducing a build step for what's currently plain CSS custom properties.
export const THEMES = [
  { id: 'dark', name: 'Ember' },
  { id: 'light', name: 'Parchment' },
  { id: 'amstrad', name: 'Amstrad' },
  { id: 'grove', name: 'Grove' },
  { id: 'dracula', name: 'Dracula' },
  // Just-for-fun bonus, not part of the original design spec (see
  // design_handoff_baretext/THEMES.md) -- appended last rather than next
  // to Amstrad (whose palette it borrows) so it reads as a bonus discovery
  // at the end of the gallery, not a variant of an existing card.
  { id: 'crt', name: 'CRT' },
];
