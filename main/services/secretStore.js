const fs = require('node:fs');
const path = require('node:path');
const { safeStorage } = require('electron');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  const dirPath = path.dirname(filePath);
  ensureDir(dirPath);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod failures on unsupported filesystems.
  }
}

class SecretStore {
  constructor({ dataRoot }) {
    this.dataRoot = dataRoot;
    this.secretDir = path.join(dataRoot, 'secure');
    this.secretFilePath = path.join(this.secretDir, 'secrets.json');
    this.cache = null;
  }

  initialize() {
    ensureDir(this.secretDir);
    this.cache = readJson(this.secretFilePath, {});
    if (!this.cache || typeof this.cache !== 'object') {
      this.cache = {};
    }
  }

  getStorageInfo() {
    if (safeStorage.isEncryptionAvailable()) {
      return {
        kind: 'electron-safe-storage',
        encrypted: true,
        label: 'Electron Safe Storage',
      };
    }

    return {
      kind: 'plaintext-fallback',
      encrypted: false,
      label: 'Plaintext Fallback',
    };
  }

  get(secretId) {
    if (!secretId || !this.cache || typeof this.cache !== 'object') return '';
    const entry = this.cache[secretId];
    if (!entry || typeof entry !== 'object') return '';

    if (entry.kind === 'electron-safe-storage' && typeof entry.value === 'string') {
      try {
        return safeStorage.decryptString(Buffer.from(entry.value, 'base64'));
      } catch {
        return '';
      }
    }

    if (typeof entry.value === 'string') {
      return entry.value;
    }

    return '';
  }

  has(secretId) {
    return Boolean(this.get(secretId));
  }

  set(secretId, secretValue) {
    if (!secretId) {
      throw new Error('secretId is required.');
    }
    if (typeof secretValue !== 'string' || !secretValue.trim()) {
      throw new Error('secretValue is required.');
    }
    if (!this.cache || typeof this.cache !== 'object') {
      this.initialize();
    }

    const trimmed = secretValue.trim();
    const storageInfo = this.getStorageInfo();
    this.cache[secretId] = storageInfo.encrypted
      ? {
          kind: storageInfo.kind,
          value: safeStorage.encryptString(trimmed).toString('base64'),
          updatedAt: Date.now(),
        }
      : {
          kind: storageInfo.kind,
          value: trimmed,
          updatedAt: Date.now(),
        };

    writeJson(this.secretFilePath, this.cache);
  }

  delete(secretId) {
    if (!secretId || !this.cache || typeof this.cache !== 'object' || !this.cache[secretId]) return;
    delete this.cache[secretId];
    writeJson(this.secretFilePath, this.cache);
  }
}

module.exports = {
  SecretStore,
};
