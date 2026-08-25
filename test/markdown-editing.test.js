const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DocumentService,
  sidecarPathFor
} = require('../main/document-service');

async function makeTempDirectory(t, prefix) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('simple Markdown saves without creating a .nviewer sidecar', async (t) => {
  const directory = await makeTempDirectory(t, 'n-viewer-markdown-');
  const service = new DocumentService();
  const markdownPath = path.join(directory, 'notes.md');

  const created = await service.create('markdown', markdownPath);
  assert.equal(created.type, 'markdown');
  assert.equal(created.name, 'notes.md');
  assert.equal(created.content, '');

  const saved = await service.save(created.token, {
    markdown: '# Updated\n\n**Portable Markdown**\n',
    requiresSidecar: false,
    sidecarHtml: null
  });

  assert.equal(saved.content, '# Updated\n\n**Portable Markdown**\n');
  assert.equal(
    await fs.promises.readFile(markdownPath, 'utf8'),
    '# Updated\n\n**Portable Markdown**\n'
  );
  assert.equal(fs.existsSync(sidecarPathFor(markdownPath)), false);
});

test('rich Markdown creates, reloads, and removes the .nviewer sidecar only when needed', async (t) => {
  const directory = await makeTempDirectory(t, 'n-viewer-sidecar-');
  const service = new DocumentService();
  const markdownPath = path.join(directory, 'styled.md');
  const created = await service.create('markdown', markdownPath);
  const markdown = '# Styled note\n\nImportant text.\n';
  const sidecarHtml = '<h1>Styled note</h1><p><span style="color: #b42318">Important text.</span></p>';

  await service.save(created.token, {
    markdown,
    requiresSidecar: true,
    sidecarHtml
  });

  const sidecarPath = sidecarPathFor(markdownPath);
  assert.equal(fs.existsSync(sidecarPath), true);
  const sidecar = JSON.parse(await fs.promises.readFile(sidecarPath, 'utf8'));
  assert.equal(sidecar.version, 1);
  assert.equal(sidecar.presentationHtml, sidecarHtml);
  assert.equal(Object.hasOwn(sidecar, 'content'), false);
  assert.match(sidecar.markdownHash, /^[a-f0-9]{64}$/);

  service.close();
  const reopened = await service.open(markdownPath);
  assert.equal(reopened.richHtml, sidecarHtml);

  await service.save(reopened.token, {
    markdown,
    requiresSidecar: false,
    sidecarHtml: null
  });
  assert.equal(fs.existsSync(sidecarPath), false);
});

test('Markdown Save as Copy remains portable and carries rich sidecar metadata when required', async (t) => {
  const directory = await makeTempDirectory(t, 'n-viewer-copy-');
  const service = new DocumentService();
  const created = await service.create('markdown', path.join(directory, 'source.md'));
  const copyPath = path.join(directory, 'copy.md');

  const result = await service.saveCopy(created.token, {
    markdown: '# Copy\n',
    requiresSidecar: true,
    sidecarHtml: '<h1 style="color: #315a82">Copy</h1>'
  }, copyPath);

  assert.equal(result.ok, true);
  assert.equal(result.name, 'copy.md');
  assert.equal(await fs.promises.readFile(copyPath, 'utf8'), '# Copy\n');
  assert.equal(fs.existsSync(sidecarPathFor(copyPath)), true);
});

test('TXT files can be created, edited, and saved as a copy without formatting metadata', async (t) => {
  const directory = await makeTempDirectory(t, 'n-viewer-text-');
  const service = new DocumentService();
  const textPath = path.join(directory, 'plain.txt');
  const created = await service.create('text', textPath);

  const saved = await service.save(created.token, { text: 'A readable wrapped text file.\n' });
  assert.equal(saved.type, 'text');
  assert.equal(await fs.promises.readFile(textPath, 'utf8'), 'A readable wrapped text file.\n');

  const copyPath = path.join(directory, 'plain-copy.txt');
  const copy = await service.saveCopy(created.token, { text: 'Copied text.\n' }, copyPath);
  assert.equal(copy.ok, true);
  assert.equal(await fs.promises.readFile(copyPath, 'utf8'), 'Copied text.\n');
  assert.equal(fs.existsSync(path.join(directory, 'plain-copy.nviewer')), false);
});
