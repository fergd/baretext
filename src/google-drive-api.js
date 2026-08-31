// Google Drive REST calls, scoped to what the `drive.file` OAuth scope
// permits: finding/creating a single app-owned folder, and creating/updating
// files inside it. Pure request/response functions — `google-drive.js` owns
// the access token and the local id/hash cache; everything here takes an
// access token and an injectable `fetchImpl` so it's unit-testable without
// real network access, matching src/ai-providers/openai.js's shape.

const crypto = require('crypto');

const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_NAME = 'Baretext Backups';
// Google's simple (non-resumable) upload ceiling. A manuscript this large
// would be well over a million words as plain text — resumable upload isn't
// worth building for a case this unlikely to occur.
const MAX_SIMPLE_UPLOAD_BYTES = 5 * 1024 * 1024;

function escapeQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveRequest(url, { accessToken, fetchImpl = global.fetch, ...opts }) {
  const response = await fetchImpl(url, {
    ...opts,
    headers: { Authorization: `Bearer ${accessToken}`, ...(opts.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && data.error && data.error.message;
    throw new Error(message || `Google Drive request failed (${response.status})`);
  }
  return data;
}

async function findFolder({ accessToken, fetchImpl }) {
  const q = `name='${escapeQueryValue(FOLDER_NAME)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const data = await driveRequest(`${FILES_ENDPOINT}?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id)`, {
    accessToken, fetchImpl, method: 'GET',
  });
  const match = (data.files || [])[0];
  return match ? match.id : null;
}

async function createFolder({ accessToken, fetchImpl }) {
  const data = await driveRequest(FILES_ENDPOINT, {
    accessToken, fetchImpl, method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  return data.id;
}

// Exported: also used directly by google-drive.js to check a user-picked
// (via the Picker widget) destination folder, which must NOT silently fall
// back to auto-creating "Baretext Backups" the way ensureFolder() below does.
async function verifyFolderExists({ accessToken, folderId, fetchImpl = global.fetch }) {
  try {
    const data = await driveRequest(`${FILES_ENDPOINT}/${folderId}?fields=id,trashed`, {
      accessToken, fetchImpl, method: 'GET',
    });
    return !data.trashed;
  } catch {
    return false;
  }
}

// Verifies the cached folder id still points at a real, non-trashed folder
// before trusting it — the user can delete/trash it in Drive at any time —
// and otherwise finds-or-creates it by name.
async function ensureFolder({ accessToken, cachedFolderId, fetchImpl = global.fetch }) {
  if (cachedFolderId && await verifyFolderExists({ accessToken, folderId: cachedFolderId, fetchImpl })) {
    return cachedFolderId;
  }
  return (await findFolder({ accessToken, fetchImpl })) || createFolder({ accessToken, fetchImpl });
}

async function findFileInFolder({ accessToken, folderId, name, fetchImpl }) {
  const q = `name='${escapeQueryValue(name)}' and '${folderId}' in parents and trashed=false`;
  const data = await driveRequest(`${FILES_ENDPOINT}?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id)`, {
    accessToken, fetchImpl, method: 'GET',
  });
  const match = (data.files || [])[0];
  return match ? match.id : null;
}

function assertUploadSize(name, content) {
  if (Buffer.byteLength(content, 'utf8') > MAX_SIMPLE_UPLOAD_BYTES) {
    throw new Error(`${name} is too large for Baretext's Drive backup (over 5MB)`);
  }
}

async function createFile({ accessToken, folderId, name, content, fetchImpl = global.fetch }) {
  assertUploadSize(name, content);
  const boundary = `baretext-${crypto.randomBytes(8).toString('hex')}`;
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const body = `--${boundary}\r\n`
    + `Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
    + `--${boundary}\r\n`
    + `Content-Type: text/markdown; charset=UTF-8\r\n\r\n${content}\r\n`
    + `--${boundary}--`;
  const data = await driveRequest(`${UPLOAD_ENDPOINT}?uploadType=multipart&fields=id`, {
    accessToken, fetchImpl, method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return data.id;
}

async function updateFile({ accessToken, fileId, name, content, fetchImpl = global.fetch }) {
  assertUploadSize(name, content);
  await driveRequest(`${UPLOAD_ENDPOINT}/${fileId}?uploadType=media`, {
    accessToken, fetchImpl, method: 'PATCH',
    headers: { 'Content-Type': 'text/markdown; charset=UTF-8' },
    body: content,
  });
}

// Finds-or-creates a file by name in the given folder and writes `content`
// to it. `cachedFileId` (from the last sync) is tried first and skips the
// search entirely; if it's stale (the user trashed/deleted that file on
// Drive's side) this falls back to searching by name, then to creating a
// fresh one, rather than failing the whole backup over one stale pointer.
async function upsertFile({ accessToken, folderId, name, content, cachedFileId, fetchImpl = global.fetch }) {
  if (cachedFileId) {
    try {
      await updateFile({ accessToken, fileId: cachedFileId, name, content, fetchImpl });
      return cachedFileId;
    } catch { /* fall through to re-resolve by name */ }
  }
  const foundId = await findFileInFolder({ accessToken, folderId, name, fetchImpl });
  if (foundId) {
    await updateFile({ accessToken, fileId: foundId, name, content, fetchImpl });
    return foundId;
  }
  return createFile({ accessToken, folderId, name, content, fetchImpl });
}

module.exports = { FOLDER_NAME, MAX_SIMPLE_UPLOAD_BYTES, ensureFolder, upsertFile, verifyFolderExists };
