// backup.js / backup-providers/local-git.js had zero test coverage despite
// being the app's last line of defense against data loss (recoverable
// history independent of an autosave overwriting the file itself) — flagged
// in an architecture review. Pure Node logic, no Electron dependency, so
// real temp dirs + a real git binary are enough to exercise it honestly
// rather than mocking child_process.
//
// local-git.js's rate-limit state (lastCommitAt) and its serial work queue
// are MODULE-LEVEL, shared across every test in this file (and would leak
// across directories too, though the real app only ever has one save
// directory active at a time). Two things follow from that:
//   - init()/onSave()/flush() are all fire-and-forget from the caller's
//     side (no callback on init() at all) — flush()'s callback is the only
//     reliable sync point, since the queue is strictly serial: by the time
//     a flush() we called AFTER some other operation finishes, that earlier
//     operation is guaranteed to have already completed. Every test below
//     uses flush() as a drain point before asserting.
//   - a rate-limit test can't assume onSave() commits on its very first
//     call (an earlier test's flush() may have already set lastCommitAt
//     recently) — so the rate-limit test proves the throttle by calling
//     onSave() twice in immediate succession with genuinely different
//     content each time and checking AT MOST one commit resulted, which
//     holds regardless of what state earlier tests left behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import backup from '../../src/backup.js';

function mkTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-backup-test-'));
}

function gitLog(dir) {
  try {
    const out = execFileSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' }).trim();
    return out === '' ? [] : out.split('\n');
  } catch {
    return [];
  }
}

function headContent(dir, fileName) {
  return execFileSync('git', ['show', `HEAD:${fileName}`], { cwd: dir, encoding: 'utf8' });
}

function flushAsync(dir, filePath) {
  return new Promise((resolve) => backup.flush(dir, filePath, resolve));
}

// init() has no callback of its own (fire-and-forget) — draining it via an
// immediately-awaited flush() (harmless no-op target path) before capturing
// any "before" snapshot is required, not optional: without this, "before"
// gets captured while the init commit is still only queued, not landed,
// making every before/after diff below off by one.
async function initAndDrain(dir) {
  backup.init(dir);
  await flushAsync(dir, path.join(dir, '__drain__.md'));
}

test('init() creates a real git repo with an initial commit', async () => {
  const dir = mkTempDir();
  await initAndDrain(dir);

  assert.ok(fs.existsSync(path.join(dir, '.git')));
  const log = gitLog(dir);
  assert.ok(log.length >= 1);
  assert.ok(log[log.length - 1].includes('Initialize local backup history'));
});

test('init() is idempotent — calling it again on an already-inited dir does not error or duplicate the initial commit', async () => {
  const dir = mkTempDir();
  await initAndDrain(dir);
  const logAfterFirstInit = gitLog(dir);

  await initAndDrain(dir);
  const logAfterSecondInit = gitLog(dir);

  assert.deepEqual(logAfterSecondInit, logAfterFirstInit);
});

test('flush() commits a real file write, and the committed content matches what was on disk', async () => {
  const dir = mkTempDir();
  await initAndDrain(dir);
  const filePath = path.join(dir, 'test.md');
  fs.writeFileSync(filePath, 'hello world', 'utf8');

  const before = gitLog(dir);
  await flushAsync(dir, filePath);
  const after = gitLog(dir);

  assert.equal(after.length, before.length + 1);
  assert.ok(after[0].includes('autosave (session end)'));
  assert.equal(headContent(dir, 'test.md'), 'hello world');
});

test('flush() with a path that does not exist on disk is a safe no-op — no throw, callback still fires', async () => {
  const dir = mkTempDir();
  await initAndDrain(dir);
  const before = gitLog(dir);

  await flushAsync(dir, path.join(dir, 'never-written.md'));

  assert.deepEqual(gitLog(dir), before);
});

test('flush() with no changes since the last commit does not create an empty duplicate commit', async () => {
  const dir = mkTempDir();
  await initAndDrain(dir);
  const filePath = path.join(dir, 'stable.md');
  fs.writeFileSync(filePath, 'unchanging content', 'utf8');
  await flushAsync(dir, filePath);
  const afterFirstFlush = gitLog(dir);

  // Same content, no edit — a second flush has nothing new to commit.
  await flushAsync(dir, filePath);
  assert.deepEqual(gitLog(dir), afterFirstFlush);
});

test('onSave() rate-limits: two calls in immediate succession with different content produce at most one commit between them', async () => {
  const dir = mkTempDir();
  await initAndDrain(dir);
  const filePath = path.join(dir, 'rate-limit.md');

  fs.writeFileSync(filePath, 'first version', 'utf8');
  backup.onSave(dir, filePath);
  fs.writeFileSync(filePath, 'second version, changed moments later', 'utf8');
  backup.onSave(dir, filePath);

  const before = gitLog(dir);
  await flushAsync(dir, filePath); // drains both onSave attempts, then commits whatever's still pending
  const after = gitLog(dir);

  // If the rate limit did NOT throttle the second onSave, both onSave calls
  // would have committed genuinely different content (two distinct
  // commits) before flush ever ran. At most flush's own commit (for
  // whichever version, if any, never made it in via onSave) should land.
  assert.ok(after.length - before.length <= 1, `expected at most 1 new commit, got ${after.length - before.length}`);
  // Whatever ended up committed must be the FINAL content -- no data loss,
  // regardless of how the rate limit split the two onSave attempts.
  assert.equal(headContent(dir, 'rate-limit.md'), 'second version, changed moments later');
});
