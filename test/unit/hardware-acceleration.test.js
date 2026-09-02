import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(here, '../../src/main.js'), 'utf8');

test('disables hardware acceleration before creating any BrowserWindow', () => {
  const disableAt = mainSource.indexOf('app.disableHardwareAcceleration()');
  const windowAt = mainSource.indexOf('new BrowserWindow(');

  assert.notEqual(disableAt, -1, 'hardware acceleration must be disabled');
  assert.notEqual(windowAt, -1, 'main process must create a BrowserWindow');
  assert.ok(disableAt < windowAt, 'hardware acceleration must be disabled before BrowserWindow creation');
});
