// Backup provider registry. Each provider implements:
//   init(dir)              — called once per save directory (startup, or when it changes)
//   onSave(dir, filePath)   — called after every successful disk write; rate-limits itself
//   flush(dir, filePath, cb) — called on quit; cb() once its attempt is finished
//
// Providers run best-effort and never block or throw into the caller — a
// backup failure must never interrupt the actual save to disk.
//
// To add real cloud sync later (e.g. Google Drive): write a new provider
// module with this same shape and add it to the list below. Nothing else
// in this file or in main.js needs to change.

const localGit = require('./backup-providers/local-git');

const providers = [localGit];

function init(dir) {
  for (const p of providers) p.init(dir);
}

function onSave(dir, filePath) {
  for (const p of providers) p.onSave(dir, filePath);
}

function flush(dir, filePath, cb) {
  if (providers.length === 0) { if (cb) cb(); return; }
  let remaining = providers.length;
  const done = () => { remaining--; if (remaining <= 0 && cb) cb(); };
  for (const p of providers) p.flush(dir, filePath, done);
}

module.exports = { init, onSave, flush };
