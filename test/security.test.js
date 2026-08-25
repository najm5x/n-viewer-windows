const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  isPathInside,
  normalizeRelativeDocumentPath,
  validateExternalUrl
} = require('../main/security');

test('isPathInside accepts descendants and rejects traversal', () => {
  const root = path.resolve('/documents/report');
  assert.equal(isPathInside(root, path.join(root, 'images', 'chart.png')), true);
  assert.equal(isPathInside(root, path.resolve(root, '..', 'secret.txt')), false);
});

test('normalizeRelativeDocumentPath rejects absolute and malformed links', () => {
  assert.equal(normalizeRelativeDocumentPath('chapter%202.md#part'), 'chapter 2.md');
  assert.throws(() => normalizeRelativeDocumentPath('/etc/passwd'));
  assert.throws(() => normalizeRelativeDocumentPath('C:\\secret.pdf'));
  assert.throws(() => normalizeRelativeDocumentPath('%E0%A4%A'));
});

test('validateExternalUrl only accepts explicit safe protocols', () => {
  assert.equal(validateExternalUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(validateExternalUrl('mailto:reader@example.com'), 'mailto:reader@example.com');
  assert.equal(validateExternalUrl('javascript:alert(1)'), null);
  assert.equal(validateExternalUrl('file:///etc/passwd'), null);
  assert.equal(validateExternalUrl('data:text/html,hello'), null);
});
