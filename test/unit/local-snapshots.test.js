import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import snapshots from '../../src/backup-providers/local-snapshots.js';

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-local-snapshots-')); }

test('creates one dated local snapshot per manuscript per day', () => {
  const root = tempDir();
  const sourceDir = tempDir();
  const file = path.join(sourceDir, 'book.md');
  fs.writeFileSync(file, 'first version');
  snapshots.configure({ root, days: 30 });
  snapshots.init(sourceDir);
  snapshots.onSave(sourceDir, file);
  fs.writeFileSync(file, 'second version');
  snapshots.onSave(sourceDir, file);

  const status = snapshots.status();
  assert.equal(status.snapshotCount, 1);
  const folder = fs.readdirSync(root)[0];
  const copy = fs.readFileSync(path.join(root, folder, fs.readdirSync(path.join(root, folder))[0]), 'utf8');
  assert.equal(copy, 'first version');
});

test('cleanup removes snapshots older than the configured retention window', () => {
  const root = tempDir();
  const sourceDir = tempDir();
  const file = path.join(sourceDir, 'book.md');
  fs.writeFileSync(file, 'version');
  snapshots.configure({ root, days: 1 });
  snapshots.onSave(sourceDir, file);
  const folder = path.join(root, fs.readdirSync(root)[0]);
  const snapshot = path.join(folder, fs.readdirSync(folder)[0]);
  const old = Date.now() - 3 * 24 * 60 * 60 * 1000;
  fs.utimesSync(snapshot, old / 1000, old / 1000);

  const result = snapshots.cleanup();
  assert.equal(result.removed, 1);
  assert.equal(snapshots.status().snapshotCount, 0);
});

test('retention days are clamped to a safe range', () => {
  const root = tempDir();
  assert.equal(snapshots.configure({ root, days: 0 }).retentionDays, 1);
  assert.equal(snapshots.configure({ days: 99999 }).retentionDays, 3650);
});
