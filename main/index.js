const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  shell
} = require('electron');

// Prevent GPU/cache startup problems on affected Windows systems.
app.disableHardwareAcceleration();

// CRITICAL FIX: Single Instance Lock
// We must exit the process immediately so the second instance doesn't try to 
// register protocols or IPC handlers, which causes silent crashes and phantom processes.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0); // Guarantees execution stops here for the duplicate instance
}

process.on('uncaughtException', (error) => {
  console.error('[N Viewer] Uncaught exception:', error);
  try {
    dialog.showErrorBox(
      'N Viewer startup error',
      error?.stack || String(error)
    );
  } catch {}
  app.exit(1); // Force process to die instead of becoming a zombie
});

process.on('unhandledRejection', (reason) => {
  console.error('[N Viewer] Unhandled rejection:', reason);
  try {
    dialog.showErrorBox(
      'N Viewer startup error',
      reason?.stack || String(reason)
    );
  } catch {}
  app.exit(1); // Force process to die instead of becoming a zombie
});

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { Readable } = require('node:stream');
const { DocumentService, DOCUMENT_EXTENSIONS } = require('./document-service');
const { HistoryStore } = require('./history-store');
const { SettingsStore } = require('./settings');
const { assertTrustedSender, validateExternalUrl } = require('./security');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'nviewer',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

let mainWindow = null;
let settings = null;
let history = null;
let rendererReady = false;
let pendingOpenPath = null;
let printRequest = null;
let editStateRequest = null;
let allowWindowClose = false;
let rendererEditState = {
  token: null,
  type: null,
  editMode: false,
  dirty: false
};

const documents = new DocumentService();
const EDITABLE_TYPES = new Set(['markdown', 'docx', 'text']);
const PDF_EXPORT_TYPES = new Set(['markdown', 'docx']);

function getDocumentPathFromArguments(argv) {
  return argv.find((value, index) => {
    if (index === 0 || value.startsWith('-')) return false;
    return DOCUMENT_EXTENSIONS.has(path.extname(value).toLowerCase());
  }) ?? null;
}

function showError(title, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (mainWindow && !mainWindow.isDestroyed()) {
    void dialog.showMessageBox(mainWindow, { type: 'error', title, message });
  } else {
    dialog.showErrorBox(title, message);
  }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function resetRendererEditState() {
  const current = documents.getCurrent();
  rendererEditState = {
    token: current?.token ?? null,
    type: current?.type ?? null,
    editMode: false,
    dirty: false
  };
}

function normalizeEditState(value, includePayload = false) {
  const current = documents.getCurrent();
  const normalized = {
    token: typeof value?.token === 'string' ? value.token : null,
    type: current?.type ?? null,
    editMode: value?.editMode === true,
    dirty: value?.dirty === true
  };
  if (includePayload) normalized.payload = value?.payload && typeof value.payload === 'object' ? value.payload : null;
  return normalized;
}

function applyTheme(theme) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  settings.set('theme', normalized);
  nativeTheme.themeSource = normalized;
  send('preferences:theme-changed', normalized);
  buildMenu();
  return normalized;
}

function applyPdfFilter(filter) {
  const normalized = ['original', 'dim', 'invert'].includes(filter) ? filter : 'invert';
  settings.set('pdfFilter', normalized);
  send('preferences:pdf-filter-changed', normalized);
  buildMenu();
  return normalized;
}

function setPdfScaleMode(mode) {
  const normalized = ['fit-width', 'fit-page', 'actual-size'].includes(mode) ? mode : 'fit-width';
  settings.set('pdfScaleMode', normalized);
  send('view:command', { command: normalized });
  buildMenu();
  return normalized;
}

function buildMenu() {
  if (!mainWindow || !settings) return;
  const state = settings.snapshot();
  const current = documents.getCurrent();
  const editable = EDITABLE_TYPES.has(current?.type);
  const canSave = editable && rendererEditState.editMode && rendererEditState.dirty;
  const canExportPdf = PDF_EXPORT_TYPES.has(current?.type);
  const canExportDocx = current?.type === 'markdown';

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => openDialogAndPresent() },
        { label: 'New File…', accelerator: 'CmdOrCtrl+N', click: () => createFileAndPresent() },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          enabled: canSave,
          click: () => send('document:command', { command: 'save' })
        },
        {
          label: 'Save as Copy…',
          accelerator: 'CmdOrCtrl+Shift+S',
          enabled: canSave,
          visible: current?.type !== 'pdf',
          click: () => send('document:command', { command: 'save-copy' })
        },
        {
          label: 'Save as PDF…',
          enabled: canExportPdf,
          visible: canExportPdf,
          click: () => send('document:command', { command: 'save-pdf' })
        },
        {
          label: 'Save as DOCX…',
          enabled: canExportDocx,
          visible: canExportDocx,
          click: () => send('document:command', { command: 'save-docx' })
        },
        {
          label: 'Close File',
          enabled: Boolean(current),
          click: () => send('document:command', { command: 'close' })
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: rendererEditState.editMode ? 'Done Editing' : 'Edit Document',
          accelerator: 'CmdOrCtrl+E',
          enabled: editable,
          click: () => send('document:command', { command: 'edit' })
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Dark Reading Mode',
          type: 'checkbox',
          checked: state.theme === 'dark',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: (item) => applyTheme(item.checked ? 'dark' : 'light')
        },
        {
          label: 'PDF Page Appearance',
          submenu: [
            { label: 'Original', type: 'radio', checked: state.pdfFilter === 'original', click: () => applyPdfFilter('original') },
            { label: 'Dim', type: 'radio', checked: state.pdfFilter === 'dim', click: () => applyPdfFilter('dim') },
            { label: 'Night Invert', type: 'radio', checked: state.pdfFilter === 'invert', click: () => applyPdfFilter('invert') }
          ]
        },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => send('view:command', { command: 'zoom-in' }) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => send('view:command', { command: 'zoom-out' }) },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => send('view:command', { command: 'zoom-reset' }) },
        { label: 'Fit Width', accelerator: 'CmdOrCtrl+1', type: 'radio', checked: state.pdfScaleMode === 'fit-width', click: () => setPdfScaleMode('fit-width') },
        { label: 'Fit Page', accelerator: 'CmdOrCtrl+2', type: 'radio', checked: state.pdfScaleMode === 'fit-page', click: () => setPdfScaleMode('fit-page') },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+3', type: 'radio', checked: state.pdfScaleMode === 'actual-size', click: () => setPdfScaleMode('actual-size') },
        { type: 'separator' },
        { label: 'Toggle Full Screen', accelerator: 'F11', click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen()) }
      ]
    },
    {
      label: 'Window',
      submenu: process.platform === 'darwin'
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'close' }]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'N Viewer Shortcuts',
            message: 'Open: Ctrl+O\nNew file: Ctrl+N\nEdit / Done: Ctrl+E\nSave: Ctrl+S\nSave Copy: Ctrl+Shift+S\nDark mode: Ctrl+Shift+D\nZoom: Ctrl + / -\nReset: Ctrl+0\nFit width: Ctrl+1\nFit page: Ctrl+2\nActual size: Ctrl+3\nFullscreen: F11'
          })
        },
        {
          label: 'About N Viewer',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'About N Viewer',
            message: `N Viewer ${app.getVersion()}`,
            detail: 'A private, distraction-free reader and lightweight editor for Markdown, PDF, DOCX, and TXT.'
          })
        }
      ]
    }
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function configureWindowSecurity(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const safeUrl = validateExternalUrl(url);
    if (safeUrl) shell.openExternal(safeUrl).catch(() => {});
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

function collectRendererEditState() {
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ ...rendererEditState, payload: null });
  }
  if (editStateRequest) return editStateRequest.promise;

  const requestId = crypto.randomUUID();
  let resolveRequest;
  const promise = new Promise((resolve) => { resolveRequest = resolve; });
  const timeout = setTimeout(() => {
    if (editStateRequest?.requestId !== requestId) return;
    editStateRequest = null;
    resolveRequest({ ...rendererEditState, payload: null });
  }, 3500);

  editStateRequest = { requestId, resolve: resolveRequest, timeout, promise };
  send('document:collect-edit-state', { requestId });
  return promise;
}

async function saveCollectedState(editState, { notify = true } = {}) {
  const current = documents.getCurrent();
  if (!current || editState?.token !== current.token || !editState?.payload) {
    throw new Error('N Viewer could not collect the current edited document.');
  }
  const saved = await documents.save(editState.token, editState.payload);
  rendererEditState = { ...rendererEditState, dirty: false };
  if (notify) {
    send('document:saved', saved);
    send('app:toast', { message: `${saved.name} saved.` });
  }
  buildMenu();
  return saved;
}

async function confirmUnsavedChanges() {
  const current = documents.getCurrent();
  if (!current || !EDITABLE_TYPES.has(current.type)) return true;

  const editState = await collectRendererEditState();
  if (editState.token !== current.token || !editState.dirty) return true;

  const canSave = Boolean(editState.payload);
  const buttons = canSave ? ['Save', "Don't Save", 'Cancel'] : ["Don't Save", 'Cancel'];
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Unsaved changes',
    message: `Save changes to “${current.name}”?`,
    detail: canSave
      ? 'Your changes will be lost if you continue without saving.'
      : 'N Viewer could not collect the edited document. Cancel is recommended.',
    buttons,
    defaultId: canSave ? 0 : 1,
    cancelId: canSave ? 2 : 1,
    noLink: true
  });

  if ((canSave && response.response === 2) || (!canSave && response.response === 1)) return false;
  if (canSave && response.response === 0) {
    try {
      await saveCollectedState(editState);
    } catch (error) {
      showError('Unable to save document', error);
      return false;
    }
  }
  return true;
}

async function createWindow() {
  console.log('[N Viewer] Creating main window.');

  const savedBounds = settings.get('windowBounds') || {};

  const safeWidth =
    Number.isFinite(savedBounds.width) &&
    savedBounds.width >= 720 &&
    savedBounds.width <= 5000
      ? savedBounds.width
      : 1200;

  const safeHeight =
    Number.isFinite(savedBounds.height) &&
    savedBounds.height >= 520 &&
    savedBounds.height <= 3000
      ? savedBounds.height
      : 820;

  mainWindow = new BrowserWindow({
    width: safeWidth,
    height: safeHeight,
    minWidth: 720,
    minHeight: 520,
    show: true,
    center: true,
    autoHideMenuBar: true,
    backgroundColor:
      settings.get('theme') === 'dark'
        ? '#15171b'
        : '#f4f3ef',

    icon: path.join(
      __dirname,
      '..',
      'assets',
      'n-viewer.ico'
    ),

    webPreferences: {
      preload: path.join(
        __dirname,
        '..',
        'preload',
        'index.js'
      ),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  });

  console.log('[N Viewer] BrowserWindow created.');

  configureWindowSecurity(mainWindow);
  buildMenu();

  mainWindow.webContents.on(
    'did-fail-load',
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    ) => {
      if (!isMainFrame) return;

      console.error('[N Viewer] Renderer failed to load:', {
        errorCode,
        errorDescription,
        validatedURL
      });

      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        !mainWindow.isVisible()
      ) {
        mainWindow.show();
      }

      dialog.showErrorBox(
        'N Viewer failed to load',
        [
          `Error code: ${errorCode}`,
          `Description: ${errorDescription}`,
          `Location: ${validatedURL || 'local application page'}`
        ].join('\n')
      );
    }
  );

  mainWindow.webContents.on(
    'render-process-gone',
    (_event, details) => {
      console.error(
        '[N Viewer] Renderer process stopped:',
        details
      );

      dialog.showErrorBox(
        'N Viewer renderer stopped',
        [
          `Reason: ${details.reason}`,
          `Exit code: ${details.exitCode}`
        ].join('\n')
      );
    }
  );

  mainWindow.on('unresponsive', () => {
    console.error('[N Viewer] Main window is unresponsive.');
  });

  const devUrl = process.env.NVIEWER_DEV_URL;

  try {
    if (devUrl) {
      console.log(`[N Viewer] Loading ${devUrl}`);
      await mainWindow.loadURL(devUrl);
    } else {
      const rendererPath = path.join(
        __dirname,
        '..',
        'renderer-dist',
        'index.html'
      );

      console.log(
        `[N Viewer] Loading packaged renderer: ${rendererPath}`
      );

      await mainWindow.loadFile(rendererPath);
    }

    console.log('[N Viewer] Renderer loaded successfully.');
  } catch (error) {
    console.error(
      '[N Viewer] Failed while loading renderer:',
      error
    );

    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.isVisible()
    ) {
      mainWindow.show();
    }

    dialog.showErrorBox(
      'N Viewer startup failed',
      error?.stack || String(error)
    );

    throw error;
  }

  if (settings.get('maximized')) {
    mainWindow.maximize();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();

  mainWindow.on('close', (event) => {
    // 1. Intercept the close event to check for unsaved changes
    if (!allowWindowClose) {
      event.preventDefault(); // Must be synchronous to stop the window from destroying itself

      confirmUnsavedChanges().then((canClose) => {
        if (canClose) {
          allowWindowClose = true; // Unlock the window
          mainWindow.close();      // Re-trigger the close event
        }
      }).catch((err) => console.error('Error during close check:', err));
      
      return;
    }

    // 2. Save window dimensions and state for the next launch
    if (!mainWindow || mainWindow.isDestroyed()) return;

    settings.set(
      'maximized',
      mainWindow.isMaximized()
    );

    if (
      !mainWindow.isMaximized() &&
      !mainWindow.isFullScreen()
    ) {
      settings.set(
        'windowBounds',
        mainWindow.getBounds()
      );
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });
}

async function recentDocuments() {
  return history ? history.list() : [];
}

async function presentDocument(payload, broadcast) {
  if (!payload || !mainWindow || mainWindow.isDestroyed()) return payload;
  const current = documents.getCurrent();
  const resumePage = current?.type === 'pdf' ? history.getPdfPage(current.path) : 1;
  history.touch({
    filePath: current.path,
    name: current.name,
    type: current.type,
    lastPage: resumePage
  });
  const enriched = current.type === 'pdf' ? { ...payload, resumePage } : payload;
  mainWindow.setTitle(`${payload.name} — N Viewer`);
  mainWindow.setRepresentedFilename?.(current.path);
  resetRendererEditState();
  if (broadcast) send('document:opened', enriched);
  send('history:changed', await recentDocuments());
  buildMenu();
  return enriched;
}

async function openDocumentAndPresent(filePath, broadcast = true) {
  if (!(await confirmUnsavedChanges())) return null;
  try {
    const payload = await documents.open(filePath);
    return presentDocument(payload, broadcast);
  } catch (error) {
    showError('Unable to open document', error);
    return null;
  }
}

async function openDialogAndPresent(broadcast = true) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a document',
    properties: ['openFile'],
    filters: [
      { name: 'Supported documents', extensions: ['md', 'markdown', 'pdf', 'docx', 'txt'] },
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Word document', extensions: ['docx'] },
      { name: 'Plain text', extensions: ['txt'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return openDocumentAndPresent(result.filePaths[0], broadcast);
}

async function chooseNewFileType() {
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'New file',
    message: 'Choose the file type to create.',
    buttons: ['Markdown (.md)', 'Word document (.docx)', 'Plain text (.txt)', 'Cancel'],
    defaultId: 0,
    cancelId: 3,
    noLink: true
  });
  return ['markdown', 'docx', 'text'][response.response] ?? null;
}

async function createFileAndPresent(broadcast = true) {
  const type = await chooseNewFileType();
  if (!type) return null;
  const definitions = {
    markdown: { title: 'Create a new Markdown file', name: 'Untitled.md', filter: { name: 'Markdown document', extensions: ['md', 'markdown'] } },
    docx: { title: 'Create a new Word document', name: 'Untitled.docx', filter: { name: 'Word document', extensions: ['docx'] } },
    text: { title: 'Create a new text file', name: 'Untitled.txt', filter: { name: 'Plain text', extensions: ['txt'] } }
  };
  const definition = definitions[type];
  const result = await dialog.showSaveDialog(mainWindow, {
    title: definition.title,
    defaultPath: path.join(app.getPath('documents'), definition.name),
    filters: [definition.filter]
  });
  if (result.canceled || !result.filePath) return null;
  if (!(await confirmUnsavedChanges())) return null;

  try {
    const payload = { ...(await documents.create(type, result.filePath)), openInEditMode: true };
    return await presentDocument(payload, broadcast);
  } catch (error) {
    showError('Unable to create file', error);
    return null;
  }
}

async function saveCurrent(payload) {
  try {
    const saved = await documents.save(payload?.token, payload?.payload);
    rendererEditState = { ...rendererEditState, dirty: false };
    send('document:saved', saved);
    send('app:toast', { message: `${saved.name} saved.` });
    buildMenu();
    return { ok: true, document: saved };
  } catch (error) {
    showError('Unable to save document', error);
    return { ok: false, error: error.message };
  }
}

async function saveCurrentCopy(payload) {
  const current = documents.getCurrent();
  if (!current || !EDITABLE_TYPES.has(current.type)) return { ok: false };
  const extension = path.extname(current.name);
  const baseName = path.basename(current.name, extension);
  const filters = {
    markdown: { name: 'Markdown document', extensions: ['md', 'markdown'] },
    docx: { name: 'Word document', extensions: ['docx'] },
    text: { name: 'Plain text', extensions: ['txt'] }
  };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `Save ${current.name} as a copy`,
    defaultPath: path.join(current.directory, `${baseName}-copy${extension}`),
    filters: [filters[current.type]]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  try {
    const copy = await documents.saveCopy(payload?.token, payload?.payload, result.filePath);
    send('app:toast', { message: `Copy saved as ${copy.name}.` });
    return copy;
  } catch (error) {
    showError('Unable to save a copy', error);
    return { ok: false, error: error.message };
  }
}

async function waitForPrintReady() {
  if (printRequest) throw new Error('A document export is already in progress.');
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      printRequest = null;
      reject(new Error('The document did not become ready for export.'));
    }, 7000);
    printRequest = { requestId, resolve, reject, timeout };
    send('export:prepare', { requestId });
  });
}

async function exportCurrentAsPdf(token) {
  const current = documents.getCurrent();
  if (!current || !PDF_EXPORT_TYPES.has(current.type) || current.token !== token) {
    showError('Unable to export PDF', new Error('Open a Markdown or DOCX file first.'));
    return { ok: false };
  }
  const baseName = path.basename(current.name, path.extname(current.name));
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `Save ${current.name} as PDF`,
    defaultPath: path.join(current.directory, `${baseName}.pdf`),
    filters: [{ name: 'PDF document', extensions: ['pdf'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  try {
    await waitForPrintReady();
    try {
      const pdfBuffer = await mainWindow.webContents.printToPDF({
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
        pageSize: 'A4'
      });
      await fs.promises.writeFile(result.filePath, pdfBuffer);
    } finally {
      send('export:finish', {});
    }
    send('app:toast', { message: 'Document exported as PDF.' });
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    send('export:finish', {});
    showError('Unable to export PDF', error);
    return { ok: false, error: error.message };
  }
}

async function exportMarkdownAsDocx(payload) {
  const current = documents.getCurrent();
  if (!current || current.type !== 'markdown' || current.token !== payload?.token) return { ok: false };
  const baseName = path.basename(current.name, path.extname(current.name));
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Markdown as DOCX',
    defaultPath: path.join(current.directory, `${baseName}.docx`),
    filters: [{ name: 'Word document', extensions: ['docx'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    const exported = await documents.exportDocx(payload.token, payload.html, result.filePath);
    send('app:toast', { message: 'Markdown exported as DOCX.' });
    return exported;
  } catch (error) {
    showError('Unable to export DOCX', error);
    return { ok: false, error: error.message };
  }
}

async function insertImage(token) {
  const current = documents.getCurrent();
  if (!current || current.token !== token || !['markdown', 'docx'].includes(current.type)) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Insert an image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  try {
    return await documents.importImage(token, result.filePaths[0]);
  } catch (error) {
    showError('Unable to insert image', error);
    return null;
  }
}

async function closeCurrentDocument() {
  if (!documents.getCurrent()) return true;
  if (!(await confirmUnsavedChanges())) return false;
  documents.close();
  resetRendererEditState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle('N Viewer');
    mainWindow.setRepresentedFilename?.('');
  }
  send('document:closed', {});
  send('history:changed', await recentDocuments());
  buildMenu();
  return true;
}

async function serveFileRequest(request, filePath, mimeType) {
  const stats = await fs.promises.stat(filePath);
  const range = request.headers.get('range');
  const baseHeaders = {
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': mimeType ?? 'application/octet-stream'
  };
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
    if (match) {
      const start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : stats.size - 1;
      const end = Math.min(requestedEnd, stats.size - 1);
      if (start <= end && start < stats.size) {
        return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${stats.size}`
          }
        });
      }
    }
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(stats.size) }
  });
}

async function registerDocumentProtocol() {
  protocol.handle('nviewer', async (request) => {
    try {
      const url = new URL(request.url);
      const current = documents.getCurrent();
      if (url.hostname === 'app-icon' && url.pathname === '/n-viewer.ico') {
        return serveFileRequest(request, path.join(__dirname, '..', 'assets', 'n-viewer.ico'), 'image/x-icon');
      }
      if (url.hostname === 'document') {
        const token = url.pathname.split('/').filter(Boolean)[0];
        if (!current || current.type !== 'pdf' || token !== current.token) return new Response('Not found', { status: 404 });
        return serveFileRequest(request, current.path, 'application/pdf');
      }
      if (url.hostname === 'asset') {
        const segments = url.pathname.split('/').filter(Boolean);
        const token = segments.shift();
        const asset = await documents.resolveAsset(token, segments.join('/'));
        if (!asset) return new Response('Not found', { status: 404 });
        return serveFileRequest(request, asset.path, asset.mimeType);
      }
      return new Response('Not found', { status: 404 });
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}

function registerIpc() {
  ipcMain.handle('app:get-initial-state', async (event) => {
    assertTrustedSender(event, mainWindow);
    rendererReady = true;

    let initialDocument = null;
    
    // CRITICAL FIX: If a file was double-clicked, await its opening synchronously
    // before returning the state. Passing `false` prevents the race condition 
    // where it broadcasts the event too early.
    if (pendingOpenPath) {
      const pathToOpen = pendingOpenPath;
      pendingOpenPath = null;
      initialDocument = await openDocumentAndPresent(pathToOpen, false);
    }

    return {
      preferences: settings.snapshot(),
      document: initialDocument || (documents.getCurrent() ? documents.toRendererPayload(documents.getCurrent()) : null),
      recentDocuments: await recentDocuments()
    };
  });

  ipcMain.handle('history:get-recent', async (event) => {
    assertTrustedSender(event, mainWindow);
    return recentDocuments();
  });
  ipcMain.handle('history:open-recent', (event, filePath) => {
    assertTrustedSender(event, mainWindow);
    return openDocumentAndPresent(filePath, false);
  });
  ipcMain.on('history:update-pdf-page', (event, payload) => {
    try {
      assertTrustedSender(event, mainWindow);
      const current = documents.getCurrent();
      if (!current || current.type !== 'pdf' || current.token !== payload?.token) return;
      history.updatePdfPage(current.path, payload?.page);
    } catch {}
  });

  ipcMain.handle('document:open-dialog', (event) => {
    assertTrustedSender(event, mainWindow);
    return openDialogAndPresent(false);
  });
  ipcMain.handle('document:open-path', (event, filePath) => {
    assertTrustedSender(event, mainWindow);
    return openDocumentAndPresent(filePath, false);
  });
  ipcMain.handle('document:open-relative', async (event, payload) => {
    assertTrustedSender(event, mainWindow);
    try {
      const filePath = await documents.resolveRelativeDocument(payload?.token, payload?.relativePath);
      return await openDocumentAndPresent(filePath, false);
    } catch (error) {
      showError('Unable to open linked document', error);
      return null;
    }
  });
  ipcMain.handle('document:new-file', (event) => {
    assertTrustedSender(event, mainWindow);
    return createFileAndPresent(false);
  });
  ipcMain.handle('document:save', (event, payload) => {
    assertTrustedSender(event, mainWindow);
    return saveCurrent(payload);
  });
  ipcMain.handle('document:save-copy', (event, payload) => {
    assertTrustedSender(event, mainWindow);
    return saveCurrentCopy(payload);
  });
  ipcMain.handle('document:export-pdf', (event, token) => {
    assertTrustedSender(event, mainWindow);
    return exportCurrentAsPdf(token);
  });
  ipcMain.handle('document:export-docx', (event, payload) => {
    assertTrustedSender(event, mainWindow);
    return exportMarkdownAsDocx(payload);
  });
  ipcMain.handle('document:insert-image', (event, token) => {
    assertTrustedSender(event, mainWindow);
    return insertImage(token);
  });
  ipcMain.handle('document:close', (event) => {
    assertTrustedSender(event, mainWindow);
    return closeCurrentDocument();
  });

  ipcMain.on('document:edit-state-changed', (event, payload) => {
    try {
      assertTrustedSender(event, mainWindow);
      const next = normalizeEditState(payload);
      const changed = next.token !== rendererEditState.token
        || next.type !== rendererEditState.type
        || next.editMode !== rendererEditState.editMode
        || next.dirty !== rendererEditState.dirty;
      rendererEditState = next;
      if (changed) buildMenu();
    } catch {}
  });
  ipcMain.on('document:edit-state-response', (event, payload) => {
    try {
      assertTrustedSender(event, mainWindow);
      if (!editStateRequest || payload?.requestId !== editStateRequest.requestId) return;
      clearTimeout(editStateRequest.timeout);
      const { resolve } = editStateRequest;
      editStateRequest = null;
      const state = normalizeEditState(payload?.state, true);
      rendererEditState = {
        token: state.token,
        type: state.type,
        editMode: state.editMode,
        dirty: state.dirty
      };
      resolve(state);
    } catch {}
  });

  ipcMain.handle('app:open-external', async (event, value) => {
    assertTrustedSender(event, mainWindow);
    const url = validateExternalUrl(value);
    if (!url) throw new Error('This link type is not allowed.');
    const response = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Open external link?',
      message: 'This link will open in your default browser.',
      detail: url,
      buttons: ['Open', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (response.response === 0) await shell.openExternal(url);
    return response.response === 0;
  });
  ipcMain.handle('preferences:set-theme', (event, theme) => {
    assertTrustedSender(event, mainWindow);
    return applyTheme(theme);
  });
  ipcMain.handle('preferences:set-pdf-filter', (event, filter) => {
    assertTrustedSender(event, mainWindow);
    return applyPdfFilter(filter);
  });
  ipcMain.handle('preferences:set-pdf-scale-mode', (event, mode) => {
    assertTrustedSender(event, mainWindow);
    return setPdfScaleMode(mode);
  });
  ipcMain.handle('window:toggle-fullscreen', (event) => {
    assertTrustedSender(event, mainWindow);
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });
  ipcMain.on('export:ready', (event, requestId) => {
    try {
      assertTrustedSender(event, mainWindow);
      if (printRequest?.requestId === requestId) {
        clearTimeout(printRequest.timeout);
        const { resolve } = printRequest;
        printRequest = null;
        resolve();
      }
    } catch {}
  });
}

app.on('second-instance', (_event, argv) => {
  const filePath = getDocumentPathFromArguments(argv);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  if (filePath) {
    if (rendererReady) void openDocumentAndPresent(filePath);
    else pendingOpenPath = filePath;
  }
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (rendererReady) void openDocumentAndPresent(filePath);
  else pendingOpenPath = filePath;
});

app.whenReady().then(async () => {
  settings = new SettingsStore(app.getPath('userData'));
  history = new HistoryStore(app.getPath('userData'));
  nativeTheme.themeSource = settings.get('theme');
  pendingOpenPath = pendingOpenPath ?? getDocumentPathFromArguments(process.argv);
  registerIpc();
  await registerDocumentProtocol();
  await createWindow();
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});