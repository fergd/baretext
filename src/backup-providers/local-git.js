// Local version history via a git repo inside the save directory.
//
// This solves a different problem than offsite backup: it makes every
// autosave a recoverable point, so an accidental overwrite (the whole file
// replaced with something else) can always be undone by walking history,
// independent of whatever's syncing the folder itself.
//
// Requires the system `git` binary. Runs entirely best-effort — a failure
// here must never interrupt or delay the actual save to disk.
//
// All git operations run through a single serial queue: git itself can't
// handle two concurrent operations on the same repo (the second hits
// index.lock and fails), and a save-triggered commit landing at the same
// moment as the quit-time flush is a completely normal thing to happen.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const COMMIT_INTERVAL_MS = 5 * 60 * 1000; // at most one commit per 5 min of activity
const GIT_TIMEOUT_MS = 10000;

let lastCommitAt = 0;
let initedDir = null;
let queue = Promise.resolve();

// Runs `task` after everything already queued has finished. `task` calls
// `done()` when it's finished (success or failure — the queue doesn't care).
function enqueue(task) {
  queue = queue.then(() => new Promise((resolve) => task(resolve)));
  return queue;
}

function run(dir, args, cb) {
  execFile('git', args, { cwd: dir, timeout: GIT_TIMEOUT_MS }, (err, stdout, stderr) => {
    if (cb) cb(err, stdout || '', stderr || '');
  });
}

function init(dir) {
  if (!dir || dir === initedDir) return;
  initedDir = dir;
  if (fs.existsSync(path.join(dir, '.git'))) return;

  enqueue((done) => {
    // Don't nest a repo inside some other git-tracked directory the save
    // folder happens to live in — that would produce confusing double history.
    run(dir, ['rev-parse', '--is-inside-work-tree'], (err, stdout) => {
      if (!err && stdout.trim() === 'true') { done(); return; }
      run(dir, ['init', '--quiet'], (initErr) => {
        if (initErr) { console.error('backup(local-git): init failed:', initErr.message); done(); return; }
        const gitignore = path.join(dir, '.gitignore');
        if (!fs.existsSync(gitignore)) {
          try { fs.writeFileSync(gitignore, '.DS_Store\n'); } catch (e) {}
        }
        // Commit .gitignore itself so it doesn't linger as an untracked file
        // forever — an untracked file makes every later "nothing changed"
        // commit attempt report it instead of cleanly finding nothing to do.
        run(dir, ['add', '--', '.gitignore'], () => {
          run(dir, [
            '-c', 'user.name=Baretext',
            '-c', 'user.email=baretext@local',
            'commit', '--quiet', '-m', 'Initialize local backup history'
          ], () => done());
        });
      });
    });
  });
}

function commit(dir, filePath, message, cb) {
  enqueue((done) => {
    const finish = (ok) => { done(); if (cb) cb(ok); };
    if (!dir || !filePath || !fs.existsSync(filePath)) { finish(false); return; }

    run(dir, ['add', '--', filePath], (addErr) => {
      if (addErr) { console.error('backup(local-git): add failed:', addErr.message); finish(false); return; }
      // Inline identity so a commit never fails for a missing global git
      // config — this repo's history doesn't need to mean anything beyond
      // "a recoverable point in time".
      run(dir, [
        '-c', 'user.name=Baretext',
        '-c', 'user.email=baretext@local',
        'commit', '--quiet', '-m', message
      ], (commitErr, stdout, stderr) => {
        if (commitErr) {
          const text = stdout + stderr;
          if (!/nothing to commit|nothing added to commit/i.test(text)) {
            console.error('backup(local-git): commit failed:', commitErr.message);
          }
          finish(false);
          return;
        }
        finish(true);
      });
    });
  });
}

function onSave(dir, filePath) {
  const now = Date.now();
  if (now - lastCommitAt < COMMIT_INTERVAL_MS) return;
  lastCommitAt = now;
  commit(dir, filePath, `autosave: ${new Date(now).toISOString()}`);
}

function flush(dir, filePath, cb) {
  lastCommitAt = Date.now();
  commit(dir, filePath, `autosave (session end): ${new Date().toISOString()}`, () => cb && cb());
}

module.exports = { init, onSave, flush };
