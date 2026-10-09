const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu
} = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DOCUMENT_EXTENSIONS } = require('./document-service');

const CHILD_WINDOW_FLAG = '--gabatee-window';
const isChildWindowProcess = process.argv.includes(CHILD_WINDOW_FLAG);

app.setName('Gabatee');

function replaceBrand(value) {
  return typeof value === 'string' ? value.replaceAll('N Viewer', 'Gabatee') : value;
}

function rebrandDialogOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = { ...value };
  for (const key of ['title', 'message', 'detail']) {
    if (typeof next[key] === 'string') next[key] = replaceBrand(next[key]);
  }
  if (Array.isArray(next.buttons)) next.buttons = next.buttons.map(replaceBrand);
  return next;
}

const originalShowMessageBox = dialog.showMessageBox.bind(dialog);
dialog.showMessageBox = (...args) => originalShowMessageBox(...args.map((value) => {
  if (value instanceof BrowserWindow) return value;
  return rebrandDialogOptions(value);
}));

const originalShowErrorBox = dialog.showErrorBox.bind(dialog);
dialog.showErrorBox = (title, content) => originalShowErrorBox(replaceBrand(title), replaceBrand(content));

function rebrandMenuItems(items) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const next = { ...item };
    if (typeof next.label === 'string') next.label = replaceBrand(next.label);
    if (Array.isArray(next.submenu)) next.submenu = rebrandMenuItems(next.submenu);
    if (['Zoom In', 'Zoom Out', 'Reset Zoom'].includes(next.label) && typeof next.click === 'function') {
      const originalClick = next.click;
      next.click = (...args) => {
        const window = BrowserWindow.getFocusedWindow();
        if (window && !window.isDestroyed()) {
          void window.webContents.executeJavaScript('window.__gabateeCapturePdfCenter?.()', true).catch(() => {});
        }
        return originalClick(...args);
      };
    }
    return next;
  });
}

const originalBuildFromTemplate = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = (template) => originalBuildFromTemplate(rebrandMenuItems(template));

function getDocumentPathFromArguments(argv) {
  return argv.find((value, index) => {
    if (index === 0 || typeof value !== 'string' || value.startsWith('-')) return false;
    return DOCUMENT_EXTENSIONS.has(path.extname(value).toLowerCase());
  }) ?? null;
}

function launchDocumentWindow(filePath) {
  if (!filePath) return false;
  const args = app.isPackaged
    ? [CHILD_WINDOW_FLAG, filePath]
    : [app.getAppPath(), CHILD_WINDOW_FLAG, filePath];

  try {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return true;
  } catch (error) {
    dialog.showErrorBox('Unable to open a new Gabatee window', error?.stack || String(error));
    return false;
  }
}

function isDocumentWindowOccupied(window) {
  if (!window || window.isDestroyed()) return false;
  return window.getTitle().includes(' — ');
}

if (isChildWindowProcess) {
  app.requestSingleInstanceLock = () => true;
}

const originalAppOn = app.on.bind(app);
let secondInstanceHandlerInstalled = false;
app.on = (eventName, listener) => {
  if (eventName === 'second-instance') {
    if (!isChildWindowProcess && !secondInstanceHandlerInstalled) {
      secondInstanceHandlerInstalled = true;
      originalAppOn('second-instance', (_event, argv) => {
        const filePath = getDocumentPathFromArguments(argv);
        if (filePath) {
          launchDocumentWindow(filePath);
          return;
        }
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) return;
        if (window.isMinimized()) window.restore();
        window.focus();
      });
    }
    return app;
  }
  return originalAppOn(eventName, listener);
};

const originalShowOpenDialog = dialog.showOpenDialog.bind(dialog);
dialog.showOpenDialog = async (...args) => {
  const window = args[0] instanceof BrowserWindow ? args[0] : null;
  const optionsIndex = window ? 1 : 0;
  const options = args[optionsIndex] ?? {};
  const result = await originalShowOpenDialog(...args);

  if (
    options?.title === 'Open a document' &&
    !result.canceled &&
    result.filePaths?.length &&
    isDocumentWindowOccupied(window)
  ) {
    launchDocumentWindow(result.filePaths[0]);
    return { canceled: true, filePaths: [] };
  }

  return result;
};

const originalIpcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
  if (channel === 'document:open-path' || channel === 'history:open-recent') {
    return originalIpcHandle(channel, async (event, filePath) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (filePath && isDocumentWindowOccupied(window)) {
        launchDocumentWindow(filePath);
        return null;
      }
      return listener(event, filePath);
    });
  }
  return originalIpcHandle(channel, listener);
};

function gabateeRendererPatch() {
  const titleNode = document.querySelector('title');
  const welcomeTitle = document.querySelector('#welcome-title');
  const pdfView = document.querySelector('#pdf-view');

  const applyBranding = () => {
    if (titleNode?.textContent?.includes('N Viewer')) {
      titleNode.textContent = titleNode.textContent.replaceAll('N Viewer', 'Gabatee');
    }
    if (welcomeTitle) welcomeTitle.textContent = 'Gabatee';
  };

  applyBranding();
  if (titleNode) {
    new MutationObserver(applyBranding).observe(titleNode, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  const readingStyle = document.createElement('style');
  readingStyle.textContent = [
    '.rich-view:not(.is-editing) .rich-document {',
    '  width: 100% !important;',
    '  max-width: none !important;',
    '  margin: 0 !important;',
    '  padding: 64px 28px 112px !important;',
    '}',
    '@media (max-width: 720px) {',
    '  .rich-view:not(.is-editing) .rich-document {',
    '    padding-left: 18px !important;',
    '    padding-right: 18px !important;',
    '  }',
    '}'
  ].join('\n');
  document.head.append(readingStyle);

  let pendingPdfAnchor = null;
  let restoreFrame = 0;

  const capturePdfCenter = () => {
    if (!pdfView || pdfView.hidden || pdfView.clientWidth <= 0 || pdfView.clientHeight <= 0) return;
    pendingPdfAnchor = {
      xRatio: (pdfView.scrollLeft + pdfView.clientWidth / 2) / Math.max(1, pdfView.scrollWidth),
      yRatio: (pdfView.scrollTop + pdfView.clientHeight / 2) / Math.max(1, pdfView.scrollHeight)
    };

    cancelAnimationFrame(restoreFrame);
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = requestAnimationFrame(() => {
        if (!pendingPdfAnchor || !pdfView || pdfView.hidden) return;
        const { xRatio, yRatio } = pendingPdfAnchor;
        pdfView.scrollLeft = Math.max(0, xRatio * pdfView.scrollWidth - pdfView.clientWidth / 2);
        pdfView.scrollTop = Math.max(0, yRatio * pdfView.scrollHeight - pdfView.clientHeight / 2);
        pendingPdfAnchor = null;
      });
    });
  };

  window.__gabateeCapturePdfCenter = capturePdfCenter;
  document.querySelector('#zoom-in')?.addEventListener('click', capturePdfCenter, { capture: true });
  document.querySelector('#zoom-out')?.addEventListener('click', capturePdfCenter, { capture: true });
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (['+', '=', '-', '0'].includes(event.key)) capturePdfCenter();
  }, { capture: true });
}

originalAppOn('browser-window-created', (_event, window) => {
  window.webContents.on('did-finish-load', () => {
    void window.webContents
      .executeJavaScript(`(${gabateeRendererPatch.toString()})()`, true)
      .catch((error) => console.warn('[Gabatee] Unable to install renderer refinements:', error));
  });
});

require('./index.js');
