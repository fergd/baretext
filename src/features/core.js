// Baseline feature — always included in every mode. File commands, theme,
// font, typewriter, focus mode, markdown toggle, scene break, outline jump.
// The implementations live in app.js as shared ctx primitives; this module
// is the declarative manifest of commands + keybindings that call into them.
import { THEMES } from '../themes.js';

// Icon and the "(dark)"/"(light)" disambiguating suffix are palette-specific
// presentation, not part of a theme's core identity — id/name/order come
// from the shared THEMES registry (also used by theme-picker.js) so at
// least THOSE stay in sync automatically; only dark/light get a suffix
// since "Ember"/"Parchment" don't otherwise signal which they are, unlike
// Amstrad/Grove/Dracula.
const THEME_ICONS = { dark: 'ti-moon', light: 'ti-sun', amstrad: 'ti-terminal-2', grove: 'ti-trees', dracula: 'ti-ghost', crt: 'ti-device-tv-old', cga: 'ti-device-tv-old', gameboy: 'ti-device-gamepad-2' };
const THEME_LABEL_SUFFIX = { dark: ' (dark)', light: ' (light)' };

export default {
  id: 'core',

  keybindings(ctx) {
    return {
      'Mod-s':           () => ctx.cmdSave(),
      'Mod-n':            () => ctx.cmdNew(),
      'Mod-o':            () => ctx.cmdOpen(),
      'Mod-p':            () => ctx.cmdPrint(),
      'Mod-Shift-E':      () => ctx.cmdExport(),
      'Mod-Shift-T':      () => ctx.toggleTypewriter(),
      'Mod-Shift-F':      () => ctx.toggleFontPicker(),
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
          { label: 'Print',              icon: 'ti-printer',         keys: ['⌘','P'],         fn: ctx.cmdPrint },
          { label: 'Export as Markdown', icon: 'ti-file-export',     keys: ['⌘','⇧','E'],    fn: ctx.cmdExport },
          { label: 'Set save location',  icon: 'ti-folder-pin',      keys: [],                fn: ctx.cmdSaveDir },
        ]
      },
      { group: 'Navigate',
        items: [
          { label: 'Jump to chapter or scene', icon: 'ti-list-search', keys: ['⌘','⇧','O'],   fn: ctx.openOutline, keepOpen: true },
        ]
      },
      { group: 'AI',
        items: [
          { label: 'AI settings…', icon: 'ti-sparkles', keys: [], fn: ctx.openAiSettings },
        ]
      },
      { group: 'Backup',
        items: [
          { label: 'Backup settings…', icon: 'ti-cloud', keys: [], fn: ctx.openBackupSettings },
        ]
      },
      { group: 'Insert',
        items: [
          { label: 'Scene break',        icon: 'ti-minus',           keys: ['⌘','↵'],         fn: ctx.insertSceneBreak },
        ]
      },
      { group: 'View',
        items: [
          { label: 'Typewriter mode',          icon: 'ti-align-center', keys: ['⌘','⇧','T'],    fn: ctx.toggleTypewriter },
          { label: 'Change font',              icon: 'ti-typography',   keys: ['⌘','⇧','F'],    fn: ctx.toggleFontPicker },
          { label: 'Focus mode',               icon: 'ti-eye-off',      keys: ['⌘','.'],         fn: ctx.toggleFocus },
        ]
      },
      { group: 'Theme',
        items: [
          { label: 'Change theme…', icon: 'ti-palette', keys: [], fn: ctx.openThemePicker },
          ...THEMES.map((t) => ({
            label: t.name + (THEME_LABEL_SUFFIX[t.id] || ''),
            icon: THEME_ICONS[t.id],
            keys: [],
            themeKey: t.id,
            fn: () => ctx.setTheme(t.id),
          })),
        ]
      },
    ];
  },
};
