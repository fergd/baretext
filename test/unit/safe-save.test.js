import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import safeSave from '../../src/safe-save.js';

const { createSafeWriter, isCatastrophicTruncation, snapshotDirFor } = safeSave;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-safe-save-'));
  return {
    root,
    filePath: path.join(root, 'book.md'),
    recoveryRoot: path.join(root, 'recovery'),
  };
}

test('classifies a large manuscript becoming empty as catastrophic', () => {
  assert.equal(isCatastrophicTruncation('word '.repeat(4000), ''), true);
  assert.equal(isCatastrophicTruncation('short draft', ''), false);
});

test('blocks Cmd-Z-shaped whole-manuscript erasure and leaves disk bytes untouched', () => {
  const { filePath, recoveryRoot } = fixture();
  const manuscript = '# Chapter 1\n\n' + 'The manuscript survives. '.repeat(1000);
  fs.writeFileSync(filePath, manuscript, 'utf8');
  const writer = createSafeWriter({ recoveryRoot });

  const result = writer.write(filePath, '');

  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(fs.readFileSync(filePath, 'utf8'), manuscript);
  assert.equal(fs.readFileSync(result.snapshotPath, 'utf8'), manuscript);
});

test('snapshots the prior version and atomically saves normal edits', () => {
  const { filePath, recoveryRoot } = fixture();
  const before = 'A normal manuscript. '.repeat(300);
  const after = before + '\nA new paragraph.';
  fs.writeFileSync(filePath, before, 'utf8');
  const writer = createSafeWriter({ recoveryRoot });

  const result = writer.write(filePath, after);

  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(filePath, 'utf8'), after);
  assert.equal(fs.readFileSync(result.snapshotPath, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)).sort(), ['book.md', 'recovery']);
});

test('allows empty content for a genuinely new file', () => {
  const { filePath, recoveryRoot } = fixture();
  const writer = createSafeWriter({ recoveryRoot });
  assert.equal(writer.write(filePath, '').ok, true);
  assert.equal(fs.readFileSync(filePath, 'utf8'), '');
});

test('rotates recovery snapshots without deleting the newest versions', () => {
  const { filePath, recoveryRoot } = fixture();
  const writer = createSafeWriter({ recoveryRoot, maxSnapshots: 2 });
  fs.writeFileSync(filePath, 'version one', 'utf8');
  writer.write(filePath, 'version two');
  writer.write(filePath, 'version three');
  writer.write(filePath, 'version four');

  const dir = snapshotDirFor(recoveryRoot, filePath);
  const snapshots = fs.readdirSync(dir);
  assert.equal(snapshots.length, 2);
  const contents = snapshots.map((name) => fs.readFileSync(path.join(dir, name), 'utf8'));
  assert.ok(contents.includes('version two'));
  assert.ok(contents.includes('version three'));
});
