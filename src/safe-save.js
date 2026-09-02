const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MAX_SNAPSHOTS = 100;

function isCatastrophicTruncation(previous, next) {
  const oldSize = Buffer.byteLength(previous, 'utf8');
  const newSize = Buffer.byteLength(next, 'utf8');
  if (oldSize < 1024 || newSize >= oldSize) return false;
  if (newSize === 0) return true;
  return oldSize >= 4096 && newSize <= Math.max(256, Math.floor(oldSize * 0.1));
}

function snapshotDirFor(recoveryRoot, filePath) {
  const identity = crypto.createHash('sha256').update(path.resolve(filePath)).digest('hex').slice(0, 16);
  return path.join(recoveryRoot, `${path.basename(filePath)}-${identity}`);
}

function pruneSnapshots(dir, maxSnapshots) {
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.snapshot'))
    .sort()
    .reverse();
  for (const name of files.slice(maxSnapshots)) fs.unlinkSync(path.join(dir, name));
}

function createSafeWriter({ recoveryRoot, maxSnapshots = DEFAULT_MAX_SNAPSHOTS } = {}) {
  if (!recoveryRoot) throw new Error('recoveryRoot is required');

  function preserve(filePath, content) {
    const dir = snapshotDirFor(recoveryRoot, filePath);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const digest = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
    const snapshotPath = path.join(dir, `${stamp}-${digest}.snapshot`);
    if (!fs.existsSync(snapshotPath)) fs.writeFileSync(snapshotPath, content, { encoding: 'utf8', flag: 'wx' });
    pruneSnapshots(dir, maxSnapshots);
    return snapshotPath;
  }

  function write(filePath, content) {
    if (typeof content !== 'string') return { ok: false, blocked: true, reason: 'invalid save content' };

    let previous = null;
    if (fs.existsSync(filePath)) previous = fs.readFileSync(filePath, 'utf8');
    if (previous === content) return { ok: true, unchanged: true };

    let snapshotPath = null;
    if (previous !== null) snapshotPath = preserve(filePath, previous);
    if (previous !== null && isCatastrophicTruncation(previous, content)) {
      return {
        ok: false,
        blocked: true,
        reason: 'Baretext blocked a sudden, destructive reduction of the manuscript',
        snapshotPath,
      };
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    try {
      const fd = fs.openSync(tempPath, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, content, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tempPath, filePath);
      return { ok: true, snapshotPath };
    } catch (error) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
      throw error;
    }
  }

  return { write };
}

module.exports = { createSafeWriter, isCatastrophicTruncation, snapshotDirFor };
