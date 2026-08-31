// Backup provider registry. Each provider implements:
//   init(dir)              — called once per save directory (startup, or when it changes)
//   onSave(dir, filePath)   — called after every successful disk write; rate-limits itself
//   flush(dir, filePath, cb) — called on quit; cb() once its attempt is finished
//
// Providers run best-effort and never block or throw into the caller — a
// backup failure must never interrupt the actual save to disk. Every call
// into a provider below is wrapped individually so one provider throwing
// synchronously can't break another's turn (in particular flush()'s fan-in:
// without this, a throw would skip that provider's `done()` and the quit-time
// callback would never fire for anyone).
//
// To add another provider: write a new module with this same shape and add
// it to the list passed to createBackupRegistry() below. Nothing else in
// this file or in main.js needs to change.

const localGit = require('./backup-providers/local-git');
const googleDrive = require('./backup-providers/google-drive');

function createBackupRegistry(providers) {
  function safeCall(provider, method, args) {
    try {
      provider[method](...args);
    } catch (e) {
      console.error(`backup: provider ${method} failed:`, e.message);
    }
  }

  function init(dir) {
    for (const p of providers) safeCall(p, 'init', [dir]);
  }

  function onSave(dir, filePath) {
    for (const p of providers) safeCall(p, 'onSave', [dir, filePath]);
  }

  function flush(dir, filePath, cb) {
    if (providers.length === 0) { if (cb) cb(); return; }
    let remaining = providers.length;
    const done = () => { remaining--; if (remaining <= 0 && cb) cb(); };
    for (const p of providers) {
      try {
        p.flush(dir, filePath, done);
      } catch (e) {
        console.error('backup: provider flush failed:', e.message);
        done();
      }
    }
  }

  return { init, onSave, flush };
}

module.exports = Object.assign(createBackupRegistry([localGit, googleDrive]), { createBackupRegistry });
