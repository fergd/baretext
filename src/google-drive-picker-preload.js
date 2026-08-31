// Preload for the dedicated Google Drive folder-picker window
// (src/google-drive-picker.html, opened by src/main.js). Minimal bridge:
// the page's own script (loading Google's hosted Picker widget) needs the
// access token + Picker API key to build the picker, and needs a way to
// report the result back to main — same contextIsolation discipline as the
// main window's preload.js, just a much smaller surface.
const { contextBridge, ipcRenderer } = require('electron');

let resolveConfig;
const configPromise = new Promise((resolve) => { resolveConfig = resolve; });
ipcRenderer.once('picker-init', (event, config) => resolveConfig(config));

contextBridge.exposeInMainWorld('pickerBridge', {
  getConfig: () => configPromise,
  folderChosen: (folder) => ipcRenderer.send('picker-folder-chosen', folder),
  cancelled: () => ipcRenderer.send('picker-cancelled'),
});
