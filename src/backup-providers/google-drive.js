// Google Drive cloud backup provider — same init/onSave/flush shape as
// local-git.js, but syncs the whole save directory rather than just the file
// that changed: a save folder can hold many manuscripts, and Drive should
// mirror all of them, not just today's. The actual OAuth/API work lives in
// ../google-drive.js; this file only adds rate-limiting on top of it, the
// same role local-git.js plays around its own git commits.
//
// A no-op (not an error) whenever Drive isn't connected yet — backupDirectory()
// itself detects that and resolves {ok:false, skipped:true} rather than throwing.

const googleDrive = require('../google-drive');

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // at most one sync per 5 min of activity

let lastSyncAt = 0;
let inFlight = null;

function sync(dir) {
  if (!inFlight) {
    inFlight = googleDrive.backupDirectory(dir).finally(() => { inFlight = null; });
  }
  return inFlight;
}

function init() {}

function onSave(dir) {
  const now = Date.now();
  if (now - lastSyncAt < SYNC_INTERVAL_MS) return;
  lastSyncAt = now;
  sync(dir).catch((e) => console.error('backup(google-drive): sync failed:', e.message));
}

function flush(dir, filePath, cb) {
  lastSyncAt = Date.now();
  sync(dir)
    .catch((e) => console.error('backup(google-drive): sync failed:', e.message))
    .finally(() => cb && cb());
}

module.exports = { init, onSave, flush };
