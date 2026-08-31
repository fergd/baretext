import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import auth from '../../src/google-drive-auth.js';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('PKCE challenge is the base64url SHA-256 of the verifier, per RFC 7636', () => {
  const { verifier, challenge } = auth.createPkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  const expected = crypto.createHash('sha256').update(verifier).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(challenge, expected);
});

test('two calls produce different verifiers and states', () => {
  const a = auth.createPkcePair();
  const b = auth.createPkcePair();
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(auth.createState(), auth.createState());
});

test('buildAuthUrl carries the PKCE challenge, drive.file scope, and offline access', () => {
  const url = new URL(auth.buildAuthUrl({
    clientId: 'client-123', redirectUri: 'http://127.0.0.1:9999/callback',
    state: 'state-abc', codeChallenge: 'challenge-xyz',
  }));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), 'client-123');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:9999/callback');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-xyz');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.match(url.searchParams.get('scope'), /drive\.file/);
});

test('the loopback server catches a real redirect and resolves waitForCode()', async () => {
  const server = await auth.startLoopbackServer();
  try {
    assert.match(server.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const waiting = server.waitForCode();
    const response = await fetch(`${server.redirectUri}?code=test-code&state=test-state`);
    assert.equal(response.status, 200);
    const result = await waiting;
    assert.deepEqual(result, { code: 'test-code', state: 'test-state', error: null });
  } finally {
    server.close();
  }
});

test('the loopback server 404s any path other than /callback', async () => {
  const server = await auth.startLoopbackServer();
  try {
    const base = server.redirectUri.replace('/callback', '');
    const response = await fetch(`${base}/other`);
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

test('exchangeCode posts the PKCE verifier and surfaces the returned tokens', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, params: new URLSearchParams(options.body) };
    return jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 });
  };
  const result = await auth.exchangeCode({
    clientId: 'id', clientSecret: 'secret', code: 'auth-code',
    codeVerifier: 'verifier-1', redirectUri: 'http://127.0.0.1:1/callback', fetchImpl,
  });
  assert.equal(request.url, 'https://oauth2.googleapis.com/token');
  assert.equal(request.params.get('code'), 'auth-code');
  assert.equal(request.params.get('code_verifier'), 'verifier-1');
  assert.equal(request.params.get('grant_type'), 'authorization_code');
  assert.equal(result.refresh_token, 'refresh-1');
});

test('refreshAccessToken uses the refresh_token grant', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = new URLSearchParams(options.body);
    return jsonResponse({ access_token: 'access-2', expires_in: 3600 });
  };
  const result = await auth.refreshAccessToken({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh-1', fetchImpl });
  assert.equal(request.get('grant_type'), 'refresh_token');
  assert.equal(request.get('refresh_token'), 'refresh-1');
  assert.equal(result.access_token, 'access-2');
});

test('a token error response surfaces Google\'s error_description', async () => {
  const fetchImpl = async () => jsonResponse({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
  await assert.rejects(
    auth.exchangeCode({ clientId: 'id', clientSecret: 'secret', code: 'x', codeVerifier: 'v', redirectUri: 'http://x', fetchImpl }),
    /expired or revoked/,
  );
});

test('revokeToken never throws, even when the request fails', async () => {
  const fetchImpl = async () => { throw new Error('network down'); };
  await assert.doesNotReject(auth.revokeToken({ token: 'refresh-1', fetchImpl }));
});

test('revokeToken is a no-op with no token', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse({}); };
  await auth.revokeToken({ token: null, fetchImpl });
  assert.equal(called, false);
});

test('fetchAccountEmail returns the email on success and null on any failure', async () => {
  const ok = await auth.fetchAccountEmail({ accessToken: 'tok', fetchImpl: async () => jsonResponse({ email: 'writer@example.com' }) });
  assert.equal(ok, 'writer@example.com');

  const notOk = await auth.fetchAccountEmail({ accessToken: 'tok', fetchImpl: async () => jsonResponse({}, 401) });
  assert.equal(notOk, null);

  const errored = await auth.fetchAccountEmail({ accessToken: 'tok', fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(errored, null);
});
