import assert from 'node:assert/strict';
import test from 'node:test';
import drive from '../../src/google-drive-api.js';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('verifyFolderExists is true for a live, non-trashed folder and false for trashed/missing/errored ones', async () => {
  const live = await drive.verifyFolderExists({ accessToken: 'tok', folderId: 'f1', fetchImpl: async () => jsonResponse({ id: 'f1', trashed: false }) });
  assert.equal(live, true);

  const trashed = await drive.verifyFolderExists({ accessToken: 'tok', folderId: 'f1', fetchImpl: async () => jsonResponse({ id: 'f1', trashed: true }) });
  assert.equal(trashed, false);

  const missing = await drive.verifyFolderExists({ accessToken: 'tok', folderId: 'f1', fetchImpl: async () => jsonResponse({ error: { message: 'not found' } }, 404) });
  assert.equal(missing, false);
});

test('ensureFolder trusts a cached folder id that is still live', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return jsonResponse({ id: 'folder-1', trashed: false });
  };
  const id = await drive.ensureFolder({ accessToken: 'tok', cachedFolderId: 'folder-1', fetchImpl });
  assert.equal(id, 'folder-1');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/files\/folder-1\?fields=id,trashed/);
});

test('ensureFolder re-resolves by name when the cached id is trashed or gone', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/files/folder-1')) return jsonResponse({ id: 'folder-1', trashed: true });
    if (url.includes('/files?q=')) return jsonResponse({ files: [{ id: 'folder-2' }] });
    throw new Error('unexpected: ' + url);
  };
  const id = await drive.ensureFolder({ accessToken: 'tok', cachedFolderId: 'folder-1', fetchImpl });
  assert.equal(id, 'folder-2');
});

test('ensureFolder creates the "Baretext Backups" folder when none is found', async () => {
  let created;
  const fetchImpl = async (url, options) => {
    if (url.includes('/files?q=')) return jsonResponse({ files: [] });
    if (options.method === 'POST') {
      created = JSON.parse(options.body);
      return jsonResponse({ id: 'new-folder' });
    }
    throw new Error('unexpected: ' + url);
  };
  const id = await drive.ensureFolder({ accessToken: 'tok', cachedFolderId: null, fetchImpl });
  assert.equal(id, 'new-folder');
  assert.equal(created.name, drive.FOLDER_NAME);
  assert.equal(created.mimeType, 'application/vnd.google-apps.folder');
});

test('upsertFile updates in place when a cached file id is still valid', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(`${options.method} ${url}`);
    return jsonResponse({ id: 'file-1' });
  };
  const id = await drive.upsertFile({ accessToken: 'tok', folderId: 'f1', name: 'book.md', content: 'text', cachedFileId: 'file-1', fetchImpl });
  assert.equal(id, 'file-1');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^PATCH .*\/upload\/drive\/v3\/files\/file-1\?uploadType=media/);
});

test('upsertFile falls back to search-then-create when the cached id 404s', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(`${options.method} ${url}`);
    if (url.includes('/upload/drive/v3/files/stale-id')) return jsonResponse({ error: { message: 'File not found' } }, 404);
    if (url.includes('/files?q=')) return jsonResponse({ files: [] });
    if (url.includes('/upload/drive/v3/files?uploadType=multipart')) return jsonResponse({ id: 'fresh-id' });
    throw new Error('unexpected: ' + url);
  };
  const id = await drive.upsertFile({ accessToken: 'tok', folderId: 'f1', name: 'book.md', content: 'text', cachedFileId: 'stale-id', fetchImpl });
  assert.equal(id, 'fresh-id');
  assert.deepEqual(calls.map((c) => c.split(' ')[0]), ['PATCH', 'GET', 'POST']);
});

test('upsertFile with no cached id searches by name before creating', async () => {
  const fetchImpl = async (url, options) => {
    if (url.includes('/files?q=')) return jsonResponse({ files: [{ id: 'existing-id' }] });
    if (options.method === 'PATCH') return jsonResponse({ id: 'existing-id' });
    throw new Error('unexpected create when a match already exists: ' + url);
  };
  const id = await drive.upsertFile({ accessToken: 'tok', folderId: 'f1', name: 'book.md', content: 'text', cachedFileId: null, fetchImpl });
  assert.equal(id, 'existing-id');
});

test('createFile sends the multipart metadata + content parts and rejects over the 5MB simple-upload ceiling', async () => {
  let body;
  const fetchImpl = async (url, options) => {
    body = options.body;
    return jsonResponse({ id: 'new-id' });
  };
  const id = await drive.upsertFile({ accessToken: 'tok', folderId: 'f1', name: 'chapter one.md', content: '# Chapter One', cachedFileId: null,
    fetchImpl: async (url, opts) => (url.includes('/files?q=') ? jsonResponse({ files: [] }) : fetchImpl(url, opts)) });
  assert.equal(id, 'new-id');
  assert.match(body, /"name":"chapter one\.md"/);
  assert.match(body, /# Chapter One/);

  const huge = 'x'.repeat(drive.MAX_SIMPLE_UPLOAD_BYTES + 1);
  await assert.rejects(
    drive.upsertFile({ accessToken: 'tok', folderId: 'f1', name: 'huge.md', content: huge, cachedFileId: null,
      fetchImpl: async (url) => (url.includes('/files?q=') ? jsonResponse({ files: [] }) : jsonResponse({ id: 'x' })) }),
    /over 5MB/,
  );
});

test('a Drive error response surfaces the server-provided message', async () => {
  const fetchImpl = async () => jsonResponse({ error: { message: 'Insufficient permissions' } }, 403);
  await assert.rejects(
    drive.ensureFolder({ accessToken: 'tok', cachedFolderId: null, fetchImpl }),
    /Insufficient permissions/,
  );
});
