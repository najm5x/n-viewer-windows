const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DAY_MS, HistoryStore } = require('../main/history-store');

async function makeTempDirectory(t) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'n-viewer-history-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('temporary recent history and PDF last page expire after seven days', async (t) => {
  const directory = await makeTempDirectory(t);
  const pdfPath = path.join(directory, 'long-book.pdf');
  await fs.promises.writeFile(pdfPath, '%PDF-placeholder');

  let now = Date.UTC(2026, 6, 25, 12, 0, 0);
  const store = new HistoryStore(directory, { now: () => now });
  store.touch({ filePath: pdfPath, name: 'long-book.pdf', type: 'pdf', lastPage: 1 });
  store.updatePdfPage(pdfPath, 184);

  assert.equal(store.getPdfPage(pdfPath), 184);
  assert.equal((await store.list()).length, 1);

  now += 7 * DAY_MS + 1;
  assert.equal(store.getPdfPage(pdfPath), 1);
  assert.deepEqual(await store.list(), []);
});

test('missing recent files are removed silently', async (t) => {
  const directory = await makeTempDirectory(t);
  const textPath = path.join(directory, 'temporary.txt');
  await fs.promises.writeFile(textPath, 'temporary');

  const store = new HistoryStore(directory);
  store.touch({ filePath: textPath, name: 'temporary.txt', type: 'text' });
  assert.equal((await store.list()).length, 1);

  await fs.promises.rm(textPath);
  assert.deepEqual(await store.list(), []);
});
