# N Viewer 2.4.0 — Full Update Notes

## New document types

- Added simple DOCX reading, editing, save, save-copy, and PDF export.
- Added TXT reading, plain-text editing, save, and save-copy.
- Added file associations for `.docx` and `.txt` while preserving the separate application and document icons.

## Markdown editor

- Replaced the plain textarea workflow with a document-shaped visual editor.
- Added formatting controls for headings, font family, font size, bold, italic, underline, strike-through, text color, highlight, lists, alignment, links, images, and tables.
- Added basic row, column, cell-color, and image-width controls.
- Kept the `.md` source clean and free of embedded HTML.
- Added conditional `.nviewer` presentation sidecars.
- Added hash validation so stale sidecars are ignored.
- Added automatic sidecar removal when rich presentation is no longer required.
- Added Markdown image asset copying and safe relative-path handling.

## Editing workflow

- Replaced **New md** with **New file** and a Markdown/DOCX/TXT choice.
- Added **Edit / Done** mode switching without closing the document.
- Unified unsaved-change protection across Markdown, DOCX, and TXT.
- Removed PDF Save as copy from both the floating and native menus.

## Reading history

- Added a compact homepage recent-files list.
- Added temporary seven-day retention.
- Added silent removal of missing files.
- Added PDF last-page restore using only the page number.
- Did not add PDF bookmarks, labels, notes, progress, prompts, or additional persistent PDF controls.

## Security and reliability

- Added size limits for text, DOCX, rich HTML, sidecars, and inserted images.
- Added safe Markdown asset copying and path-containment checks.
- Embedded DOCX images locally and blocked remote Markdown images.
- Excluded SVG insertion.
- Added unit coverage for conditional sidecars, Markdown and TXT saving, Save as copy, temporary history expiry, missing-file cleanup, PDF layout, settings migration, and security helpers.
