import {
  htmlToMarkdown,
  hydrateHtml,
  isDocumentLink,
  markdownToHtml,
  needsSidecar,
  portableHtml,
  sanitizeDocumentHtml
} from './markdown-codec.js';

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function safeInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export class RichEditor {
  constructor({ root, toolbar, onChange, onExternalLink, onDocumentLink, onInsertImage }) {
    this.root = root;
    this.toolbar = toolbar;
    this.onChange = onChange;
    this.onExternalLink = onExternalLink;
    this.onDocumentLink = onDocumentLink;
    this.onInsertImage = onInsertImage;
    this.type = null;
    this.token = null;
    this.editable = false;
    this.savedRange = null;

    this.root.addEventListener('input', () => this.onChange());
    this.root.addEventListener('click', (event) => this.handleDocumentClick(event));
    this.root.addEventListener('keydown', (event) => {
      if (!this.editable || event.key !== 'Tab') return;
      if (event.target.closest('table')) return;
      event.preventDefault();
      document.execCommand('insertText', false, '  ');
    });

    document.addEventListener('selectionchange', () => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (this.root.contains(range.commonAncestorContainer)) {
        this.savedRange = range.cloneRange();
        this.updateToolbarState();
      }
    });

    this.toolbar.addEventListener('mousedown', (event) => {
      if (event.target.closest('button')) event.preventDefault();
    });
    this.toolbar.addEventListener('click', (event) => this.handleToolbarClick(event));
    this.toolbar.addEventListener('change', (event) => this.handleToolbarChange(event));
  }

  load({ type, token, markdown, html, richHtml }) {
    this.type = type;
    this.token = token;
    const source = type === 'markdown'
      ? hydrateHtml(richHtml || markdownToHtml(markdown), token, { allowEmbeddedImages: false })
      : hydrateHtml(html || '<p></p>', token, { allowEmbeddedImages: true });
    this.root.innerHTML = source || '<p><br></p>';
    for (const table of [...this.root.querySelectorAll('table')]) {
      if (table.parentElement?.classList.contains('table-scroll')) continue;
      const wrapper = document.createElement('div');
      wrapper.className = 'table-scroll';
      table.replaceWith(wrapper);
      wrapper.append(table);
    }
    this.ensureUsableDocument();
    this.setEditable(false);
  }

  clear() {
    this.root.replaceChildren();
    this.type = null;
    this.token = null;
    this.savedRange = null;
    this.setEditable(false);
  }

  ensureUsableDocument() {
    if (!this.root.textContent?.trim() && !this.root.querySelector('img, table, hr')) {
      this.root.innerHTML = '<p><br></p>';
    }
  }

  setEditable(enabled) {
    this.editable = Boolean(enabled && ['markdown', 'docx'].includes(this.type));
    this.root.contentEditable = this.editable ? 'true' : 'false';
    this.root.spellcheck = this.editable;
    this.root.classList.toggle('is-editable', this.editable);
    this.toolbar.hidden = !this.editable;
    if (this.editable) queueMicrotask(() => this.root.focus());
  }

  focus() {
    this.root.focus();
  }

  getPortableHtml() {
    return portableHtml(this.root);
  }

  getMarkdown() {
    return htmlToMarkdown(this.root);
  }

  requiresSidecar() {
    return needsSidecar(this.root);
  }

  getExportHtml() {
    return sanitizeDocumentHtml(this.getPortableHtml());
  }

  restoreSelection() {
    if (!this.savedRange) {
      this.root.focus();
      return;
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(this.savedRange);
  }

  exec(command, value = null) {
    if (!this.editable) return;
    this.restoreSelection();
    const cssCommands = new Set([
      'fontName', 'foreColor', 'hiliteColor',
      'justifyLeft', 'justifyCenter', 'justifyRight'
    ]);
    document.execCommand('styleWithCSS', false, cssCommands.has(command));
    const normalizedValue = command === 'formatBlock' && value ? `<${value}>` : value;
    document.execCommand(command, false, normalizedValue);
    this.root.focus();
    this.onChange();
    this.updateToolbarState();
  }

  handleToolbarClick(event) {
    const button = event.target.closest('button[data-command], button[data-action]');
    if (!button || button.disabled) return;
    const command = button.dataset.command;
    if (command) {
      this.exec(command, button.dataset.value ?? null);
      return;
    }

    const action = button.dataset.action;
    if (action === 'link') this.createLink();
    else if (action === 'image') void this.insertImage();
    else if (action === 'table') this.insertTable();
    else if (action === 'add-row') this.addTableRow();
    else if (action === 'add-column') this.addTableColumn();
    else if (action === 'delete-table') this.deleteTable();
    else if (action === 'clear-format') this.exec('removeFormat');
  }

  handleToolbarChange(event) {
    const control = event.target;
    const action = control.dataset.action;
    if (!action || !this.editable) return;
    if (action === 'block') this.exec('formatBlock', control.value);
    else if (action === 'font-family') this.exec('fontName', control.value);
    else if (action === 'font-size') this.applyFontSize(control.value);
    else if (action === 'text-color') this.exec('foreColor', control.value);
    else if (action === 'highlight-color') this.exec('hiliteColor', control.value);
    else if (action === 'table-color') this.applyTableColor(control.value);
    else if (action === 'image-width') this.applyImageWidth(control.value);
    else if (action === 'image-align') this.applyImageAlignment(control.value);
  }

  applyFontSize(value) {
    this.restoreSelection();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    for (const font of this.root.querySelectorAll('font[size="7"]')) {
      const span = document.createElement('span');
      span.style.fontSize = value;
      span.append(...font.childNodes);
      font.replaceWith(span);
    }
    this.onChange();
  }

  createLink() {
    this.restoreSelection();
    const selection = window.getSelection();
    const selected = selection?.toString().trim() ?? '';
    const value = window.prompt('Enter a web address, email address, or relative document path:', selected.startsWith('http') ? selected : '');
    if (!value) return;
    const href = value.includes('@') && !value.includes(':') && !value.includes('/') ? `mailto:${value}` : value;
    this.exec('createLink', href);
  }

  async insertImage() {
    const image = await this.onInsertImage();
    if (!image) return;
    const dataPath = image.relativePath ? ` data-nviewer-path="${escapeAttribute(image.relativePath)}"` : '';
    const html = `<img src="${escapeAttribute(image.src)}" alt="${escapeAttribute(image.name ?? '')}"${dataPath} style="max-width: 100%; height: auto">`;
    this.restoreSelection();
    document.execCommand('insertHTML', false, html);
    this.onChange();
  }

  insertTable() {
    const rows = safeInteger(window.prompt('Number of rows:', '3'), 3, 1, 30);
    const columns = safeInteger(window.prompt('Number of columns:', '3'), 3, 1, 12);
    let html = '<div class="table-scroll"><table><thead><tr>';
    for (let column = 0; column < columns; column += 1) html += `<th>Heading ${column + 1}</th>`;
    html += '</tr></thead><tbody>';
    for (let row = 1; row < rows; row += 1) {
      html += '<tr>';
      for (let column = 0; column < columns; column += 1) html += '<td>Text</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div><p><br></p>';
    this.restoreSelection();
    document.execCommand('insertHTML', false, html);
    this.onChange();
  }

  selectedCell() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const node = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode
      : selection.anchorNode?.parentElement;
    return node?.closest?.('td, th') ?? null;
  }

  selectedTable() {
    return this.selectedCell()?.closest('table') ?? null;
  }

  addTableRow() {
    const cell = this.selectedCell();
    const row = cell?.closest('tr');
    if (!row) return;
    const next = row.cloneNode(true);
    for (const item of next.children) item.innerHTML = 'Text';
    row.after(next);
    this.onChange();
  }

  addTableColumn() {
    const cell = this.selectedCell();
    const table = cell?.closest('table');
    if (!table) return;
    const index = [...cell.parentElement.children].indexOf(cell);
    for (const row of table.rows) {
      const source = row.cells[Math.min(index, row.cells.length - 1)];
      const next = document.createElement(source?.tagName === 'TH' ? 'th' : 'td');
      next.textContent = source?.tagName === 'TH' ? 'Heading' : 'Text';
      row.insertBefore(next, row.cells[index + 1] ?? null);
    }
    this.onChange();
  }

  deleteTable() {
    const table = this.selectedTable();
    if (!table) return;
    const wrapper = table.closest('.table-scroll');
    (wrapper ?? table).remove();
    this.onChange();
  }

  applyTableColor(value) {
    const cell = this.selectedCell();
    const table = cell?.closest('table');
    if (!table) return;
    if (cell) cell.style.backgroundColor = value;
    else table.style.borderColor = value;
    this.onChange();
  }

  applyImageWidth(value) {
    const selection = window.getSelection();
    const node = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    const image = node?.closest?.('img') ?? (node?.querySelector?.('img') || null);
    if (!image) return;
    image.style.width = value;
    image.style.maxWidth = '100%';
    image.style.height = 'auto';
    this.onChange();
  }

  applyImageAlignment(value) {
    const selection = window.getSelection();
    const node = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    const image = node?.closest?.('img') ?? (node?.querySelector?.('img') || null);
    if (!image) return;
    if (value === 'left') {
      image.style.marginLeft = '0';
      image.style.marginRight = 'auto';
    } else if (value === 'right') {
      image.style.marginLeft = 'auto';
      image.style.marginRight = '0';
    } else {
      image.style.marginLeft = 'auto';
      image.style.marginRight = 'auto';
    }
    this.onChange();
  }

  updateToolbarState() {
    if (!this.editable) return;
    for (const button of this.toolbar.querySelectorAll('button[data-command]')) {
      const command = button.dataset.command;
      if (!['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight'].includes(command)) continue;
      let active = false;
      try { active = document.queryCommandState(command); } catch {}
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  handleDocumentClick(event) {
    const link = event.target.closest('a[href]');
    if (!link || this.editable) return;
    const href = (link.getAttribute('href') ?? '').trim();
    if (!href || href.startsWith('#')) return;
    event.preventDefault();
    if (/^(https?:|mailto:)/i.test(href)) this.onExternalLink(href);
    else if (isDocumentLink(href)) this.onDocumentLink(this.token, href);
  }
}
