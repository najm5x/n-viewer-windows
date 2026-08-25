const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SettingsStore } = require('../main/settings');

function withTempSettings(initial, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'n-viewer-settings-'));
  try {
    if (initial) {
      fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify(initial), 'utf8');
    }
    callback(new SettingsStore(directory), directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('legacy settings migrate to the Fit Width PDF default', () => {
  withTempSettings({ theme: 'dark', pdfScaleMode: 'fit-width' }, (store, directory) => {
    assert.equal(store.get('theme'), 'dark');
    assert.equal(store.get('pdfScaleMode'), 'fit-width');
    assert.equal(store.get('schemaVersion'), 3);

    const persisted = JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'));
    assert.equal(persisted.schemaVersion, 3);
    assert.equal(persisted.pdfScaleMode, 'fit-width');
  });
});

test('current settings preserve a valid user-selected PDF scale mode', () => {
  withTempSettings({ schemaVersion: 3, pdfScaleMode: 'actual-size' }, (store) => {
    assert.equal(store.get('pdfScaleMode'), 'actual-size');
  });
});
