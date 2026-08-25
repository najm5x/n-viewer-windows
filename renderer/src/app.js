import './styles.css';
import { PdfViewer } from './pdf-viewer.js';
import { RichEditor } from './rich-editor.js';

const elements = {
  app: document.querySelector('#app'),
  welcome: document.querySelector('#welcome'),
  richView: document.querySelector('#rich-view'),
  richDocument: document.querySelector('#rich-document'),
  formattingToolbar: document.querySelector('#formatting-toolbar'),
  textView: document.querySelector('#text-view'),
  textReader: document.querySelector('#text-reader'),
  textEditor: document.querySelector('#text-editor'),
  pdfView: document.querySelector('#pdf-view'),
  pdfPages: document.querySelector('#pdf-pages'),
  errorView: document.querySelector('#error-view'),
  errorMessage: document.querySelector('#error-message'),
  loading: document.querySelector('#loading'),
  loadingText: document.querySelector('#loading-text'),
  openButton: document.querySelector('#open-button'),
  newFileButton: document.querySelector('#new-file-button'),
  errorOpenButton: document.querySelector('#error-open-button'),
  recentSection: document.querySelector('#recent-section'),
  recentList: document.querySelector('#recent-list'),
  readerHud: document.querySelector('#reader-hud'),
  menuButton: document.querySelector('#menu-button'),
  documentMenu: document.querySelector('#document-menu'),
  menuOpen: document.querySelector('#menu-open'),
  menuNewFile: document.querySelector('#menu-new-file'),
  menuSaveCopy: document.querySelector('#menu-save-copy'),
  menuSavePdf: document.querySelector('#menu-save-pdf'),
  menuSaveDocx: document.querySelector('#menu-save-docx'),
  menuCloseFile: document.querySelector('#menu-close-file'),
  editButton: document.querySelector('#edit-button'),
  saveButton: document.querySelector('#save-button'),
  zoomLabel: document.querySelector('#zoom-label'),
  pageLabel: document.querySelector('#page-label'),
  pageDivider: document.querySelector('#page-divider'),
  zoomIn: document.querySelector('#zoom-in'),
  zoomOut: document.querySelector('#zoom-out'),
  themeButton: document.querySelector('#theme-button'),
  fullscreenButton: document.querySelector('#fullscreen-button'),
  toast: document.querySelector('#toast'),
  passwordDialog: document.querySelector('#password-dialog'),
  passwordForm: document.querySelector('#password-form'),
  passwordInput: document.querySelector('#password-input'),
  passwordMessage: document.querySelector('#password-message')
};

const state = {
  document: null,
  recentDocuments: [],
  theme: 'light',
  pdfFilter: 'invert',
  pdfScaleMode: 'fit-width',
  documentZoom: 1,
  editMode: false,
  dirty: false,
  savedText: '',
  draftText: '',
  menuOpen: false,
  exportRestoreEditMode: false,
  hudTimer: null,
  toastTimer: null,
  pdfHistoryTimer: null,
  lastReportedPdfPage: null,
  passwordResolver: null,
  lastEditStateSignature: ''
};

function isMarkdown() { return state.document?.type === 'markdown'; }
function isDocx() { return state.document?.type === 'docx'; }
function isText() { return state.document?.type === 'text'; }
function isPdf() { return state.document?.type === 'pdf'; }
function isRichDocument() { return isMarkdown() || isDocx(); }
function isEditable() { return isRichDocument() || isText(); }
function canExportPdf() { return isMarkdown() || isDocx(); }
function canSave() { return isEditable() && state.editMode && state.dirty; }

function setLoading(visible, message = 'Opening document…') {
  elements.loading.hidden = !visible;
  elements.loadingText.textContent = message;
}

function showOnly(view) {
  for (const element of [elements.welcome, elements.richView, elements.textView, elements.pdfView, elements.errorView]) {
    element.hidden = element !== view;
  }
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  setLoading(false);
  closeDocumentMenu();
  elements.errorMessage.textContent = message;
  showOnly(elements.errorView);
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  state.toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2400);
}

function showHud() {
  if (!state.document) return;
  clearTimeout(state.hudTimer);
  elements.app.classList.add('hud-visible');
  if (state.menuOpen || state.editMode) return;
  state.hudTimer = setTimeout(() => elements.app.classList.remove('hud-visible'), 2200);
}

function closeDocumentMenu() {
  state.menuOpen = false;
  elements.documentMenu.hidden = true;
  elements.menuButton.setAttribute('aria-expanded', 'false');
}

function toggleDocumentMenu() {
  if (!state.document) return;
  state.menuOpen = !state.menuOpen;
  elements.documentMenu.hidden = !state.menuOpen;
  elements.menuButton.setAttribute('aria-expanded', String(state.menuOpen));
  showHud();
}

function applyTheme(theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.pdfFilter = state.pdfFilter;
}

function applyPdfFilter(filter) {
  state.pdfFilter = ['original', 'dim', 'invert'].includes(filter) ? filter : 'invert';
  document.documentElement.dataset.pdfFilter = state.pdfFilter;
}

function markDirty() {
  if (!state.editMode || !isEditable()) return;
  state.dirty = true;
  if (isText()) state.draftText = elements.textEditor.value;
  updateControls();
  showHud();
}

const richEditor = new RichEditor({
  root: elements.richDocument,
  toolbar: elements.formattingToolbar,
  onChange: markDirty,
  onExternalLink: (url) => window.nviewer.openExternal(url).catch(showError),
  onDocumentLink: (token, relativePath) => openResult(window.nviewer.openRelativeDocument(token, relativePath)),
  onInsertImage: () => state.document ? window.nviewer.insertImage(state.document.token) : null
});
let activePdfZoom = 1.0; // Add this tracking variable
const pdfViewer = new PdfViewer({
  scrollRoot: elements.pdfView,
  pagesContainer: elements.pdfPages,
  onLoading: setLoading,
  onError: showError,
  onStatus: ({ currentPage, totalPages, zoom }) => {
    activePdfZoom = zoom; // <--- Capture the current zoom level here
    elements.pageLabel.textContent = totalPages ? `${currentPage} / ${totalPages}` : '';
    elements.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    if (isPdf() && currentPage !== state.lastReportedPdfPage) {
      state.lastReportedPdfPage = currentPage;
      clearTimeout(state.pdfHistoryTimer);
      state.pdfHistoryTimer = setTimeout(() => {
        if (isPdf()) window.nviewer.updatePdfLastPage(state.document.token, currentPage);
      }, 500);
    }
  },
  requestPassword: requestPdfPassword
});

function collectDocumentPayload() {
  if (isMarkdown()) {
    const requiresSidecar = richEditor.requiresSidecar();
    return {
      markdown: richEditor.getMarkdown(),
      requiresSidecar,
      sidecarHtml: requiresSidecar ? richEditor.getPortableHtml() : null,
      html: richEditor.getExportHtml()
    };
  }
  if (isDocx()) return { html: richEditor.getExportHtml() };
  if (isText()) return { text: state.draftText };
  return null;
}

function syncEditState() {
  const payload = {
    token: state.document?.token ?? null,
    type: state.document?.type ?? null,
    editMode: state.editMode,
    dirty: state.dirty
  };
  const signature = JSON.stringify(payload);
  if (signature === state.lastEditStateSignature) return;
  state.lastEditStateSignature = signature;
  window.nviewer.updateEditState(payload);
}

function updateControls() {
  const editable = isEditable();
  const saveEnabled = canSave();
  const pdf = isPdf();

  elements.readerHud.hidden = !state.document;
  elements.editButton.disabled = !editable;
  elements.editButton.textContent = state.editMode ? 'Done' : 'Edit';
  elements.editButton.setAttribute('aria-pressed', String(editable && state.editMode));
  elements.editButton.title = !editable
    ? 'PDF files are read-only'
    : state.editMode
      ? 'Return to reading mode'
      : 'Edit this document';
  elements.saveButton.disabled = !saveEnabled;

  elements.menuSaveCopy.hidden = pdf;
  elements.menuSaveCopy.disabled = !saveEnabled;
  elements.menuSavePdf.hidden = !canExportPdf();
  elements.menuSavePdf.disabled = !canExportPdf();
  elements.menuSaveDocx.hidden = !isMarkdown();
  elements.menuSaveDocx.disabled = !isMarkdown();
  elements.menuCloseFile.disabled = !state.document;
  elements.pageDivider.hidden = !pdf;
  if (!pdf) elements.pageLabel.textContent = '';

  syncEditState();
}

function updateDocumentZoom() {
  if (isRichDocument()) elements.richDocument.style.fontSize = `${17.5 * state.documentZoom}px`;
  if (isText()) {
    elements.textReader.style.fontSize = `${17 * state.documentZoom}px`;
    elements.textEditor.style.fontSize = `${16 * state.documentZoom}px`;
  }
  if (!isPdf()) elements.zoomLabel.textContent = `${Math.round(state.documentZoom * 100)}%`;
}

function renderTextReader() {
  elements.textReader.textContent = state.draftText;
}

function setEditMode(enabled, { focus = true } = {}) {
  if (!isEditable()) enabled = false;
  state.editMode = enabled;
  elements.richView.classList.toggle('is-editing', enabled && isRichDocument());
  elements.textView.classList.toggle('is-editing', enabled && isText());

  if (isRichDocument()) {
    richEditor.setEditable(enabled);
    if (enabled && focus) queueMicrotask(() => richEditor.focus());
  } else {
    richEditor.setEditable(false);
  }

  if (isText()) {
    if (enabled) {
      elements.textEditor.value = state.draftText;
      elements.textReader.hidden = true;
      elements.textEditor.hidden = false;
      if (focus) queueMicrotask(() => elements.textEditor.focus());
    } else {
      if (!elements.textEditor.hidden) state.draftText = elements.textEditor.value;
      renderTextReader();
      elements.textEditor.hidden = true;
      elements.textReader.hidden = false;
    }
  }

  updateControls();
  showHud();
}

async function displayDocument(payload) {
  if (!payload) return;
  setLoading(true);
  closeDocumentMenu();
  state.document = payload;
  state.editMode = false;
  state.dirty = false;
  state.documentZoom = 1;
  state.lastReportedPdfPage = null;
  document.title = `${payload.name} — N Viewer`;
  elements.pageLabel.textContent = '';

  try {
    if (payload.type === 'markdown' || payload.type === 'docx') {
      await pdfViewer.close();
      state.savedText = '';
      state.draftText = '';
      elements.textEditor.value = '';
      richEditor.load({
        type: payload.type,
        token: payload.token,
        markdown: payload.content,
        html: payload.html,
        richHtml: payload.richHtml
      });
      showOnly(elements.richView);
      elements.richView.scrollTop = 0;
      updateDocumentZoom();
      setEditMode(payload.openInEditMode === true, { focus: payload.openInEditMode === true });
      if (payload.type === 'docx' && payload.warnings?.length) {
        showToast('DOCX opened in simplified editing mode. Complex Word layout may be reduced.');
      }
    } else if (payload.type === 'text') {
      await pdfViewer.close();
      richEditor.clear();
      state.savedText = payload.content;
      state.draftText = payload.content;
      elements.textEditor.value = payload.content;
      renderTextReader();
      showOnly(elements.textView);
      elements.textView.scrollTop = 0;
      updateDocumentZoom();
      setEditMode(payload.openInEditMode === true, { focus: payload.openInEditMode === true });
    } else {
      richEditor.clear();
      state.savedText = '';
      state.draftText = '';
      elements.textEditor.value = '';
      elements.textEditor.hidden = true;
      elements.textReader.hidden = false;
      showOnly(elements.pdfView);
      pdfViewer.setScaleMode(state.pdfScaleMode || 'fit-width');
      await pdfViewer.open(payload.sourceUrl, payload.resumePage ?? 1);
    }
    updateControls();
    showHud();
  } catch (error) {
    showError(error);
  } finally {
    setLoading(false);
  }
}

function relativeTime(timestamp) {
  const elapsed = Date.now() - timestamp;
  const day = 24 * 60 * 60 * 1000;
  if (elapsed < day) return 'Today';
  if (elapsed < 2 * day) return 'Yesterday';
  return `${Math.max(2, Math.floor(elapsed / day))} days ago`;
}

function typeLabel(type) {
  return { markdown: 'MD', pdf: 'PDF', docx: 'DOCX', text: 'TXT' }[type] ?? 'FILE';
}

function renderRecentDocuments(entries = state.recentDocuments) {
  state.recentDocuments = Array.isArray(entries) ? entries : [];
  elements.recentList.replaceChildren();
  elements.recentSection.hidden = state.recentDocuments.length === 0;
  for (const entry of state.recentDocuments) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-item';
    const badge = document.createElement('span');
    badge.className = `recent-type recent-type-${entry.type}`;
    badge.textContent = typeLabel(entry.type);
    const details = document.createElement('span');
    details.className = 'recent-details';
    const name = document.createElement('strong');
    name.textContent = entry.name;
    const time = document.createElement('small');
    time.textContent = relativeTime(entry.lastOpenedAt);
    details.append(name, time);
    button.append(badge, details);
    button.addEventListener('click', () => openResult(window.nviewer.openRecentDocument(entry.path)));
    elements.recentList.append(button);
  }
}

async function showHome() {
  closeDocumentMenu();
  await pdfViewer.close();
  richEditor.clear();
  state.document = null;
  state.editMode = false;
  state.dirty = false;
  state.savedText = '';
  state.draftText = '';
  state.lastEditStateSignature = '';
  elements.textEditor.value = '';
  elements.textEditor.hidden = true;
  elements.textReader.hidden = false;
  elements.readerHud.hidden = true;
  elements.app.classList.remove('hud-visible');
  document.title = 'N Viewer';
  showOnly(elements.welcome);
  try { renderRecentDocuments(await window.nviewer.getRecentDocuments()); } catch {}
  updateControls();
}

async function openResult(promise) {
  try {
    const payload = await promise;
    if (payload) await displayDocument(payload);
  } catch (error) {
    showError(error);
  }
}

async function openDocument() {
  closeDocumentMenu();
  await openResult(window.nviewer.openDialog());
}

async function createFile() {
  closeDocumentMenu();
  await openResult(window.nviewer.createFile());
}

async function saveDocument() {
  if (!canSave()) return;
  const payload = collectDocumentPayload();
  const result = await window.nviewer.saveDocument(state.document.token, payload);
  if (!result?.ok) return;
  state.dirty = false;
  state.document = { ...state.document, ...result.document };
  if (isText()) {
    state.savedText = state.draftText;
    renderTextReader();
  }
  updateControls();
  showHud();
}

async function saveDocumentCopy() {
  if (!canSave() || isPdf()) return;
  closeDocumentMenu();
  await window.nviewer.saveDocumentCopy(state.document.token, collectDocumentPayload());
  updateControls();
  showHud();
}

async function saveDocumentAsPdf() {
  if (!canExportPdf()) return;
  closeDocumentMenu();
  await window.nviewer.exportDocumentPdf(state.document.token);
  showHud();
}

async function saveMarkdownAsDocx() {
  if (!isMarkdown()) return;
  closeDocumentMenu();
  await window.nviewer.exportMarkdownDocx(state.document.token, richEditor.getExportHtml());
  showHud();
}

async function closeFile() {
  closeDocumentMenu();
  await window.nviewer.closeDocument();
}

function currentZoomIn() {
  if (!state.document) return;
  if (isPdf()) pdfViewer.zoomIn();
  else {
    state.documentZoom = Math.min(2, Math.round((state.documentZoom + 0.1) * 10) / 10);
    updateDocumentZoom();
  }
  showHud();
}

function currentZoomOut() {
  if (!state.document) return;
  if (isPdf()) pdfViewer.zoomOut();
  else {
    state.documentZoom = Math.max(0.7, Math.round((state.documentZoom - 0.1) * 10) / 10);
    updateDocumentZoom();
  }
  showHud();
}

function resetZoom() {
  if (!state.document) return;
  if (isPdf()) pdfViewer.resetZoom();
  else {
    state.documentZoom = 1;
    updateDocumentZoom();
  }
  showHud();
}

async function executeViewCommand(payload) {
  const command = payload?.command;
  if (command === 'zoom-in') currentZoomIn();
  else if (command === 'zoom-out') currentZoomOut();
  else if (command === 'zoom-reset') resetZoom();
  else if (command === 'fit-width' || command === 'fit-page' || command === 'actual-size') {
    state.pdfScaleMode = command;
    pdfViewer.setScaleMode(command);
    showHud();
  }
}

async function executeDocumentCommand(payload) {
  const command = payload?.command;
  if (command === 'open') await openDocument();
  else if (command === 'new') await createFile();
  else if (command === 'edit' && isEditable()) setEditMode(!state.editMode);
  else if (command === 'save') await saveDocument();
  else if (command === 'save-copy') await saveDocumentCopy();
  else if (command === 'save-pdf') await saveDocumentAsPdf();
  else if (command === 'save-docx') await saveMarkdownAsDocx();
  else if (command === 'close') await closeFile();
}

function requestPdfPassword(reason) {
  if (state.passwordResolver) state.passwordResolver(null);
  elements.passwordMessage.textContent = reason === 2
    ? 'That password was not accepted. Try again.'
    : 'Enter the password to open this document.';
  elements.passwordInput.value = '';
  elements.passwordDialog.showModal();
  queueMicrotask(() => elements.passwordInput.focus());
  return new Promise((resolve) => { state.passwordResolver = resolve; });
}

elements.passwordForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = event.submitter?.value === 'submit' ? elements.passwordInput.value : null;
  elements.passwordDialog.close();
  state.passwordResolver?.(value);
  state.passwordResolver = null;
});

elements.openButton.addEventListener('click', openDocument);
elements.newFileButton.addEventListener('click', createFile);
elements.errorOpenButton.addEventListener('click', openDocument);
elements.menuButton.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleDocumentMenu();
});
elements.documentMenu.addEventListener('click', (event) => event.stopPropagation());
elements.menuOpen.addEventListener('click', openDocument);
elements.menuNewFile.addEventListener('click', createFile);
elements.menuSaveCopy.addEventListener('click', saveDocumentCopy);
elements.menuSavePdf.addEventListener('click', saveDocumentAsPdf);
elements.menuSaveDocx.addEventListener('click', saveMarkdownAsDocx);
elements.menuCloseFile.addEventListener('click', closeFile);
elements.editButton.addEventListener('click', () => {
  if (isEditable()) setEditMode(!state.editMode);
});
elements.saveButton.addEventListener('click', saveDocument);
elements.zoomIn.addEventListener('click', currentZoomIn);
elements.zoomOut.addEventListener('click', currentZoomOut);
elements.themeButton.addEventListener('click', async () => {
  const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(await window.nviewer.setTheme(nextTheme));
  showHud();
});
elements.fullscreenButton.addEventListener('click', () => window.nviewer.toggleFullscreen());
elements.textEditor.addEventListener('input', markDirty);
elements.textEditor.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  event.preventDefault();
  const start = elements.textEditor.selectionStart;
  const end = elements.textEditor.selectionEnd;
  elements.textEditor.setRangeText('  ', start, end, 'end');
  markDirty();
});

elements.app.addEventListener('pointermove', showHud, { passive: true });
document.addEventListener('click', closeDocumentMenu);
document.addEventListener('dragover', (event) => {
  event.preventDefault();
  elements.app.classList.add('drag-active');
});
document.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) elements.app.classList.remove('drag-active');
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  elements.app.classList.remove('drag-active');
  const [file] = event.dataTransfer.files;
  if (file) openResult(window.nviewer.openDroppedFile(file));
});

document.addEventListener('keydown', (event) => {
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.key === 'Escape' && state.menuOpen) {
    event.preventDefault();
    closeDocumentMenu();
  } else if (modifier && event.shiftKey && key === 's') {
    event.preventDefault();
    saveDocumentCopy();
  } else if (modifier && key === 'o') {
    event.preventDefault();
    openDocument();
  } else if (modifier && key === 'n') {
    event.preventDefault();
    createFile();
  } else if (modifier && key === 'e') {
    event.preventDefault();
    if (isEditable()) setEditMode(!state.editMode);
  } else if (modifier && key === 's') {
    event.preventDefault();
    saveDocument();
  } else if (modifier && (event.key === '+' || event.key === '=')) {
    event.preventDefault();
    currentZoomIn();
  } else if (modifier && event.key === '-') {
    event.preventDefault();
    currentZoomOut();
  } else if (modifier && event.key === '0') {
    event.preventDefault();
    resetZoom();
  } else if (modifier && event.key === '1') {
    event.preventDefault();
    state.pdfScaleMode = 'fit-width';
    window.nviewer.setPdfScaleMode('fit-width');
  } else if (modifier && event.key === '2') {
    event.preventDefault();
    state.pdfScaleMode = 'fit-page';
    window.nviewer.setPdfScaleMode('fit-page');
  } else if (modifier && event.key === '3') {
    event.preventDefault();
    state.pdfScaleMode = 'actual-size';
    window.nviewer.setPdfScaleMode('actual-size');
  } else if (modifier && event.shiftKey && key === 'd') {
    event.preventDefault();
    elements.themeButton.click();
  } else if (event.key === 'F11') {
    event.preventDefault();
    window.nviewer.toggleFullscreen();
  }
});

for (const scrollElement of [elements.richView, elements.textView, elements.pdfView]) {
  scrollElement.addEventListener('wheel', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    if (event.deltaY < 0) currentZoomIn();
    else currentZoomOut();
  }, { passive: false });
}

window.nviewer.onDocumentOpened(displayDocument);
window.nviewer.onDocumentClosed(showHome);
window.nviewer.onDocumentSaved((payload) => {
  if (!state.document || payload?.token !== state.document.token) return;
  state.dirty = false;
  state.document = { ...state.document, ...payload };
  if (isText()) {
    state.savedText = state.draftText;
    renderTextReader();
  }
  updateControls();
});
window.nviewer.onDocumentCommand(executeDocumentCommand);
window.nviewer.onCollectEditState(({ requestId }) => {
  window.nviewer.replyEditState(requestId, {
    token: state.document?.token ?? null,
    type: state.document?.type ?? null,
    editMode: state.editMode,
    dirty: state.dirty,
    payload: isEditable() ? collectDocumentPayload() : null
  });
});
window.nviewer.onHistoryChanged(renderRecentDocuments);
window.nviewer.onViewCommand(executeViewCommand);
window.nviewer.onThemeChanged(applyTheme);
window.nviewer.onPdfFilterChanged(applyPdfFilter);
window.nviewer.onToast((payload) => showToast(payload?.message ?? 'Done.'));
window.nviewer.onExportPrepare(async ({ requestId }) => {
  state.exportRestoreEditMode = state.editMode;
  closeDocumentMenu();
  if (isRichDocument()) richEditor.setEditable(false);
  document.documentElement.dataset.theme = 'light';
  document.documentElement.dataset.pdfFilter = 'original';
  elements.app.classList.add('print-export');
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.nviewer.exportReady(requestId);
});
window.nviewer.onExportFinish(() => {
  elements.app.classList.remove('print-export');
  applyTheme(state.theme);
  applyPdfFilter(state.pdfFilter);
  if (isRichDocument() && state.exportRestoreEditMode) richEditor.setEditable(true);
  state.exportRestoreEditMode = false;
});

const initial = await window.nviewer.getInitialState();
state.theme = initial.preferences.theme;
state.pdfFilter = initial.preferences.pdfFilter;
state.pdfScaleMode = initial.preferences.pdfScaleMode;
state.recentDocuments = initial.recentDocuments ?? [];
applyTheme(state.theme);
applyPdfFilter(state.pdfFilter);
renderRecentDocuments(state.recentDocuments);
if (initial.document) await displayDocument(initial.document);
else await showHome();




// --- Continuous Touchscreen Pinch-to-Zoom ---
let pinchStartDistance = 0;
let pinchStartScale = 1.0;
let currentPinchScale = 1.0;

elements.pdfView.addEventListener('touchstart', (event) => {
  if (event.touches.length === 2) {
    pinchStartDistance = Math.hypot(
      event.touches[0].pageX - event.touches[1].pageX,
      event.touches[0].pageY - event.touches[1].pageY
    );
    pinchStartScale = activePdfZoom; 
    
    const rect = elements.pdfPages.getBoundingClientRect();
    const centerX = ((event.touches[0].pageX + event.touches[1].pageX) / 2) - rect.left;
    const centerY = ((event.touches[0].pageY + event.touches[1].pageY) / 2) - rect.top;
    
    elements.pdfPages.style.transformOrigin = `${centerX}px ${centerY}px`;
    elements.pdfPages.style.transition = 'none'; 
  }
}, { passive: false });

elements.pdfView.addEventListener('touchmove', (event) => {
  if (event.touches.length === 2 && pinchStartDistance > 0) {
    event.preventDefault(); 
    
    const currentDistance = Math.hypot(
      event.touches[0].pageX - event.touches[1].pageX,
      event.touches[0].pageY - event.touches[1].pageY
    );

    currentPinchScale = currentDistance / pinchStartDistance;
    elements.pdfPages.style.transform = `scale(${currentPinchScale})`;
  }
}, { passive: false });

let lastTapTime = 0;

elements.pdfView.addEventListener('touchend', (event) => {
  // 1. Handle the end of a pinch-to-zoom
  if (event.touches.length < 2 && pinchStartDistance > 0) {
    const finalZoom = pinchStartScale * currentPinchScale;
    elements.pdfPages.style.transform = '';
    pinchStartDistance = 0;
    pdfViewer.setZoom(finalZoom);
    return; // Exit early so it doesn't count as a tap
  }

  // 2. Handle Double-Tap to Zoom
  if (event.touches.length === 0 && pinchStartDistance === 0) {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTapTime;
    
    // If the tap is within 300ms, it's a double tap
    if (tapLength < 300 && tapLength > 0) {
      event.preventDefault();
      
      // If already zoomed in, reset. Otherwise, zoom in 2x.
      if (activePdfZoom > 1.2) {
        state.pdfScaleMode = 'fit-width';
        pdfViewer.setScaleMode('fit-width');
      } else {
        pdfViewer.setZoom(activePdfZoom * 2);
      }
    }
    lastTapTime = currentTime;
  }
});