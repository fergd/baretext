import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../../src/main.js'), 'utf8');

test('the native application menu exposes File > Print with the standard shortcut', () => {
  assert.doesNotMatch(source, /Menu\.setApplicationMenu\(null\)/);
  assert.match(source, /label:\s*'File'/);
  assert.match(source, /label:\s*'Print…'/);
  assert.match(source, /accelerator:\s*'CmdOrCtrl\+P'/);
  assert.match(source, /Menu\.setApplicationMenu\(Menu\.buildFromTemplate\(template\)\)/);
});

test('the macOS application menu exposes personal AI settings', () => {
  assert.match(source, /label:\s*'AI Settings…'/);
  assert.match(source, /webContents\.send\('open-ai-settings'\)/);
});

test('the macOS application menu exposes Google Drive backup settings', () => {
  assert.match(source, /label:\s*'Backup Settings…'/);
  assert.match(source, /webContents\.send\('open-backup-settings'\)/);
});

test('native Edit commands route manuscript history while other windows keep native history', async () => {
  const { runInNewContext } = await import('node:vm');
  const sent = [];
  let template;
  let focused;
  const mainWindow = { webContents: { send: (...args) => sent.push(args) } };
  const install = source.slice(source.indexOf('function installApplicationMenu()'), source.indexOf('\nfunction createWindow()'));
  runInNewContext(install + '\ninstallApplicationMenu();', {
    process: { platform: 'darwin' }, mainWindow,
    BrowserWindow: { getFocusedWindow: () => focused },
    Menu: { buildFromTemplate: value => { template = value; return value; }, setApplicationMenu() {} },
  });
  const edit = template.find(item => item.label === 'Edit').submenu;
  const undo = edit.find(item => item.label === 'Undo');
  const redo = edit.find(item => item.label === 'Redo');
  assert.equal(undo.accelerator, 'CmdOrCtrl+Z');
  assert.equal(redo.accelerator, 'CmdOrCtrl+Shift+Z');
  focused = mainWindow;
  undo.click(); redo.click();
  assert.deepEqual(sent, [['edit-history', 'undo'], ['edit-history', 'redo']]);
  let nativeUndo = 0;
  focused = { webContents: { undo: () => nativeUndo++ } };
  undo.click();
  assert.equal(nativeUndo, 1);
  assert.equal(sent.length, 2);
});
