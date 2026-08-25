import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false, async: false });

const FORBIDDEN_TAGS = [
  'script', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'video', 'audio', 'source', 'portal', 'meta', 'link', 'style'
];

const ALLOWED_STYLE_PROPERTIES = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'text-align',
  'width', 'height', 'max-width', 'border-color', 'border-style',
  'border-width', 'vertical-align', 'margin-left', 'margin-right'
]);

export function stripFrontMatter(markdown) {
  if (typeof markdown !== 'string') return '';
  
  // 1. Strip the hidden Byte Order Mark (\uFEFF) if present
  // 2. Strip optional leading whitespace and the YAML block
  return markdown
    .replace(/^\uFEFF/, '')
    .replace(/^\s*---[\r\n]+[\s\S]*?[\r\n]+---[\r\n]*/, '');
}

function isSafeStyleValue(value) {
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 160
    && !normalized.includes('url(')
    && !normalized.includes('expression(')
    && !normalized.includes('javascript:')
    && !normalized.includes('@import');
}

function filterStyles(root) {
  for (const element of root.querySelectorAll('[style]')) {
    const next = [];
    for (const property of ALLOWED_STYLE_PROPERTIES) {
      const value = element.style.getPropertyValue(property);
      if (value && isSafeStyleValue(value)) next.push(`${property}: ${value}`);
    }
    if (next.length) element.setAttribute('style', next.join('; '));
    else element.removeAttribute('style');
  }
}

export function sanitizeDocumentHtml(html) {
  const safe = DOMPurify.sanitize(String(html ?? ''), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_TAGS,
    ALLOW_DATA_ATTR: true,
    ADD_ATTR: ['style', 'data-nviewer-path'],
    WHOLE_DOCUMENT: false
  });

  const template = document.createElement('template');
  template.innerHTML = safe;

  filterStyles(template.content);

  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith('on')) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return template.innerHTML;
}

function encodeAssetPath(value) {
  return value.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function isRelativeReference(value) {
  return !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)
    && !value.startsWith('//')
    && !value.startsWith('/')
    && !value.startsWith('\\');
}

function safeDecodeReference(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function markdownToHtml(markdown) {
  const cleaned = stripFrontMatter(markdown);
  return sanitizeDocumentHtml(marked.parse(String(cleaned ?? '')));
}

export function hydrateHtml(html, token, { allowEmbeddedImages = true } = {}) {
  const template = document.createElement('template');
  template.innerHTML = sanitizeDocumentHtml(html);

  for (const image of [...template.content.querySelectorAll('img')]) {
    const dataPath = (image.getAttribute('data-nviewer-path') ?? '').trim();
    const source = (image.getAttribute('src') ?? '').trim();
    const relative = dataPath || (isRelativeReference(source) ? source : '');
    if (relative) {
      const normalized = safeDecodeReference(relative.split('#')[0].split('?')[0]).replaceAll('\\', '/');
      image.dataset.nviewerPath = normalized;
      image.src = `nviewer://asset/${token}/${encodeAssetPath(normalized)}`;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      continue;
    }
    if (allowEmbeddedImages && source.startsWith('data:image/')) continue;
    const replacement = document.createElement('div');
    replacement.className = 'remote-image-placeholder';
    replacement.textContent = image.alt
      ? `Remote image blocked for privacy: ${image.alt}`
      : 'Remote image blocked for privacy.';
    image.replaceWith(replacement);
  }

  return template.innerHTML;
}

export function portableHtml(root) {
  const clone = root.cloneNode(true);
  clone.removeAttribute('contenteditable');
  clone.removeAttribute('spellcheck');
  for (const element of clone.querySelectorAll('[contenteditable], [spellcheck]')) {
    element.removeAttribute('contenteditable');
    element.removeAttribute('spellcheck');
  }
  for (const image of clone.querySelectorAll('img')) {
    const relative = image.dataset.nviewerPath;
    if (relative) image.setAttribute('src', relative);
    image.removeAttribute('loading');
    image.removeAttribute('referrerpolicy');
  }
  for (const placeholder of clone.querySelectorAll('.remote-image-placeholder')) placeholder.remove();
  return sanitizeDocumentHtml(clone.innerHTML).trim();
}

export function needsSidecar(root) {
  if (root.querySelector('img, u, font, [data-nviewer-path]')) return true;
  for (const element of root.querySelectorAll('[style]')) {
    const style = element.getAttribute('style') ?? '';
    if (/\b(color|background-color|font-family|font-size|text-align|width|height|max-width|border-color|border-style|border-width|margin-left|margin-right)\s*:/i.test(style)) {
      return true;
    }
  }
  return false;
}

function normalizeWhitespace(value) {
  return value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

function escapeText(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([*_`[\]])/g, '\\$1');
}

function plainText(node) {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function convertTable(table) {
  const rows = [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')];
  if (!rows.length) return '';
  const matrix = rows.map((row) => [...row.children]
    .filter((cell) => ['TH', 'TD'].includes(cell.tagName))
    .map((cell) => plainText(cell).replaceAll('|', '\\|').replace(/\n/g, '<br>')));
  const width = Math.max(...matrix.map((row) => row.length), 1);
  const normalized = matrix.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]);
  const header = normalized[0];
  const body = normalized.slice(1);
  const line = (row) => `| ${row.join(' | ')} |`;
  return `${line(header)}\n${line(Array(width).fill('---'))}${body.length ? `\n${body.map(line).join('\n')}` : ''}\n\n`;
}

function convertList(list, depth, convertNode) {
  const ordered = list.tagName === 'OL';
  const start = Number.parseInt(list.getAttribute('start') ?? '1', 10) || 1;
  const lines = [];
  const items = [...list.children].filter((child) => child.tagName === 'LI');
  items.forEach((item, index) => {
    const prefix = ordered ? `${start + index}. ` : '- ';
    const direct = [...item.childNodes].filter((child) => !(child.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes(child.tagName)));
    const body = direct.map((child) => convertNode(child, { inline: true, depth })).join('').trim();
    lines.push(`${'  '.repeat(depth)}${prefix}${body}`);
    for (const nested of [...item.children].filter((child) => ['UL', 'OL'].includes(child.tagName))) {
      lines.push(convertList(nested, depth + 1, convertNode).trimEnd());
    }
  });
  return `${lines.join('\n')}\n\n`;
}

export function htmlToMarkdown(root) {
  const convertNode = (node, context = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? '';
      if (context.code) return value;
      return escapeText(value.replace(/\s+/g, context.inline ? ' ' : ' '));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const children = (childContext = context) => [...node.childNodes].map((child) => convertNode(child, childContext)).join('');
    if (tag === 'br') return '  \n';
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${children({ inline: true }).trim()}\n\n`;
    if (tag === 'p') return `${children({ inline: true }).trim()}\n\n`;
    if (tag === 'strong' || tag === 'b') return `**${children({ inline: true }).trim()}**`;
    if (tag === 'em' || tag === 'i') return `*${children({ inline: true }).trim()}*`;
    if (tag === 's' || tag === 'strike' || tag === 'del') return `~~${children({ inline: true }).trim()}~~`;
    if (tag === 'u' || tag === 'span' || tag === 'font') return children({ inline: true });
    if (tag === 'code' && node.parentElement?.tagName !== 'PRE') return `\`${children({ inline: true, code: true }).replaceAll('`', '\\`')}\``;
    if (tag === 'pre') {
      const code = node.textContent ?? '';
      const fence = code.includes('```') ? '~~~~' : '```';
      return `${fence}\n${code.replace(/\n+$/, '')}\n${fence}\n\n`;
    }
    if (tag === 'blockquote') {
      const value = normalizeWhitespace(children()).trim();
      return `${value.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
    }
    if (tag === 'ul' || tag === 'ol') return convertList(node, context.depth ?? 0, convertNode);
    if (tag === 'li') return children({ inline: true });
    if (tag === 'a') {
      const href = (node.getAttribute('href') ?? '').trim();
      const label = children({ inline: true }).trim() || href;
      return href ? `[${label}](${href})` : label;
    }
    if (tag === 'img') {
      const source = node.dataset.nviewerPath || node.getAttribute('src') || '';
      const alt = (node.getAttribute('alt') ?? '').replaceAll(']', '\\]');
      return source ? `![${alt}](${source})` : '';
    }
    if (tag === 'table') return convertTable(node);
    if (tag === 'hr') return '---\n\n';
    if (tag === 'div' || tag === 'section' || tag === 'article') return `${children()}\n`;
    return children(context);
  };

  const markdown = [...root.childNodes].map((node) => convertNode(node)).join('');
  return `${normalizeWhitespace(markdown).trim()}${markdown.trim() ? '\n' : ''}`;
}

export function isDocumentLink(value) {
  return isRelativeReference(value) && /\.(md|markdown|pdf|docx|txt)(?:[?#].*)?$/i.test(value);
}