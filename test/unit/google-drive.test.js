// google-drive.js is the stateful orchestration layer — real credentialStore
// (fake safeStorage, same style as credential-store.test.js) and a real temp
// dir for both the encrypted credential file and the sync-state JSON, with
// only the actual network boundary (global.fetch) faked, same style as
// ai.test.js. The fake below plays both Google's OAuth endpoints and just
// enough of the Drive REST surface to exercise google-drive.js's own logic
// (hashing, skip-unchanged, sync-state persistence) — google-drive-api.test.js
// already covers the Drive REST branching in isolation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import googleDrive from '../../src/google-drive.js';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
};

// Plays Google's OAuth token/userinfo endpoints and a minimal in-memory
// Drive: folders keyed by id (with a trashed flag), and files keyed by id.
// Real fetch is used to reach the loopback server (127.0.0.1) so the OAuth
// round trip is genuine end to end; everything hitting a googleapis.com
// host is faked here. seedFolder()/trashFolder() let a test simulate a
// folder that already exists in the user's Drive (as if picked via the
// Picker widget) independent of the auto-create-"Baretext Backups" path.
function createFakeGoogle() {
  const realFetch = global.fetch;
  const folders = new Map(); // id -> { trashed }
  const files = new Map(); // id -> { name, content }
  let nextId = 1;
  const calls = [];

  function seedFolder(id) { folders.set(id, { trashed: false }); }
  function trashFolder(id) { if (folders.has(id)) folders.get(id).trashed = true; }
  function deleteFolder(id) { folders.delete(id); }

  async function fetchImpl(url, options = {}) {
    if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, options);
    const u = new URL(url);
    const method = options.method || 'GET';
    // The list/search endpoint (GET /drive/v3/files) is used for both
    // "does the Baretext Backups folder already exist" and "does this
    // filename already exist in the target folder" — tests that care about
    // which one happened need the query distinguished in the log, not just
    // the shared pathname.
    const isFolderSearch = u.pathname === '/drive/v3/files' && method === 'GET' && (u.searchParams.get('q') || '').includes('mimeType=');
    calls.push(isFolderSearch ? `${method} ${u.pathname} (folder search)` : `${method} ${u.pathname}`);

    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') {
      return jsonResponse({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 });
    }
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/revoke') {
      return jsonResponse({});
    }
    if (u.hostname === 'www.googleapis.com' && u.pathname === '/oauth2/v3/userinfo') {
      return jsonResponse({ email: 'writer@example.com' });
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') || '';
      if (q.includes('mimeType=')) {
        const live = [...folders.entries()].find(([, f]) => !f.trashed);
        return jsonResponse({ files: live ? [{ id: live[0] }] : [] });
      }
      const name = /name='([^']*)'/.exec(q)[1];
      const hit = [...files.entries()].find(([, f]) => f.name === name);
      return jsonResponse({ files: hit ? [{ id: hit[0] }] : [] });
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const id = `folder-${nextId++}`;
      folders.set(id, { trashed: false });
      return jsonResponse({ id });
    }
    const folderGetMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (folderGetMatch && method === 'GET' && u.searchParams.get('fields') === 'id,trashed') {
      const folder = folders.get(folderGetMatch[1]);
      if (!folder) return jsonResponse({ error: { message: 'File not found' } }, 404);
      return jsonResponse({ id: folderGetMatch[1], trashed: folder.trashed });
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const id = `file-${nextId++}`;
      const name = /"name":"([^"]*)"/.exec(options.body)[1];
      files.set(id, { name });
      return jsonResponse({ id });
    }
    const updateMatch = /^\/upload\/drive\/v3\/files\/(.+)$/.exec(u.pathname);
    if (updateMatch && method === 'PATCH') {
      if (!files.has(updateMatch[1])) return jsonResponse({ error: { message: 'not found' } }, 404);
      return jsonResponse({ id: updateMatch[1] });
    }
    throw new Error(`fake google: unhandled ${method} ${u.pathname}`);
  }

  async function fakeOpenExternal(url) {
    const u = new URL(url);
    const redirectUri = u.searchParams.get('redirect_uri');
    const state = u.searchParams.get('state');
    await realFetch(`${redirectUri}?code=fake-auth-code&state=${state}`);
  }

  return {
    fetchImpl, fakeOpenExternal, calls, seedFolder, trashFolder, deleteFolder,
    restore: () => { global.fetch = realFetch; },
  };
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-google-drive-test-'));
  const credentialFilePath = path.join(dir, 'google-drive.encrypted');
  const syncFilePath = path.join(dir, 'google-drive-sync.json');
  return { dir, credentialFilePath, syncFilePath };
}

test('status() before any client credentials are saved', () => {
  const { dir, credentialFilePath, syncFilePath } = setup();
  try {
    googleDrive.init({ credentialFilePath, syncFilePath, safeStorage: fakeSafeStorage, shell: { openExternal: async () => {} } });
    assert.deepEqual(googleDrive.status(), {
      hasClientCredentials: false, hasPickerApiKey: false, connected: false, needsReconnect: false, accountEmail: null,
      hasBuiltInCredentials: false, hasBuiltInPickerApiKey: false,
      destinationFolder: null, lastBackupAt: null, lastError: null,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('configure() requires both a client id and secret', () => {
  const { dir, credentialFilePath, syncFilePath } = setup();
  try {
    googleDrive.init({ credentialFilePath, syncFilePath, safeStorage: fakeSafeStorage, shell: { openExternal: async () => {} } });
    assert.throws(() => googleDrive.configure({ clientId: '', clientSecret: 'x' }), /Client ID and Client Secret/);
    googleDrive.configure({ clientId: 'client-1', clientSecret: 'secret-1' });
    assert.equal(googleDrive.status().hasClientCredentials, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('configurePicker() requires a non-blank key and is independent of the OAuth client fields', () => {
  const { dir, credentialFilePath, syncFilePath } = setup();
  try {
    googleDrive.init({ credentialFilePath, syncFilePath, safeStorage: fakeSafeStorage, shell: { openExternal: async () => {} } });
    assert.throws(() => googleDrive.configurePicker({ apiKey: '  ' }), /Picker API key/);
    googleDrive.configurePicker({ apiKey: 'picker-key-1' });
    const status = googleDrive.status();
    assert.equal(status.hasPickerApiKey, true);
    assert.equal(status.hasClientCredentials, false, 'saving the picker key must not require or imply OAuth client credentials');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setDestinationFolder()/clearDestinationFolder() persist across a re-init and clear the per-file id cache', async () => {
  const { dir, credentialFilePath, syncFilePath } = setup();
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-google-drive-savedir-'));
  const google = createFakeGoogle();
  global.fetch = google.fetchImpl;
  try {
    googleDrive.init({ credentialFilePath, syncFilePath, safeStorage: fakeSafeStorage, shell: { openExternal: google.fakeOpenExternal } });
    googleDrive.configure({ clientId: 'client-1', clientSecret: 'secret-1' });
    await googleDrive.connect();

    fs.writeFileSync(path.join(saveDir, 'book.md'), 'draft one');
    google.seedFolder('picked-folder');
    await googleDrive.backupDirectory(saveDir); // populates sync.files against the auto-created folder

    googleDrive.setDestinationFolder({ id: 'picked-folder', name: 'My Novel' });
    assert.deepEqual(googleDrive.status().destinationFolder, { id: 'picked-folder', name: 'My Novel' });

    // Re-init from disk (simulates an app relaunch) to prove persistence,
    // and that the old auto-folder's file-id cache did not survive the switch.
    googleDrive.init({ credentialFilePath, syncFilePath, safeStorage: fakeSafeStorage, shell: { openExternal: google.fakeOpenExternal } });
    assert.deepEqual(googleDrive.status().destinationFolder, { id: 'picked-folder', name: 'My Novel' });

    const before = google.calls.length;
    await googleDrive.backupDirectory(saveDir);
    const afterCalls = google.calls.slice(before);
    // Uploading book.md again must be a fresh create/update in the picked
    // folder, not skipped as "unchanged" against the old folder's cache.
    assert.ok(afterCalls.some((c) => c.startsWith('POST /upload') || c.startsWith('PATCH /upload')));

    googleDrive.clearDestinationFolder();
    assert.equal(googleDrive.status().destinationFolder, null);
  } finally {
    google.restore();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(saveDir, { recursive: true, force: true });
  }
});

test('backupDirectory() uses a picked destination folder directly, without touching the auto-managed folder', async () => {
  const { dir, credentialFilePath, syncFilePath } = setup();
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-google-drive-savedir-'));
  const google = createFakeGoogle();
  global.fetch = google.fetchImpl;
  try {
    googleDrive.init({ credentialFilePath, syncFilePath, safeStorage: fakeSafeStorage, shell: { openExternal: google.fakeOpenExternal } });
    googleDrive.configure({ clientId: 'client-1', clientSecret: 'secret-1' });
    await googleDrive.connect();
    google.seedFolder('picked-folder');
    googleDrive.setDestinationFolder({ id: 'picked-folder', name: 'My Novel' });

    fs.writeFileSync(path.join(saveDir, 'book.md'), 'draft one');
    const result = await googleDrive.backupDirectory(saveDir);

    assert.equal(result.ok, true);
    // No "search/create a folder named Baretext Backups" call at all — a
    // plain file-name search against the picked folder is fine and expected.
    assert.ok(!google.calls.includes('GET /drive/v3/files (folder search)'));
    assert.ok(!google.calls.includes('POST /drive/v3/files'));
    assert.ok(google.calls.includes('GET /drive/v3/files/picked-folder'));
  } finally {
    google.restore();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(saveDir, { recursive: true, force: true });
  }
});

test('backupDirectory() fails clearly (never silently falls back to the auto folder) when the picked folder is gone', async () => {
  const { dir, credentialFilePath, syncFilePath } = setup();
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-google-drive-savedir-'));
  const google = createFakeGoogle();
  global.fetch = google.fetchImpl;
  try {
    googleDrive.init({ credentialFilePath, syncFilePath, safeStorage: fakeSafeStorage, shell: { openExternal: google.fakeOpenExternal } });
    googleDrive.configure({ clientId: 'client-1', clientSecret: 'secret-1' });
    await googleDrive.connect();
    google.seedFolder('picked-folder');
    googleDrive.setDestinationFolder({ id: 'picked-folder', name: 'My Novel' });
    google.deleteFolder('picked-folder');

    fs.writeFileSync(path.join(saveDir, 'book.md'), 'draft one');
    const before = google.calls.length;
    const result = await googleDrive.backupDirectory(saveDir);

    assert.equal(result.ok, false);
    assert.match(result.error, /My Novel.*no longer available/);
    assert.match(googleDrive.status().lastError, /no longer available/);
    // Must not have quietly gone on to search/create "Baretext Backups"
    // instead — no folder-list search, no folder creation, and no file
    // upload of any kind.
    const afterCalls = google.calls.slice(before);
    assert.ok(!afterCalls.some((c) => c === 'GET /drive/v3/files' || c === 'POST /drive/v3/files' || c.includes('/upload/')));
  } finally {
    google.restore();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(saveDir, { recursive: true, force: true });
  }
});

test('connect() completes a real loopback OAuth round trip and persists only ciphertext', async () => {
  const { dir, credentialFilePath, syncFilePath } = setup();
  const google = createFakeGoogle();
  global.fetch = google.fetchImpl;
  try {
    googleDrive.init({ credentialFilePath, syncFilePath, safeStorage: fakeSafeStorage, shell: { openExternal: google.fakeOpenExternal } });
    googleDrive.configure({ clientId: 'client-1', clientSecret: 'secret-1' });

    const result = await googleDrive.connect();
    assert.equal(result.email, 'writer@example.com');

    const status = googleDrive.status();
    assert.equal(status.connected, true);
    assert.equal(status.accountEmail, 'writer@example.com');

    // The exact ciphertext guarantee is credential-store.test.js's job (real
    // safeStorage produces opaque bytes); what this proves is that
    // google-drive.js actually routes the refresh token through
    // createCredentialStore rather than writing its own file directly.
    const onDisk = fs.readFileSync(credentialFilePath, 'utf8');
    assert.match(onDisk, /^encrypted:/);
  } finally {
    google.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('disconnect() revokes and clears the token but keeps the client credentials', async () => {
  const { dir, credentialFilePath, syncFilePath } = setup();
  const google = createFakeGoogle();
  global.fetch = google.fetchImpl;
  try {
    googleDrive.init({ credentialFilePath, syncFilePath, safeStorage: fakeSafeStorage, shell: { openExternal: google.fakeOpenExternal } });
    googleDrive.configure({ clientId: 'client-1', clientSecret: 'secret-1' });
    await googleDrive.connect();

    await googleDrive.disconnect();
    const status = googleDrive.status();
    assert.equal(status.connected, false);
    assert.equal(status.accountEmail, null);
    assert.equal(status.hasClientCredentials, true);
    assert.equal(google.calls.includes('POST /revoke'), true);
  } finally {
    google.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backupDirectory() uploads every manuscript once, then skips unchanged files on the next sync', async () => {
  const { dir, credentialFilePath, syncFilePath } = setup();
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-google-drive-savedir-'));
  const google = createFakeGoogle();
  global.fetch = google.fetchImpl;
  try {
    googleDrive.init({ credentialFilePath, syncFilePath, safeStorage: fakeSafeStorage, shell: { openExternal: google.fakeOpenExternal } });
    googleDrive.configure({ clientId: 'client-1', clientSecret: 'secret-1' });
    await googleDrive.connect();

    fs.writeFileSync(path.join(saveDir, 'book-one.md'), '# Book One\n\nIt began.');
    fs.writeFileSync(path.join(saveDir, 'book-two.md'), '# Book Two\n\nA different start.');
    fs.writeFileSync(path.join(saveDir, 'notes.rtf'), 'not a manuscript'); // wrong extension, ignored

    const first = await googleDrive.backupDirectory(saveDir);
    assert.equal(first.ok, true);
    assert.equal(googleDrive.status().lastBackupAt !== null, true);

    const persisted = JSON.parse(fs.readFileSync(syncFilePath, 'utf8'));
    assert.equal(Object.keys(persisted.files).length, 2);
    assert.ok(persisted.files['book-one.md'].driveFileId);
    assert.ok(persisted.files['book-one.md'].hash);

    const callsAfterFirst = google.calls.length;

    // Only change one of the two files before the second sync.
    fs.writeFileSync(path.join(saveDir, 'book-two.md'), '# Book Two\n\nA revised start.');
    const second = await googleDrive.backupDirectory(saveDir);
    assert.equal(second.ok, true);

    const newCalls = google.calls.slice(callsAfterFirst);
    // Expect exactly: one folder-liveness check, one PATCH for the changed
    // file — nothing at all for the unchanged file (skipped by hash before
    // any network call), and no new OAuth token fetch (still cached).
    assert.equal(newCalls.filter((c) => c.startsWith('PATCH')).length, 1);
    assert.equal(newCalls.filter((c) => c.includes('book-one')).length, 0);
    assert.equal(google.calls.filter((c) => c.includes('/token')).length, 1, 'the access token should be reused, not re-fetched');
  } finally {
    google.restore();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(saveDir, { recursive: true, force: true });
  }
});

test('backupDirectory() is a harmless no-op before Drive is connected', async () => {
  const { dir, credentialFilePath, syncFilePath } = setup();
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-google-drive-savedir-'));
  try {
    googleDrive.init({ credentialFilePath, syncFilePath, safeStorage: fakeSafeStorage, shell: { openExternal: async () => {} } });
    const result = await googleDrive.backupDirectory(saveDir);
    assert.deepEqual(result, { ok: false, skipped: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(saveDir, { recursive: true, force: true });
  }
});

test('revoked authorization persists a reconnect state and recovers without reentering credentials', async () => {
  const { dir, credentialFilePath, syncFilePath } = setup();
  const google = createFakeGoogle();
  global.fetch = google.fetchImpl;
  try {
    const options = {credentialFilePath,syncFilePath,safeStorage:fakeSafeStorage,shell:{openExternal:google.fakeOpenExternal}};
    googleDrive.init(options);
    googleDrive.configure({clientId:'client-1',clientSecret:'secret-1'});
    await googleDrive.connect();
    googleDrive.setDestinationFolder({id:'chosen',name:'My backups'});
    googleDrive.init(options); // expire the in-memory access token
    const normalFetch = global.fetch;
    global.fetch = async () => jsonResponse({error:'invalid_grant',error_description:'Token has been expired or revoked.'},400);
    const result = await googleDrive.backupDirectory(dir);
    assert.equal(result.ok,false);
    assert.match(result.error,/Reconnect/);
    assert.equal(googleDrive.status().connected,false);
    assert.equal(googleDrive.status().needsReconnect,true);
    googleDrive.init(options);
    assert.equal(googleDrive.status().needsReconnect,true);
    assert.equal(googleDrive.status().hasClientCredentials,true);
    assert.equal(googleDrive.status().destinationFolder.id,'chosen');
    global.fetch = async () => { throw new Error('must not retry a rejected token'); };
    assert.equal((await googleDrive.backupDirectory(dir)).skipped,true);
    global.fetch = normalFetch;
    await googleDrive.connect();
    assert.equal(googleDrive.status().connected,true);
    assert.equal(googleDrive.status().needsReconnect,false);
    assert.equal(googleDrive.status().lastError,null);
  } finally { google.restore(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('a transient token-service failure does not require reconnecting', async () => {
  const { dir, credentialFilePath, syncFilePath } = setup();
  const google = createFakeGoogle();
  global.fetch = google.fetchImpl;
  try {
    const options={credentialFilePath,syncFilePath,safeStorage:fakeSafeStorage,shell:{openExternal:google.fakeOpenExternal}};
    googleDrive.init(options);
    googleDrive.configure({clientId:'client-1',clientSecret:'secret-1'});
    await googleDrive.connect();
    googleDrive.init(options);
    global.fetch=async()=>jsonResponse({error:'temporarily_unavailable'},503);
    assert.equal((await googleDrive.backupDirectory(dir)).ok,false);
    assert.equal(googleDrive.status().connected,true);
    assert.equal(googleDrive.status().needsReconnect,false);
  } finally { google.restore(); fs.rmSync(dir,{recursive:true,force:true}); }
});
