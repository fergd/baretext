const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Send content changes for auto-save
  contentChanged: (content) => ipcRenderer.send('content-changed', content),

  // Cursor position — persisted so the app reopens where you left off
  cursorChanged: (pos) => ipcRenderer.send('cursor-changed', pos),

  // Manual save
  saveNow: (content) => ipcRenderer.send('save-now', content),
  onSaveConfirmed: (cb) => ipcRenderer.on('save-confirmed', cb),

  // File ops
  openFile: () => ipcRenderer.invoke('open-file'),
  exportFile: (content) => ipcRenderer.invoke('export-file', content),
  newFile: () => ipcRenderer.invoke('new-file'),

  // Theme
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_, t) => cb(t)),

  // File loaded / auto-saved feedback
  onFileLoaded: (cb) => ipcRenderer.on('file-loaded', (_, data) => cb(data)),
  onAutoSaved: (cb) => ipcRenderer.on('auto-saved', (_, path) => cb(path)),

  chooseSaveDir: () => ipcRenderer.invoke('choose-save-dir'),
});
