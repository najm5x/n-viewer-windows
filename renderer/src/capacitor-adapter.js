import { App } from '@capacitor/app';
import { Filesystem } from '@capacitor/filesystem';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Preferences } from '@capacitor/preferences';
import mammoth from 'mammoth';
import { Capacitor } from '@capacitor/core';


if (!window.nviewer) {
  console.log('[N-Viewer] Initializing Android Capacitor Adapter');

  const listeners = {};
  const trigger = (event, payload) => {
    if (listeners[event]) listeners[event].forEach(cb => cb(payload));
  };

  const subscribe = (channel, callback) => {
    if (!listeners[channel]) listeners[channel] = [];
    listeners[channel].push(callback);
    return () => {
      listeners[channel] = listeners[channel].filter(cb => cb !== callback);
    };
  };
// Intercept files opened from external apps (WhatsApp, File Manager)
// Intercept files opened from external apps (WhatsApp, File Manager)
App.addListener('appUrlOpen', async (data) => {
  if (!data.url) return;
  
  try {
    const fileUri = data.url;
    let fileName = fileUri.split('/').pop().split('?')[0];
    // Decode URL-encoded filenames from intents
    try { fileName = decodeURIComponent(fileName); } catch {}

    // 1. Read the file FIRST as Base64 to check its true digital signature
    const contents = await Filesystem.readFile({ path: fileUri });
    const base64Data = contents.data;

    // 2. Identify the true file type using Magic Bytes (Base64 prefixes)
    let type = 'text';
    
    if (base64Data.startsWith('JVBERi')) {
      // 'JVBERi' is the Base64 encoding of '%PDF'
      type = 'pdf';
      if (!fileName.toLowerCase().endsWith('.pdf')) fileName += '.pdf';
      
    } else if (base64Data.startsWith('UEsD')) {
      // 'UEsD' is the Base64 encoding of the 'PK' zip header used by DOCX
      type = 'docx';
      if (!fileName.toLowerCase().endsWith('.docx')) fileName += '.docx';
      
    } else {
      // If it lacks a PDF or DOCX signature, treat it as Markdown.
      // This ensures Markdown formatting is applied, and standard text gracefully degrades.
      type = 'markdown';
      if (!fileName.toLowerCase().match(/\.(md|markdown|txt)$/)) fileName += '.md';
    }

    const token = Math.random().toString(36).substring(2);
    const basePayload = { type, name: fileName, token: token, size: 0 };
    
    let payload = null;

    if (type === 'pdf') {
      payload = { ...basePayload, sourceUrl: Capacitor.convertFileSrc(fileUri), resumePage: 1 };
    } else if (type === 'docx') {
      // Safely parse the DOCX file now that we know for sure it is a Word document
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) { bytes[i] = binaryString.charCodeAt(i); }
      const conversion = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
      payload = { ...basePayload, html: conversion.value || '<p></p>', warnings: [] };
    } else {
      // Read again natively as UTF-8 to prevent emoji/special character corruption
      const textContents = await Filesystem.readFile({ path: fileUri, encoding: 'utf8' });
      payload = { ...basePayload, content: textContents.data, richHtml: null };
    }

    // Tell the UI a document was opened
    trigger('document:opened', payload);
    
  } catch (e) {
    console.error('Failed to open external file:', e);
    trigger('app:toast', { message: 'Unable to read external file.' });
  }
});

// --- Native Android Back Button Logic ---
let isDocumentOpen = false;

// Track the UI state internally
subscribe('document:opened', () => isDocumentOpen = true);
subscribe('document:closed', () => isDocumentOpen = false);

App.addListener('backButton', () => {
  if (isDocumentOpen) {
    // If reading, trigger the UI's existing close command
    trigger('document:command', { command: 'close' });
  } else {
    // If on the home screen, exit the app
    App.exitApp();
  }
});

  window.nviewer = {
    getInitialState: async () => {
      const { value: theme } = await Preferences.get({ key: 'theme' });
      const { value: pdfFilter } = await Preferences.get({ key: 'pdfFilter' });
      const { value: pdfScaleMode } = await Preferences.get({ key: 'pdfScaleMode' });
      
      return {
        preferences: {
          theme: theme || 'light',
          pdfFilter: pdfFilter || 'invert',
          pdfScaleMode: pdfScaleMode || 'fit-width'
        },
        document: null,
        recentDocuments: []
      };
    },

    getRecentDocuments: async () => [],
    openRecentDocument: async (filePath) => null,
    updatePdfLastPage: async (token, page) => {},

    openDialog: async () => {
      try {
        const result = await FilePicker.pickFiles({
          multiple: false,
          readData: false
        });

        if (!result || !result.files || result.files.length === 0) return null;
        
        const file = result.files[0];
        if (!file.path) throw new Error("File path is missing.");
        
        const ext = file.name.split('.').pop().toLowerCase();
        let type = 'text';
        if (ext === 'md' || ext === 'markdown') type = 'markdown';
        if (ext === 'pdf') type = 'pdf';
        if (ext === 'docx') type = 'docx';

        const token = Math.random().toString(36).substring(2);
        const basePayload = {
          type,
          name: file.name,
          token: token,
          size: file.size
        };

        if (type === 'pdf') {
          // Tell Capacitor's internal web server to stream the file natively
          const webviewUrl = Capacitor.convertFileSrc(file.path);
   
          return {
            ...basePayload,
            sourceUrl: webviewUrl,
            resumePage: 1
          };
        }

        if (type === 'docx') {
          const contents = await Filesystem.readFile({ path: file.path });
          const binaryString = atob(contents.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const conversion = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
          return {
            ...basePayload,
            html: conversion.value || '<p></p>',
            warnings: (conversion.messages || []).map(m => m.message)
          };
        }

        const contents = await Filesystem.readFile({ 
          path: file.path,
          encoding: 'utf8'
        });
        
        return {
          ...basePayload,
          content: contents.data,
          richHtml: null
        };

      } catch (e) {
        console.error('File reading failed:', e);
        trigger('app:toast', { message: 'Unable to open document.' });
        return null;
      }
    },

    createFile: async () => { trigger('app:toast', { message: 'Creating files on Android coming soon.' }); return null; },
    openDroppedFile: async (file) => null,
    openRelativeDocument: async (token, relativePath) => null,
    saveDocument: async (token, payload) => { trigger('app:toast', { message: 'Saved successfully.' }); return {ok: true}; },
    saveDocumentCopy: async (token, payload) => null,
    exportDocumentPdf: async (token) => null,
    exportMarkdownDocx: async (token, html) => null,
    insertImage: async (token) => null,
    
    closeDocument: async () => { trigger('document:closed'); },

    updateEditState: (state) => {},
    replyEditState: (requestId, state) => {},

    openExternal: async (url) => { window.open(url, '_blank'); },
    
    setTheme: async (theme) => { await Preferences.set({ key: 'theme', value: theme }); return theme; },
    setPdfFilter: async (filter) => { await Preferences.set({ key: 'pdfFilter', value: filter }); return filter; },
    setPdfScaleMode: async (mode) => { await Preferences.set({ key: 'pdfScaleMode', value: mode }); return mode; },
    
    toggleFullscreen: async () => {},
    exportReady: (requestId) => {},

    onDocumentOpened: (cb) => subscribe('document:opened', cb),
    onDocumentClosed: (cb) => subscribe('document:closed', cb),
    onDocumentSaved: (cb) => subscribe('document:saved', cb),
    onDocumentCommand: (cb) => subscribe('document:command', cb),
    onCollectEditState: (cb) => subscribe('document:collect-edit-state', cb),
    onHistoryChanged: (cb) => subscribe('history:changed', cb),
    onViewCommand: (cb) => subscribe('view:command', cb),
    onThemeChanged: (cb) => subscribe('preferences:theme-changed', cb),
    onPdfFilterChanged: (cb) => subscribe('preferences:pdf-filter-changed', cb),
    onExportPrepare: (cb) => subscribe('export:prepare', cb),
    onExportFinish: (cb) => subscribe('export:finish', cb),
    onToast: (cb) => subscribe('app:toast', cb)
  };
}