const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Send content changes for auto-save
  contentChanged: (content) => ipcRenderer.send('content-changed', content),

  // Cursor position — persisted so the app reopens where you left off
  cursorChanged: (pos) => ipcRenderer.send('cursor-changed', pos),

  // Manual save
  saveNow: (content) => ipcRenderer.send('save-now', content),
  onSaveConfirmed: (cb) => ipcRenderer.on('save-confirmed', cb),

  onEditHistory: (cb) => ipcRenderer.on('edit-history', (_, direction) => cb(direction)),

  // File ops
  openFile: () => ipcRenderer.invoke('open-file'),
  exportFile: (content) => ipcRenderer.invoke('export-file', content),
  printDocument: () => ipcRenderer.invoke('print-document'),
  newFile: () => ipcRenderer.invoke('new-file'),

  // Provider-neutral AI tasks. API credentials remain in the main process.
  aiStatus: () => ipcRenderer.invoke('ai-status'),
  aiTitlePreferences: () => ipcRenderer.invoke('ai-title-preferences'),
  aiSaveTitlePreferences: (payload) => ipcRenderer.invoke('ai-save-title-preferences', payload),
  aiSaveKey: (apiKey) => ipcRenderer.invoke('ai-save-key', apiKey),
  aiRemoveKey: () => ipcRenderer.invoke('ai-remove-key'),
  onOpenAiSettings: (cb) => ipcRenderer.on('open-ai-settings', cb),
  aiCachedSummaries: (scenes) => ipcRenderer.invoke('ai-cached-summaries', scenes),
  aiRemoveCachedSummaries: (scenes) => ipcRenderer.invoke('ai-remove-cached-summaries', scenes),
  aiSaveSummary: (scene) => ipcRenderer.invoke('ai-save-summary', scene),
  aiSummarizeScenes: (scenes) => ipcRenderer.invoke('ai-summarize-scenes', scenes),
  aiSuggestTitles: (payload) => ipcRenderer.invoke('ai-suggest-titles', payload),

  // Google Drive backup. Client credentials and tokens remain in the main process.
  backupStatus: () => ipcRenderer.invoke('backup-status'),
  backupSaveClientCredentials: (payload) => ipcRenderer.invoke('backup-save-client-credentials', payload),
  backupConnect: () => ipcRenderer.invoke('backup-connect'),
  backupDisconnect: () => ipcRenderer.invoke('backup-disconnect'),
  backupNow: () => ipcRenderer.invoke('backup-now'),
  backupSavePickerKey: (payload) => ipcRenderer.invoke('backup-save-picker-key', payload),
  backupChooseFolder: () => ipcRenderer.invoke('backup-choose-folder'),
  backupClearFolder: () => ipcRenderer.invoke('backup-clear-folder'),
  onOpenBackupSettings: (cb) => ipcRenderer.on('open-backup-settings', cb),

  // Local daily snapshots. This is deliberately separate from Google Drive.
  localBackupStatus: () => ipcRenderer.invoke('local-backup-status'),
  localBackupConfigure: (payload) => ipcRenderer.invoke('local-backup-configure', payload),
  localBackupCleanup: () => ipcRenderer.invoke('local-backup-cleanup'),

  // Theme
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_, t) => cb(t)),

  // Accent theme (dark/light/amstrad/grove/dracula) — persisted across launches
  setAccentTheme: (theme) => ipcRenderer.send('accent-theme-changed', theme),

  // Mode (sprinter/editor) — persisted across launches
  setMode: (mode) => ipcRenderer.send('mode-changed', mode),

  // Typewriter mode — persisted across launches
  setTypewriter: (on) => ipcRenderer.send('typewriter-changed', on),

  // Rail collapsed (Editor mode) — persisted across launches
  setRailCollapsed: (on) => ipcRenderer.send('rail-collapsed-changed', on),

  // Status bar filename -- click reveals the current file in Finder
  showInFinder: (filePath) => ipcRenderer.send('show-in-finder', filePath),

  // File loaded / auto-saved feedback
  onFileLoaded: (cb) => ipcRenderer.on('file-loaded', (_, data) => cb(data)),
  notesLoad: (filePath) => ipcRenderer.invoke('notes-load', filePath),
  notesSave: (filePath, notes) => ipcRenderer.invoke('notes-save', { filePath, notes }),
  onAutoSaved: (cb) => ipcRenderer.on('auto-saved', (_, path) => cb(path)),
  // A write to disk (auto-save or manual) failed — see main.js's saveToFile()
  onSaveError: (cb) => ipcRenderer.on('save-error', (_, data) => cb(data)),

  chooseSaveDir: () => ipcRenderer.invoke('choose-save-dir'),
});
