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
