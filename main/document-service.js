const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isPathInside, normalizeRelativeDocumentPath } = require('./security');

const DOCUMENT_EXTENSIONS = new Map([
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
  ['.pdf', 'pdf'],
  ['.docx', 'docx'],
  ['.txt', 'text']
]);

const TYPE_EXTENSIONS = Object.freeze({
  markdown: ['md', 'markdown'],
  docx: ['docx'],
  text: ['txt']
});

const IMAGE_MIME_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
]);

const MAX_TEXT_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_BYTES = 100 * 1024 * 1024;
const MAX_RICH_HTML_BYTES = 40 * 1024 * 1024;
const MAX_SIDECAR_BYTES = 12 * 1024 * 1024;
const SIDECAR_VERSION = 1;

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function validateTextContent(content, label = 'Text') {
  if (typeof content !== 'string') throw new Error(`${label} content must be text.`);
  const size = Buffer.byteLength(content, 'utf8');
  if (size > MAX_TEXT_BYTES) throw new Error(`${label} is larger than the 25 MB safety limit.`);
  return size;
}

function validateHtmlContent(html) {
  if (typeof html !== 'string') throw new Error('Document content must be valid HTML text.');
  const size = Buffer.byteLength(html, 'utf8');
  if (size > MAX_RICH_HTML_BYTES) throw new Error('The edited document is larger than the 40 MB safety limit.');
  return size;
}

function normalizeTarget(filePath, type, { appendDefaultExtension = false } = {}) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('No file path was supplied.');
  }
  if (!TYPE_EXTENSIONS[type]) throw new Error('Unsupported document type.');

  let target = path.resolve(filePath);
  let extension = path.extname(target).slice(1).toLowerCase();
  if (!extension && appendDefaultExtension) {
    const defaultExtension = TYPE_EXTENSIONS[type][0];
    target += `.${defaultExtension}`;
    extension = defaultExtension;
  }
  if (!TYPE_EXTENSIONS[type].includes(extension)) {
    throw new Error(`This file must use the .${TYPE_EXTENSIONS[type][0]} extension.`);
  }
  return target;
}

function sidecarPathFor(markdownPath) {
  const extension = path.extname(markdownPath);
  return path.join(path.dirname(markdownPath), `${path.basename(markdownPath, extension)}.nviewer`);
}

function assetsDirectoryFor(markdownPath) {
  const extension = path.extname(markdownPath);
  return path.join(path.dirname(markdownPath), `${path.basename(markdownPath, extension)}-assets`);
}

function toPosixRelative(fromDirectory, target) {
  return path.relative(fromDirectory, target).split(path.sep).join('/');
}

function encodeAssetPath(value) {
  return value.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function getHtmlToDocx() {
  try {
    return require('html-to-docx');
  } catch {
    throw new Error('DOCX support is not installed. Run npm install before starting N Viewer.');
  }
}

async function getMammoth() {
  try {
    return require('mammoth');
  } catch {
    throw new Error('DOCX support is not installed. Run npm install before starting N Viewer.');
  }
}

function wrapExportHtml(bodyHtml, title = 'N Viewer Document') {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.55; color: #202124; }
  h1 { font-size: 26pt; margin: 0 0 18pt; }
  h2 { font-size: 19pt; margin: 22pt 0 10pt; border-bottom: 1px solid #d9d9d9; padding-bottom: 5pt; }
  h3 { font-size: 15pt; margin: 18pt 0 8pt; }
  p { margin: 0 0 10pt; }
  blockquote { border-left: 3px solid #4977a8; margin: 12pt 0; padding: 6pt 12pt; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 12pt 0; }
  th, td { border: 1px solid #c9c9c9; padding: 6pt; vertical-align: top; }
  th { background: #f0f2f4; font-weight: bold; }
  img { max-width: 100%; height: auto; }
  pre { background: #f2f2f2; padding: 9pt; white-space: pre-wrap; }
  code { font-family: Consolas, monospace; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

async function htmlToDocxBuffer(html, title) {
  validateHtmlContent(html);
  const HTMLtoDOCX = await getHtmlToDocx();
  const result = await HTMLtoDOCX(
    wrapExportHtml(html, title),
    null,
    {
      title,
      creator: 'N Viewer',
      pageSize: { width: 11906, height: 16838 },
      margins: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
      font: 'Aptos',
      fontSize: 22,
      table: { row: { cantSplit: true } },
      footer: false,
      pageNumber: false
    },
    null
  );
  return Buffer.isBuffer(result) ? result : Buffer.from(result);
}

function extractRelativeImagePaths(markdown, sidecarHtml) {
  const paths = new Set();
  const markdownImage = /!\[[^\]]*\]\((?:<)?([^)>\s]+)(?:>)?(?:\s+["'][^"']*["'])?\)/g;
  for (const match of markdown.matchAll(markdownImage)) {
    let value = match[1];
    try { value = decodeURIComponent(value); } catch {}
    value = value.replaceAll('\\', '/');
    if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) && !value.startsWith('/') && !value.startsWith('\\')) {
      paths.add(value.split('#')[0].split('?')[0]);
    }
  }

  if (typeof sidecarHtml === 'string') {
    const dataPath = /data-nviewer-path=(?:"([^"]+)"|'([^']+)')/g;
    for (const match of sidecarHtml.matchAll(dataPath)) {
      const value = (match[1] ?? match[2] ?? '').replaceAll('\\', '/');
      if (value) paths.add(value);
    }
  }
  return [...paths];
}

function replaceAllLiteral(value, oldValue, newValue) {
  return value.split(oldValue).join(newValue);
}

class DocumentService {
  constructor() {
    this.current = null;
    this.revision = 0;
  }

  getCurrent() {
    return this.current;
  }

  async open(filePath) {
    if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('No document path was supplied.');

    const canonicalPath = await fs.promises.realpath(path.resolve(filePath));
    const extension = path.extname(canonicalPath).toLowerCase();
    const type = DOCUMENT_EXTENSIONS.get(extension);
    if (!type) throw new Error('N Viewer supports Markdown, PDF, DOCX, and TXT files.');

    const stats = await fs.promises.stat(canonicalPath);
    if (!stats.isFile()) throw new Error('The selected item is not a file.');
    if ((type === 'markdown' || type === 'text') && stats.size > MAX_TEXT_BYTES) {
      throw new Error('This text document is larger than the 25 MB safety limit.');
    }
    if (type === 'docx' && stats.size > MAX_DOCX_BYTES) {
      throw new Error('This DOCX file is larger than the 100 MB safety limit.');
    }

    this.revision += 1;
    const token = crypto.randomUUID();
    const base = {
      token,
      revision: this.revision,
      path: canonicalPath,
      directory: path.dirname(canonicalPath),
      name: path.basename(canonicalPath),
      type,
      size: stats.size
    };

    if (type === 'markdown') {
      let content = await fs.promises.readFile(canonicalPath, 'utf8');
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
      const sidecar = await this.readMarkdownSidecar(canonicalPath, content);
      this.current = { ...base, content, richHtml: sidecar?.presentationHtml ?? null };
    } else if (type === 'text') {
      let content = await fs.promises.readFile(canonicalPath, 'utf8');
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
      this.current = { ...base, content };
    } else if (type === 'docx') {
      const { html, warnings } = await this.readDocx(canonicalPath);
      this.current = { ...base, html, warnings };
    } else {
      this.current = base;
    }

    return this.toRendererPayload(this.current);
  }

  async readMarkdownSidecar(markdownPath, content) {
    const sidecarPath = sidecarPathFor(markdownPath);
    try {
      const stats = await fs.promises.stat(sidecarPath);
      if (!stats.isFile() || stats.size > MAX_SIDECAR_BYTES) return null;
      const parsed = JSON.parse(await fs.promises.readFile(sidecarPath, 'utf8'));
      if (
        parsed?.version !== SIDECAR_VERSION
        || typeof parsed?.markdownHash !== 'string'
        || parsed.markdownHash !== sha256(content)
        || typeof (parsed?.presentationHtml ?? parsed?.html) !== 'string'
      ) return null;
      const presentationHtml = parsed.presentationHtml ?? parsed.html;
      validateHtmlContent(presentationHtml);
      return { ...parsed, presentationHtml };
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`Ignoring invalid sidecar ${sidecarPath}:`, error.message);
      return null;
    }
  }

  async readDocx(filePath) {
    const mammoth = await getMammoth();
    const result = await mammoth.convertToHtml(
      { path: filePath },
      {
        includeDefaultStyleMap: true,
        convertImage: mammoth.images.imgElement(async (image) => {
          const base64 = await image.read('base64');
          const mime = image.contentType || 'image/png';
          return { src: `data:${mime};base64,${base64}` };
        }),
        styleMap: [
          "u => u",
          "strike => s",
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh"
        ]
      }
    );
    validateHtmlContent(result.value);
    return {
      html: result.value || '<p></p>',
      warnings: (result.messages ?? []).map((message) => message.message).filter(Boolean).slice(0, 20)
    };
  }

  async create(type, filePath) {
    if (!['markdown', 'docx', 'text'].includes(type)) throw new Error('Choose Markdown, DOCX, or TXT.');
    const target = normalizeTarget(filePath, type, { appendDefaultExtension: true });
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    if (type === 'docx') {
      const buffer = await htmlToDocxBuffer('<p></p>', path.basename(target));
      await fs.promises.writeFile(target, buffer);
    } else {
      await fs.promises.writeFile(target, '', 'utf8');
    }
    return this.open(target);
  }

  async save(token, payload) {
    const current = this.requireToken(token);
    if (current.type === 'markdown') return this.saveMarkdown(current, payload);
    if (current.type === 'text') return this.saveText(current, payload);
    if (current.type === 'docx') return this.saveDocx(current, payload);
    throw new Error('PDF files are read-only.');
  }

  async saveMarkdown(current, payload) {
    const content = payload?.markdown;
    const size = validateTextContent(content, 'Markdown');
    const sidecarHtml = payload?.requiresSidecar === true ? payload?.sidecarHtml : null;
    if (sidecarHtml !== null) validateHtmlContent(sidecarHtml);

    await fs.promises.writeFile(current.path, content, 'utf8');
    await this.writeMarkdownSidecar(current.path, content, sidecarHtml);

    current.content = content;
    current.richHtml = sidecarHtml;
    current.size = size;
    current.revision = ++this.revision;
    return this.toRendererPayload(current);
  }

  async writeMarkdownSidecar(markdownPath, content, sidecarHtml) {
    const sidecarPath = sidecarPathFor(markdownPath);
    if (!sidecarHtml) {
      await fs.promises.rm(sidecarPath, { force: true });
      return;
    }
    const payload = {
      version: SIDECAR_VERSION,
      markdownHash: sha256(content),
      presentationHtml: sidecarHtml
    };
    const encoded = JSON.stringify(payload, null, 2);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_SIDECAR_BYTES) {
      throw new Error('The .nviewer sidecar is larger than the 12 MB safety limit.');
    }
    const temporary = `${sidecarPath}.tmp`;
    await fs.promises.writeFile(temporary, encoded, 'utf8');
    await fs.promises.rm(sidecarPath, { force: true });
    await fs.promises.rename(temporary, sidecarPath);
  }

  async saveText(current, payload) {
    const content = payload?.text;
    const size = validateTextContent(content, 'Text');
    await fs.promises.writeFile(current.path, content, 'utf8');
    current.content = content;
    current.size = size;
    current.revision = ++this.revision;
    return this.toRendererPayload(current);
  }

  async saveDocx(current, payload) {
    const html = payload?.html;
    validateHtmlContent(html);
    const buffer = await htmlToDocxBuffer(html, current.name);
    await fs.promises.writeFile(current.path, buffer);
    current.html = html;
    current.size = buffer.length;
    current.revision = ++this.revision;
    return this.toRendererPayload(current);
  }

  async saveCopy(token, payload, filePath) {
    const current = this.requireToken(token);
    if (!['markdown', 'docx', 'text'].includes(current.type)) throw new Error('This document cannot be saved as a copy.');
    const target = normalizeTarget(filePath, current.type, { appendDefaultExtension: true });
    if (path.resolve(target) === path.resolve(current.path)) throw new Error('Choose a different file name for the copy.');
    await fs.promises.mkdir(path.dirname(target), { recursive: true });

    if (current.type === 'markdown') {
      let markdown = payload?.markdown;
      let sidecarHtml = payload?.requiresSidecar === true ? payload?.sidecarHtml : null;
      validateTextContent(markdown, 'Markdown');
      if (sidecarHtml) validateHtmlContent(sidecarHtml);
      ({ markdown, sidecarHtml } = await this.copyMarkdownAssets(current, target, markdown, sidecarHtml));
      await fs.promises.writeFile(target, markdown, 'utf8');
      await this.writeMarkdownSidecar(target, markdown, sidecarHtml);
      return { ok: true, filePath: target, name: path.basename(target) };
    }

    if (current.type === 'text') {
      validateTextContent(payload?.text, 'Text');
      await fs.promises.writeFile(target, payload.text, 'utf8');
      return { ok: true, filePath: target, name: path.basename(target) };
    }

    validateHtmlContent(payload?.html);
    const buffer = await htmlToDocxBuffer(payload.html, path.basename(target));
    await fs.promises.writeFile(target, buffer);
    return { ok: true, filePath: target, name: path.basename(target) };
  }

  async copyMarkdownAssets(current, target, markdown, sidecarHtml) {
    const paths = extractRelativeImagePaths(markdown, sidecarHtml);
    if (paths.length === 0) return { markdown, sidecarHtml };

    const targetAssets = assetsDirectoryFor(target);
    await fs.promises.mkdir(targetAssets, { recursive: true });
    const usedNames = new Set();

    for (const relativePath of paths) {
      const source = path.resolve(current.directory, relativePath);
      if (!isPathInside(current.directory, source)) continue;
      const extension = path.extname(source).toLowerCase();
      if (!IMAGE_MIME_TYPES.has(extension)) continue;
      try {
        const stats = await fs.promises.stat(source);
        if (!stats.isFile()) continue;
      } catch {
        continue;
      }

      const originalName = path.basename(source);
      const stem = path.basename(originalName, path.extname(originalName));
      let name = originalName;
      let counter = 2;
      while (usedNames.has(name.toLowerCase()) || fs.existsSync(path.join(targetAssets, name))) {
        name = `${stem}-${counter++}${extension}`;
      }
      usedNames.add(name.toLowerCase());
      const destination = path.join(targetAssets, name);
      await fs.promises.copyFile(source, destination);
      const replacement = toPosixRelative(path.dirname(target), destination);
      markdown = replaceAllLiteral(markdown, relativePath, replacement);
      if (sidecarHtml) sidecarHtml = replaceAllLiteral(sidecarHtml, relativePath, replacement);
    }

    return { markdown, sidecarHtml };
  }

  async exportDocx(token, html, filePath) {
    const current = this.requireToken(token);
    if (current.type !== 'markdown') throw new Error('Only Markdown documents can be exported as DOCX.');
    const target = normalizeTarget(filePath, 'docx', { appendDefaultExtension: true });
    const embedded = await this.embedMarkdownImages(current, html);
    const buffer = await htmlToDocxBuffer(embedded, path.basename(target));
    await fs.promises.writeFile(target, buffer);
    return { ok: true, filePath: target, name: path.basename(target) };
  }

  async embedMarkdownImages(current, html) {
    validateHtmlContent(html);
    let output = html;
    const matches = [...html.matchAll(/<img\b[^>]*data-nviewer-path=(?:"([^"]+)"|'([^']+)')[^>]*>/gi)];
    for (const match of matches) {
      const relative = (match[1] ?? match[2] ?? '').replaceAll('\\', '/');
      const candidate = path.resolve(current.directory, relative);
      if (!isPathInside(current.directory, candidate)) continue;
      const mime = IMAGE_MIME_TYPES.get(path.extname(candidate).toLowerCase());
      if (!mime) continue;
      try {
        const buffer = await fs.promises.readFile(candidate);
        const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
        const replacedTag = match[0].replace(/\bsrc=(?:"[^"]*"|'[^']*')/i, `src="${dataUrl}"`);
        output = output.replace(match[0], replacedTag);
      } catch {
        // Keep the original relative source if the image can no longer be found.
      }
    }
    return output;
  }

  async importImage(token, sourcePath) {
    const current = this.requireToken(token);
    const canonical = await fs.promises.realpath(path.resolve(sourcePath));
    const extension = path.extname(canonical).toLowerCase();
    const mimeType = IMAGE_MIME_TYPES.get(extension);
    if (!mimeType) throw new Error('Choose a PNG, JPG, GIF, WEBP, AVIF, or BMP image.');
    const stats = await fs.promises.stat(canonical);
    if (!stats.isFile()) throw new Error('The selected image is not a file.');
    if (stats.size > 30 * 1024 * 1024) throw new Error('Images are limited to 30 MB.');

    if (current.type === 'docx') {
      const buffer = await fs.promises.readFile(canonical);
      return {
        kind: 'embedded',
        name: path.basename(canonical),
        src: `data:${mimeType};base64,${buffer.toString('base64')}`
      };
    }
    if (current.type !== 'markdown') throw new Error('Images can be inserted only into Markdown and DOCX documents.');

    const assetDirectory = assetsDirectoryFor(current.path);
    await fs.promises.mkdir(assetDirectory, { recursive: true });
    const originalName = path.basename(canonical);
    const stem = path.basename(originalName, extension);
    let destination = path.join(assetDirectory, originalName);
    let counter = 2;
    while (fs.existsSync(destination)) destination = path.join(assetDirectory, `${stem}-${counter++}${extension}`);
    await fs.promises.copyFile(canonical, destination);
    const relativePath = toPosixRelative(current.directory, destination);
    return {
      kind: 'linked',
      name: path.basename(destination),
      relativePath,
      src: `nviewer://asset/${current.token}/${encodeAssetPath(relativePath)}`
    };
  }

  close() {
    this.current = null;
    this.revision += 1;
  }

  toRendererPayload(document) {
    const base = {
      type: document.type,
      name: document.name,
      token: document.token,
      size: document.size
    };
    if (document.type === 'markdown') {
      return { ...base, content: document.content, richHtml: document.richHtml };
    }
    if (document.type === 'text') return { ...base, content: document.content };
    if (document.type === 'docx') return { ...base, html: document.html, warnings: document.warnings ?? [] };
    return {
      ...base,
      sourceUrl: `nviewer://document/${document.token}/current.pdf?v=${document.revision}`
    };
  }

  async resolveRelativeDocument(token, relativeValue) {
    const current = this.requireToken(token);
    const relativePath = normalizeRelativeDocumentPath(relativeValue);
    const candidate = path.resolve(current.directory, relativePath);
    if (!isPathInside(current.directory, candidate)) throw new Error('The linked document is outside the current document folder.');
    return candidate;
  }

  async resolveAsset(token, encodedPath) {
    const current = this.requireToken(token);
    const relativePath = normalizeRelativeDocumentPath(encodedPath);
    const candidate = path.resolve(current.directory, relativePath);
    if (!isPathInside(current.directory, candidate)) return null;

    const extension = path.extname(candidate).toLowerCase();
    const mimeType = IMAGE_MIME_TYPES.get(extension);
    if (!mimeType) return null;

    try {
      const canonicalPath = await fs.promises.realpath(candidate);
      if (!isPathInside(current.directory, canonicalPath)) return null;
      const stats = await fs.promises.stat(canonicalPath);
      if (!stats.isFile()) return null;
      return { path: canonicalPath, mimeType, size: stats.size };
    } catch {
      return null;
    }
  }

  requireToken(token) {
    if (!this.current || token !== this.current.token) throw new Error('The document session is no longer active.');
    return this.current;
  }
}

module.exports = {
  DocumentService,
  DOCUMENT_EXTENSIONS,
  IMAGE_MIME_TYPES,
  MAX_DOCX_BYTES,
  MAX_TEXT_BYTES,
  SIDECAR_VERSION,
  assetsDirectoryFor,
  htmlToDocxBuffer,
  normalizeTarget,
  sha256,
  sidecarPathFor,
  validateHtmlContent,
  validateTextContent
};
