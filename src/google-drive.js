// Google Drive backup service — owns OAuth credentials and sync state,
// orchestrating src/google-drive-auth.js (OAuth) and src/google-drive-api.js
// (Drive REST) into task-shaped methods. Mirrors src/ai.js's split from its
// provider adapter: this file is stateful and Electron-facing (credentials,
// disk-backed cache), the two modules it calls are pure and fetch-injectable.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createCredentialStore } = require('./credential-store');
const auth = require('./google-drive-auth');
const drive = require('./google-drive-api');

const MANUSCRIPT_EXTENSIONS = new Set(['.md', '.txt']);
// Refresh the access token slightly before Google's own expiry so a backup
// in progress never straddles the exact moment it goes stale.
const ACCESS_TOKEN_SAFETY_MARGIN_MS = 60 * 1000;

let credentialStore = null;
let syncFilePath = null;
let openExternal = null;
let sync = { folderId: null, files: {}, destinationFolder: null };
let accessToken = null;
let accessTokenExpiresAt = 0;
let lastBackupAt = null;
let lastError = null;
const RECONNECT_MESSAGE = 'Google Drive authorization expired or was revoked. Reconnect to resume backups.';

function loadCredentials() {
  if (!credentialStore) return {};
  try {
    const raw = credentialStore.get();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCredentials(patch) {
  const next = { ...loadCredentials(), ...patch };
  credentialStore.set(JSON.stringify(next));
  return next;
}

function loadSyncState() {
  if (!syncFilePath) return { folderId: null, files: {}, destinationFolder: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(syncFilePath, 'utf8'));
    return {
      folderId: parsed.folderId || null,
      files: parsed.files || {},
      destinationFolder: parsed.destinationFolder || null,
    };
  } catch {
    return { folderId: null, files: {}, destinationFolder: null };
  }
}

function saveSyncState() {
  if (!syncFilePath) return;
  try { fs.writeFileSync(syncFilePath, JSON.stringify(sync), 'utf8'); }
  catch (e) { console.error('google-drive: sync-state save failed:', e.message); }
}

// credentialFilePath/syncFilePath: separate encrypted-credential and plain
// sync-state files in userData, same split as ai.js's own openai-key /
// ai-cache.json pair. `shell` is Electron's shell module (or a fake with an
// `openExternal` for tests).
function init({ credentialFilePath, syncFilePath: syncPath, safeStorage, shell }) {
  credentialStore = createCredentialStore({ safeStorage, filePath: credentialFilePath });
  syncFilePath = syncPath;
  openExternal = shell ? shell.openExternal.bind(shell) : null;
  sync = loadSyncState();
  accessToken = null;
  accessTokenExpiresAt = 0;
  lastBackupAt = null;
  lastError = null;
}

function configure({ clientId, clientSecret }) {
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!id || !secret) throw new Error('Enter both a Client ID and Client Secret');
  saveCredentials({ clientId: id, clientSecret: secret });
}

// Kept separate from configure() above — saved independently so a later
// "just add the picker key" visit to Backup Settings doesn't require
// re-pasting the OAuth Client ID/Secret, which are never re-shown once saved.
function configurePicker({ apiKey }) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Enter a Picker API key');
  saveCredentials({ pickerApiKey: key });
}

function status() {
  const creds = loadCredentials();
  return {
    hasClientCredentials: !!(creds.clientId && creds.clientSecret),
    hasPickerApiKey: !!creds.pickerApiKey,
    connected: !!creds.refreshToken && !creds.needsReconnect,
    needsReconnect: !!creds.needsReconnect,
    accountEmail: creds.accountEmail || null,
    destinationFolder: sync.destinationFolder,
    lastBackupAt,
    lastError: creds.needsReconnect ? RECONNECT_MESSAGE : lastError,
  };
}

async function ensureAccessToken() {
  const creds = loadCredentials();
  if (!creds.clientId || !creds.clientSecret) throw new Error('Enter a Google Client ID and Secret first');
  if (!creds.refreshToken) throw new Error('Connect Google Drive first');
  if (creds.needsReconnect) throw new Error(RECONNECT_MESSAGE);
  if (accessToken && Date.now() < accessTokenExpiresAt - ACCESS_TOKEN_SAFETY_MARGIN_MS) return accessToken;

  let result;
  try { result = await auth.refreshAccessToken({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: creds.refreshToken,
  }); } catch (error) {
    if (error.code === 'invalid_grant') {
      saveCredentials({ needsReconnect: true });
      accessToken = null;
      accessTokenExpiresAt = 0;
      throw new Error(RECONNECT_MESSAGE);
    }
    throw error;
  }
  accessToken = result.access_token;
  accessTokenExpiresAt = Date.now() + (Number(result.expires_in) || 3600) * 1000;
  return accessToken;
}

// Main-process-only — deliberately not exposed through the general
// backupStatus() bridge to the renderer. Used to hand the dedicated Picker
// BrowserWindow (src/main.js) a live access token + the Picker API key.
async function getPickerCredentials() {
  const creds = loadCredentials();
  if (!creds.pickerApiKey) throw new Error('Enter a Picker API key first');
  const token = await ensureAccessToken();
  return { accessToken: token, apiKey: creds.pickerApiKey };
}

// Runs the full loopback OAuth flow: opens the system browser to Google's
// consent screen, waits for the redirect, exchanges the code for tokens,
// and stores the refresh token + account email. Rejects (never silently
// no-ops) so the settings panel can show exactly why a connect attempt failed.
async function connect() {
  const creds = loadCredentials();
  if (!creds.clientId || !creds.clientSecret) throw new Error('Enter a Google Client ID and Secret first');
  if (!openExternal) throw new Error('This runtime cannot open a browser to sign in');

  const server = await auth.startLoopbackServer();
  try {
    const { verifier, challenge } = auth.createPkcePair();
    const state = auth.createState();
    const url = auth.buildAuthUrl({ clientId: creds.clientId, redirectUri: server.redirectUri, state, codeChallenge: challenge });

    // The waiter must be registered before the browser opens — the redirect
    // can come back before openExternal()'s own promise resolves, and a
    // request with no waiter listening is silently dropped (see
    // startLoopbackServer), which would hang this forever.
    const waitingForCode = server.waitForCode();
    await openExternal(url);
    const result = await waitingForCode;
    if (result.error) throw new Error(`Google sign-in was cancelled (${result.error})`);
    if (!result.code || result.state !== state) throw new Error('Google sign-in response did not match this request');

    const tokens = await auth.exchangeCode({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      code: result.code,
      codeVerifier: verifier,
      redirectUri: server.redirectUri,
    });
    if (!tokens.refresh_token) {
      throw new Error("Google didn't return a refresh token — remove Baretext's access at myaccount.google.com/permissions and try connecting again");
    }

    accessToken = tokens.access_token;
    accessTokenExpiresAt = Date.now() + (Number(tokens.expires_in) || 3600) * 1000;
    const email = await auth.fetchAccountEmail({ accessToken });
    saveCredentials({ refreshToken: tokens.refresh_token, accountEmail: email, needsReconnect: false });
    lastError = null;
    return { email };
  } finally {
    server.close();
  }
}

// Revokes and clears the refresh token/email, but keeps the client id/secret
// so reconnecting doesn't require pasting them back in.
async function disconnect() {
  const creds = loadCredentials();
  if (creds.refreshToken) await auth.revokeToken({ token: creds.refreshToken });
  saveCredentials({ refreshToken: null, accountEmail: null, needsReconnect: false });
  accessToken = null;
  accessTokenExpiresAt = 0;
  lastBackupAt = null;
  lastError = null;
}

// Set after the user picks a folder via the Picker widget (src/main.js).
// Distinct from the auto-managed sync.folderId: a picked folder must never
// silently fall back to auto-creating "Baretext Backups" if it goes away —
// see backupDirectory() below.
//
// Both setters clear sync.files: it's a per-filename cache of driveFileId
// (Drive-side file id) keyed only by manuscript filename, with no notion of
// which folder it lives in. upsertFile() treats a cached id that still
// exists as valid and PATCHes it in place regardless of its parent — so
// switching destination folders without clearing this cache would silently
// keep overwriting files in the OLD folder instead of populating the new one.
function setDestinationFolder({ id, name }) {
  sync.destinationFolder = { id: String(id), name: String(name || id) };
  sync.files = {};
  saveSyncState();
}

function clearDestinationFolder() {
  sync.destinationFolder = null;
  sync.files = {};
  saveSyncState();
}

function manuscriptFileNames(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => entry.isFile() && MANUSCRIPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name);
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Resolves the Drive folder to back up into. A user-picked destination
// (via the Picker widget) is trusted as-is if it still exists, and NEVER
// silently replaced with the auto-managed "Baretext Backups" folder if it
// doesn't — that would move the user's backups without them noticing.
// With no picked destination, behavior is unchanged: find-or-create
// "Baretext Backups", same as before this existed.
async function resolveDestinationFolderId(token) {
  if (sync.destinationFolder) {
    const stillThere = await drive.verifyFolderExists({ accessToken: token, folderId: sync.destinationFolder.id });
    if (!stillThere) {
      throw new Error(`Your chosen backup folder "${sync.destinationFolder.name}" is no longer available in Drive — pick a new one in Backup Settings`);
    }
    return sync.destinationFolder.id;
  }
  return drive.ensureFolder({ accessToken: token, cachedFolderId: sync.folderId });
}

// Syncs every manuscript in `dir` to the resolved Drive folder (see
// resolveDestinationFolderId above). Content-hashed against the last sync
// so an unchanged file is never re-uploaded just because the app restarted
// or another file in the directory changed. Best-effort: never throws,
// always resolves with {ok:true} or {ok:false, error}, and records the
// error for status().
async function backupDirectory(dir) {
  const creds = loadCredentials();
  if (!creds.refreshToken) return { ok: false, skipped: true };
  if (creds.needsReconnect) return { ok: false, skipped: true, error: RECONNECT_MESSAGE };

  try {
    const token = await ensureAccessToken();
    const folderId = await resolveDestinationFolderId(token);
    if (!sync.destinationFolder) sync.folderId = folderId;

    for (const name of manuscriptFileNames(dir)) {
      let content;
      try { content = fs.readFileSync(path.join(dir, name), 'utf8'); }
      catch { continue; }

      const hash = hashContent(content);
      const known = sync.files[name];
      if (known && known.hash === hash) continue;

      const fileId = await drive.upsertFile({
        accessToken: token,
        folderId,
        name,
        content,
        cachedFileId: known && known.driveFileId,
      });
      sync.files[name] = { driveFileId: fileId, hash, syncedAt: new Date().toISOString() };
    }

    saveSyncState();
    lastBackupAt = new Date().toISOString();
    lastError = null;
    return { ok: true };
  } catch (e) {
    lastError = e.message;
    console.error('google-drive: backup failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  init, configure, configurePicker, status, connect, disconnect, backupDirectory,
  getPickerCredentials, setDestinationFolder, clearDestinationFolder,
};
