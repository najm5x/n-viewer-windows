const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('nviewer', Object.freeze({
  getInitialState: () => ipcRenderer.invoke('app:get-initial-state'),
  getRecentDocuments: () => ipcRenderer.invoke('history:get-recent'),
  openRecentDocument: (filePath) => ipcRenderer.invoke('history:open-recent', filePath),
  updatePdfLastPage: (token, page) => ipcRenderer.send('history:update-pdf-page', { token, page }),

  openDialog: () => ipcRenderer.invoke('document:open-dialog'),
  createFile: () => ipcRenderer.invoke('document:new-file'),
  openDroppedFile: (file) => {
    const filePath = webUtils.getPathForFile(file);
    return ipcRenderer.invoke('document:open-path', filePath);
  },
  openRelativeDocument: (token, relativePath) =>
    ipcRenderer.invoke('document:open-relative', { token, relativePath }),
  saveDocument: (token, payload) => ipcRenderer.invoke('document:save', { token, payload }),
  saveDocumentCopy: (token, payload) => ipcRenderer.invoke('document:save-copy', { token, payload }),
  exportDocumentPdf: (token) => ipcRenderer.invoke('document:export-pdf', token),
  exportMarkdownDocx: (token, html) => ipcRenderer.invoke('document:export-docx', { token, html }),
  insertImage: (token) => ipcRenderer.invoke('document:insert-image', token),
  closeDocument: () => ipcRenderer.invoke('document:close'),

  updateEditState: (state) => ipcRenderer.send('document:edit-state-changed', state),
  replyEditState: (requestId, state) =>
    ipcRenderer.send('document:edit-state-response', { requestId, state }),

  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  setTheme: (theme) => ipcRenderer.invoke('preferences:set-theme', theme),
  setPdfFilter: (filter) => ipcRenderer.invoke('preferences:set-pdf-filter', filter),
  setPdfScaleMode: (mode) => ipcRenderer.invoke('preferences:set-pdf-scale-mode', mode),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  exportReady: (requestId) => ipcRenderer.send('export:ready', requestId),

  onDocumentOpened: (callback) => subscribe('document:opened', callback),
  onDocumentClosed: (callback) => subscribe('document:closed', callback),
  onDocumentSaved: (callback) => subscribe('document:saved', callback),
  onDocumentCommand: (callback) => subscribe('document:command', callback),
  onCollectEditState: (callback) => subscribe('document:collect-edit-state', callback),
  onHistoryChanged: (callback) => subscribe('history:changed', callback),
  onViewCommand: (callback) => subscribe('view:command', callback),
  onThemeChanged: (callback) => subscribe('preferences:theme-changed', callback),
  onPdfFilterChanged: (callback) => subscribe('preferences:pdf-filter-changed', callback),
  onExportPrepare: (callback) => subscribe('export:prepare', callback),
  onExportFinish: (callback) => subscribe('export:finish', callback),
  onToast: (callback) => subscribe('app:toast', callback)
}));
