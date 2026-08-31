// Google OAuth 2.0 for installed apps (RFC 8252 loopback flow + PKCE) — no
// dependency on Electron beyond what's passed in. `google-drive.js` owns the
// stateful pieces (which account, which token); everything here is a pure
// request/response function so it can be unit-tested with an injected fetch.

const http = require('http');
const crypto = require('crypto');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
// drive.file: Baretext can only see/touch files and folders it creates
// itself, never the rest of the user's Drive. openid+email are both
// non-sensitive scopes (like drive.file) — combining them doesn't push this
// OAuth client into Google's stricter verification requirements, which
// matters since this is a personal "Testing"-mode client, never published.
const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createPkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function createState() {
  return base64url(crypto.randomBytes(16));
}

function buildAuthUrl({ clientId, redirectUri, state, codeChallenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// Starts a one-shot HTTP server on a random loopback port to catch Google's
// OAuth redirect — the recommended replacement for the deprecated
// out-of-band ("copy this code") flow for installed apps.
function startLoopbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const waiters = [];

    server.on('request', (req, res) => {
      let url;
      try { url = new URL(req.url, 'http://127.0.0.1'); }
      catch { res.writeHead(400); res.end(); return; }
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:-apple-system,sans-serif;padding:40px;color:#333">'
        + 'Baretext is connected. You can close this tab.</body></html>');

      const result = {
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
        error: url.searchParams.get('error'),
      };
      waiters.splice(0).forEach((w) => w.resolve(result));
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        redirectUri: `http://127.0.0.1:${port}/callback`,
        waitForCode(timeoutMs = CALLBACK_TIMEOUT_MS) {
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error('Timed out waiting for Google sign-in')), timeoutMs);
            waiters.push({ resolve: (v) => { clearTimeout(timer); res(v); } });
          });
        },
        close() { server.close(); },
      });
    });
  });
}

async function tokenRequest(params, fetchImpl) {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data && (data.error_description || data.error)) || `Google token request failed (${response.status})`);
  }
  return data;
}

function exchangeCode({ clientId, clientSecret, code, codeVerifier, redirectUri, fetchImpl = global.fetch }) {
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  }, fetchImpl);
}

function refreshAccessToken({ clientId, clientSecret, refreshToken, fetchImpl = global.fetch }) {
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }, fetchImpl);
}

async function revokeToken({ token, fetchImpl = global.fetch }) {
  if (!token) return;
  try {
    await fetchImpl(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch (e) {
    console.error('google-drive-auth: revoke failed:', e.message);
  }
}

async function fetchAccountEmail({ accessToken, fetchImpl = global.fetch }) {
  try {
    const response = await fetchImpl(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    return typeof data.email === 'string' ? data.email : null;
  } catch {
    return null;
  }
}

module.exports = {
  SCOPE,
  createPkcePair,
  createState,
  buildAuthUrl,
  startLoopbackServer,
  exchangeCode,
  refreshAccessToken,
  revokeToken,
  fetchAccountEmail,
};
