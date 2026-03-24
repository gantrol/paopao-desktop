const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createAssetUrl(assetId) {
  return `paopao-asset://asset/${assetId}`;
}

function parseAssetUrl(url) {
  if (typeof url !== 'string') return null;
  const normalized = url.trim();
  if (!normalized.startsWith('paopao-asset://')) return null;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'paopao-asset:') return null;

    const host = parsed.hostname.trim();
    const pathname = parsed.pathname.replace(/^\/+|\/+$/g, '').trim();

    if (host && host !== 'asset' && !pathname) {
      return host;
    }

    if (host && host !== 'asset' && pathname === host) {
      return host;
    }

    if (host === 'asset' && pathname) {
      return pathname.split('/')[0] || null;
    }

    if (!host && pathname) {
      return pathname.split('/')[0] || null;
    }
  } catch {
    const fallback = normalized.slice('paopao-asset://'.length).replace(/^asset\/?/, '').replace(/^\/+|\/+$/g, '').trim();
    return fallback || null;
  }

  return null;
}

function guessMimeFromName(fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.pdf': 'application/pdf',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.json': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}

function normalizeExtension(fileName, mimeType) {
  const current = path.extname(fileName || '').toLowerCase();
  if (current) return current;

  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/ogg': '.ogg',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'application/json': '.json',
  };
  return map[mimeType] || '';
}

function inferAssetKind(mimeType, fileName) {
  const effectiveMime = mimeType || guessMimeFromName(fileName);
  if (effectiveMime.startsWith('image/')) return 'image';
  if (effectiveMime.startsWith('video/')) return 'video';
  if (effectiveMime.startsWith('audio/')) return 'audio';
  return 'file';
}

class BlobStore {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.blobRoot = path.join(dataRoot, 'blobs', 'sha256');
    ensureDir(this.blobRoot);
  }

  importBuffer({ buffer, originalName, mimeType }) {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const effectiveMime = mimeType || guessMimeFromName(originalName);
    const extension = normalizeExtension(originalName, effectiveMime);
    const directory = path.join(this.blobRoot, sha256.slice(0, 2));
    const fileName = `${sha256}${extension}`;
    const absolutePath = path.join(directory, fileName);
    const relativePath = path.relative(this.dataRoot, absolutePath);

    ensureDir(directory);
    if (!fs.existsSync(absolutePath)) {
      fs.writeFileSync(absolutePath, bytes);
    }

    return {
      kind: inferAssetKind(effectiveMime, originalName),
      mimeType: effectiveMime,
      extension: extension || undefined,
      originalName,
      sha256,
      sizeBytes: bytes.byteLength,
      relativePath,
    };
  }

  importFile(filePath, options = {}) {
    const buffer = fs.readFileSync(filePath);
    return this.importBuffer({
      buffer,
      originalName: options.originalName || path.basename(filePath),
      mimeType: options.mimeType || guessMimeFromName(filePath),
    });
  }

  resolveAbsolutePath(relativePath) {
    return path.join(this.dataRoot, relativePath);
  }
}

module.exports = {
  BlobStore,
  createAssetUrl,
  parseAssetUrl,
  guessMimeFromName,
  inferAssetKind,
};
