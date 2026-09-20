// Daily local snapshots, kept separately from the manuscript directory and
// from cloud backup providers. Each source file gets one dated copy per day.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3650;

let backupRoot = null;
let retentionDays = DEFAULT_RETENTION_DAYS;

function clampRetention(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_RETENTION_DAYS, n)) : DEFAULT_RETENTION_DAYS;
}

function configure({ root, days } = {}) {
  if (root) backupRoot = root;
  if (days !== undefined) retentionDays = clampRetention(days);
  return status();
}

function sourceKey(filePath) {
  const digest = crypto.createHash('sha256').update(path.resolve(filePath)).digest('hex').slice(0, 16);
  const name = path.basename(filePath).replace(/[^a-zA-Z0-9._-]+/g, '_') || 'manuscript.md';
  return `${digest}-${name}`;
}

function dayStamp(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function snapshotPath(filePath, date = new Date()) {
  return path.join(backupRoot, sourceKey(filePath), `${dayStamp(date)}${path.extname(filePath) || '.md'}`);
}

function ensureRoot() {
  if (!backupRoot) return false;
  fs.mkdirSync(backupRoot, { recursive: true });
  return true;
}

function init() {
  try { ensureRoot(); } catch (error) { console.error('backup(local): initialize failed:', error.message); }
}

function onSave(_dir, filePath) {
  if (!filePath || !fs.existsSync(filePath) || !ensureRoot()) return;
  try {
    const target = snapshotPath(filePath);
    if (fs.existsSync(target)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(filePath, target);
    cleanup();
  } catch (error) {
    console.error('backup(local): snapshot failed:', error.message);
  }
}

function cleanup() {
  if (!backupRoot || !fs.existsSync(backupRoot)) return { removed: 0 };
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const folder of fs.readdirSync(backupRoot, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const folderPath = path.join(backupRoot, folder.name);
    for (const file of fs.readdirSync(folderPath, { withFileTypes: true })) {
      if (!file.isFile()) continue;
      const filePath = path.join(folderPath, file.name);
      try {
        if (fs.statSync(filePath).mtimeMs < cutoff) { fs.unlinkSync(filePath); removed++; }
      } catch (_) {}
    }
    try {
      if (fs.readdirSync(folderPath).length === 0) fs.rmdirSync(folderPath);
    } catch (_) {}
  }
  return { removed };
}

function status() {
  let count = 0;
  if (backupRoot && fs.existsSync(backupRoot)) {
    for (const folder of fs.readdirSync(backupRoot, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      try { count += fs.readdirSync(path.join(backupRoot, folder.name)).length; } catch (_) {}
    }
  }
  return { retentionDays, backupRoot, snapshotCount: count };
}

function flush(_dir, filePath, cb) {
  onSave(_dir, filePath);
  if (cb) cb();
}

module.exports = { DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS, configure, init, onSave, flush, cleanup, status, snapshotPath };
