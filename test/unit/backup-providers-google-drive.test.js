// The Google Drive provider adapter (src/backup-providers/google-drive.js)
// is a thin rate-limiter around src/google-drive.js's backupDirectory() —
// this fakes that one call rather than re-exercising OAuth/Drive REST
// (already covered by google-drive.test.js and google-drive-api.test.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import googleDrive from '../../src/google-drive.js';
import provider from '../../src/backup-providers/google-drive.js';

function flushAsync(dir, filePath) {
  return new Promise((resolve) => provider.flush(dir, filePath, resolve));
}

test('onSave() rate-limits to at most one sync per interval, flush() always syncs', async (t) => {
  const backupDirectory = t.mock.method(googleDrive, 'backupDirectory', async () => ({ ok: true }));

  provider.onSave('/save/dir');
  provider.onSave('/save/dir');
  provider.onSave('/save/dir');
  // onSave() fires the sync without waiting on it — give the microtask
  // queue a turn so the fire-and-forget call actually lands before we count it.
  await Promise.resolve();
  await Promise.resolve();
  const callsFromRapidOnSave = backupDirectory.mock.calls.length;
  assert.ok(callsFromRapidOnSave <= 1, `expected at most one sync from rapid onSave() calls, got ${callsFromRapidOnSave}`);

  // flush() (quit-time) always attempts a sync regardless of the interval.
  await flushAsync('/save/dir', '/save/dir/book.md');
  assert.equal(backupDirectory.mock.calls.length, callsFromRapidOnSave + 1);
});

test('a rejected sync is caught, never becomes an unhandled rejection, and flush() still calls back', async (t) => {
  t.mock.method(googleDrive, 'backupDirectory', async () => { throw new Error('network down'); });
  await assert.doesNotReject(flushAsync('/save/dir', '/save/dir/book.md'));
});
