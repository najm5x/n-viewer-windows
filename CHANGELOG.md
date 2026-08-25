# Changelog

## 2.4.0

- Added visual Markdown editing without embedding HTML in Markdown files.
- Added conditional `.nviewer` presentation sidecars with Markdown hash validation and automatic cleanup.
- Added font, size, color, highlight, alignment, list, link, image, and table editing controls.
- Added Edit / Done mode switching without closing the active document.
- Added New file with Markdown, DOCX, and TXT choices.
- Added simplified DOCX reading, editing, saving, save-copy, image/table support, and PDF export.
- Added readable TXT viewing and plain-text editing.
- Added temporary recent-document history with seven-day expiry.
- Added silent PDF last-page restoration using only the page number.
- Removed Save as copy from PDF documents.
- Added DOCX and TXT Windows file associations.
- Added tests for sidecar lifecycle, Markdown/TXT workflows, history expiry, and missing recent files.

## 2.2.0

- Added Markdown edit mode with guarded saving.
- Added New Markdown, Save, Save as Copy, Save as PDF, and Close File workflows.
- Added unsaved-change protection for open, new, close-file, and app exit actions.
- Added a three-line document menu inside the existing floating toolbar.
- Removed the filename from the floating toolbar and added Edit/Save buttons.
- Added the homepage New md action, Najmx credit, and branded app icon.
- Added a separate multi-resolution document icon for Windows file associations.
- Preserved Fit Width as the default PDF opening mode.

## 2.1.0

- Fixed PDF zoom updates being lost while a page was still rendering.
- Re-rendered PDF pages atomically so the page frame and canvas no longer show different sizes.
- Added a true Fit Page mode and corrected Actual Size to use 96 CSS pixels per inch.
- Replaced the hand-built PDF text overlay behavior with PDF.js `TextLayerBuilder`.
- Corrected the PDF.js text-layer scale variable so selection matches the canvas.
- Improved page centering, horizontal scrolling, placeholders, and resize behavior.
- Reworked Markdown typography around Windows-native fonts.
