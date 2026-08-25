const fs = require('node:fs');
const path = require('node:path');

const SETTINGS_SCHEMA_VERSION = 3;

const DEFAULTS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  theme: 'light',
  pdfFilter: 'invert',
  pdfScaleMode: 'fit-width',
  windowBounds: { width: 1200, height: 820 },
  maximized: false
});

class SettingsStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'settings.json');
    this.values = structuredClone(DEFAULTS);
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const isLegacy = !Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < SETTINGS_SCHEMA_VERSION;
      const parsedScaleMode = ['fit-width', 'fit-page', 'actual-size'].includes(parsed.pdfScaleMode)
        ? parsed.pdfScaleMode
        : DEFAULTS.pdfScaleMode;
      this.values = {
        ...this.values,
        ...parsed,
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        // Version 3 migrates existing installations to Fit Width once.
        pdfScaleMode: isLegacy ? 'fit-width' : parsedScaleMode,
        windowBounds: { ...DEFAULTS.windowBounds, ...(parsed.windowBounds ?? {}) }
      };
      if (isLegacy) this.save();
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Unable to read settings:', error.message);
    }
  }

  get(key) {
    return this.values[key];
  }

  snapshot() {
    return structuredClone(this.values);
  }

  set(key, value) {
    this.values[key] = value;
    this.save();
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify(this.values, null, 2), 'utf8');
      fs.rmSync(this.filePath, { force: true });
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      console.warn('Unable to save settings:', error.message);
    }
  }
}

module.exports = { DEFAULTS, SettingsStore };
