import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import credentialStoreModule from '../../src/credential-store.js';

test('personal API key is persisted only as safeStorage ciphertext', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-credential-test-'));
  const filePath = path.join(dir, 'openai-key.encrypted');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
  };
  const store = credentialStoreModule.createCredentialStore({ safeStorage, filePath });

  try {
    store.set('sk-personal-secret');
    assert.equal(store.get(), 'sk-personal-secret');
    assert.notEqual(fs.readFileSync(filePath, 'utf8'), 'sk-personal-secret');
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    store.remove();
    assert.equal(store.get(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
