const path = require('node:path');

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

function isPathInside(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRelativeDocumentPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('Invalid document link.');
  }

  let decoded;
  try {
    decoded = decodeURIComponent(value.split('#')[0].split('?')[0]);
  } catch {
    throw new Error('The document link contains invalid encoding.');
  }

  if (decoded.includes('\0') || path.isAbsolute(decoded) || /^[a-zA-Z]:[\\/]/.test(decoded)) {
    throw new Error('Absolute document links are not allowed.');
  }

  return decoded.replaceAll('\\', '/');
}

function validateExternalUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) {
    return null;
  }

  try {
    const url = new URL(value);
    if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function assertTrustedSender(event, mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('The application window is unavailable.');
  }

  if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Untrusted IPC sender.');
  }
}

module.exports = {
  assertTrustedSender,
  isPathInside,
  normalizeRelativeDocumentPath,
  validateExternalUrl
};
