// Personal credential storage. Electron safeStorage delegates encryption to
// the operating system (Keychain on macOS); this file only persists the
// resulting opaque ciphertext in Baretext's user-data directory.

const fs = require('fs');

function createCredentialStore({ safeStorage, filePath, fsImpl = fs }) {
  function available() {
    return !!(safeStorage && safeStorage.isEncryptionAvailable());
  }

  function get() {
    if (!available() || !fsImpl.existsSync(filePath)) return null;
    try {
      const encrypted = fsImpl.readFileSync(filePath);
      const value = safeStorage.decryptString(encrypted).trim();
      return value || null;
    } catch (error) {
      console.error('Credential read failed:', error.message);
      return null;
    }
  }

  function set(value) {
    const key = String(value || '').trim();
    if (!key) throw new Error('Enter an API key');
    if (key.length > 512) throw new Error('API key is too long');
    if (!available()) throw new Error('macOS Keychain is unavailable');
    fsImpl.writeFileSync(filePath, safeStorage.encryptString(key), { mode: 0o600 });
  }

  function remove() {
    if (fsImpl.existsSync(filePath)) fsImpl.unlinkSync(filePath);
  }

  return { available, get, set, remove };
}

module.exports = { createCredentialStore };
