const fs = require('node:fs');
const path = require('node:path');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_MS = 7 * DAY_MS;
const MAX_RECENT_DOCUMENTS = 12;

function normalizePage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

class HistoryStore {
  constructor(userDataPath, { retentionMs = DEFAULT_RETENTION_MS, now = () => Date.now() } = {}) {
    this.filePath = path.join(userDataPath, 'reading-history.json');
    this.retentionMs = retentionMs;
    this.now = now;
    this.entries = [];
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Unable to read temporary document history:', error.message);
      this.entries = [];
    }
    this.pruneSync();
  }

  pruneSync() {
    const cutoff = this.now() - this.retentionMs;
    const before = this.entries.length;
    this.entries = this.entries
      .filter((entry) => (
        typeof entry?.path === 'string'
        && typeof entry?.name === 'string'
        && typeof entry?.type === 'string'
        && Number.isFinite(entry?.lastOpenedAt)
        && entry.lastOpenedAt >= cutoff
      ))
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, MAX_RECENT_DOCUMENTS);
    if (this.entries.length !== before) this.saveSync();
  }

  saveSync() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify({ version: 1, entries: this.entries }, null, 2), 'utf8');
      fs.rmSync(this.filePath, { force: true });
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      console.warn('Unable to save temporary document history:', error.message);
    }
  }

  touch({ filePath, name, type, lastPage }) {
    const canonical = path.resolve(filePath);
    const existing = this.entries.find((entry) => path.resolve(entry.path) === canonical);
    const next = {
      path: canonical,
      name,
      type,
      lastOpenedAt: this.now()
    };
    if (type === 'pdf') next.lastPage = normalizePage(lastPage ?? existing?.lastPage);

    this.entries = [next, ...this.entries.filter((entry) => path.resolve(entry.path) !== canonical)]
      .slice(0, MAX_RECENT_DOCUMENTS);
    this.pruneSync();
    this.saveSync();
    return structuredClone(next);
  }

  updatePdfPage(filePath, page) {
    const canonical = path.resolve(filePath);
    const entry = this.entries.find((item) => path.resolve(item.path) === canonical && item.type === 'pdf');
    if (!entry) return;
    entry.lastPage = normalizePage(page);
    entry.lastOpenedAt = this.now();
    this.entries.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    this.pruneSync();
    this.saveSync();
  }

  getPdfPage(filePath) {
    this.pruneSync();
    const canonical = path.resolve(filePath);
    const entry = this.entries.find((item) => path.resolve(item.path) === canonical && item.type === 'pdf');
    return entry ? normalizePage(entry.lastPage) : 1;
  }

  async list() {
    this.pruneSync();
    const existing = [];
    for (const entry of this.entries) {
      try {
        const stats = await fs.promises.stat(entry.path);
        if (stats.isFile()) existing.push(entry);
      } catch {
        // Missing and moved files disappear silently from temporary history.
      }
    }

    if (existing.length !== this.entries.length) {
      this.entries = existing;
      this.saveSync();
    }

    return structuredClone(existing.slice(0, 8));
  }
}

module.exports = {
  DAY_MS,
  DEFAULT_RETENTION_MS,
  HistoryStore,
  MAX_RECENT_DOCUMENTS,
  normalizePage
};
