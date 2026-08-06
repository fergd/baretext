// Baseline feature — always included in every mode. File commands, theme,
// font, typewriter, focus mode, markdown toggle, scene break, outline jump.
// The implementations live in app.js as shared ctx primitives; this module
// is the declarative manifest of commands + keybindings that call into them.
export default {
  id: 'core',

  keybindings(ctx) {
    return {
      'Mod-s':           () => ctx.cmdSave(),
      'Mod-n':            () => ctx.cmdNew(),
      'Mod-o':            () => ctx.cmdOpen(),
      'Mod-Shift-E':      () => ctx.cmdExport(),
      'Mod-Shift-T':      () => ctx.toggleTypewriter(),
      'Mod-Shift-F':      () => ctx.toggleFontPicker(),
      'Mod-Shift-M':      () => ctx.toggleRenderedMode(),
      'Mod-Shift-O':      () => ctx.openOutline(),
      'Mod-Shift-Minus':  () => ctx.insertSceneBreak(),
      'Mod-Enter':        () => ctx.insertSceneBreak(),
      'Mod-Period':       () => ctx.toggleFocus(),
    };
  },

  commandGroups(ctx) {
    return [
      { group: 'File',
        items: [
          { label: 'New file',           icon: 'ti-file-plus',       keys: ['⌘','N'],         fn: ctx.cmdNew },
          { label: 'Open file',          icon: 'ti-folder-open',     keys: ['⌘','O'],         fn: ctx.cmdOpen },
          { label: 'Save',               icon: 'ti-device-floppy',   keys: ['⌘','S'],         fn: ctx.cmdSave },
          { label: 'Export as Markdown', icon: 'ti-file-export',     keys: ['⌘','⇧','E'],    fn: ctx.cmdExport },
          { label: 'Set save location',  icon: 'ti-folder-pin',      keys: [],                fn: ctx.cmdSaveDir },
        ]
      },
      { group: 'Navigate',
        items: [
          { label: 'Jump to chapter or scene', icon: 'ti-list-search', keys: ['⌘','⇧','O'],   fn: ctx.openOutline, keepOpen: true },
        ]
      },
      { group: 'Insert',
        items: [
          { label: 'Scene break',        icon: 'ti-minus',           keys: ['⌘','↵'],         fn: ctx.insertSceneBreak },
        ]
      },
      { group: 'View',
        items: [
          { label: 'Markdown: toggle symbols', icon: 'ti-markdown',     keys: ['⌘','⇧','M'],    fn: ctx.toggleRenderedMode },
          { label: 'Typewriter mode',          icon: 'ti-align-center', keys: ['⌘','⇧','T'],    fn: ctx.toggleTypewriter },
          { label: 'Change font',              icon: 'ti-typography',   keys: ['⌘','⇧','F'],    fn: ctx.toggleFontPicker },
          { label: 'Focus mode',               icon: 'ti-eye-off',      keys: ['⌘','.'],         fn: ctx.toggleFocus },
        ]
      },
      { group: 'Theme',
        items: [
          { label: 'Change theme…', icon: 'ti-palette', keys: [], fn: ctx.openThemePicker },
          { label: 'Ember (dark)',      icon: 'ti-moon',       keys: [], themeKey: 'dark',    fn: () => ctx.setTheme('dark') },
          { label: 'Parchment (light)', icon: 'ti-sun',        keys: [], themeKey: 'light',   fn: () => ctx.setTheme('light') },
          { label: 'Amstrad',           icon: 'ti-terminal-2', keys: [], themeKey: 'amstrad', fn: () => ctx.setTheme('amstrad') },
          { label: 'Grove',             icon: 'ti-trees',      keys: [], themeKey: 'grove',   fn: () => ctx.setTheme('grove') },
          { label: 'Dracula',           icon: 'ti-ghost',      keys: [], themeKey: 'dracula', fn: () => ctx.setTheme('dracula') },
        ]
      },
    ];
  },
};
