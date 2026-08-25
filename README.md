# N Viewer 2.4

N Viewer is a private, local-first Windows desktop document reader and lightweight editor for:

- Markdown (`.md`, `.markdown`)
- PDF (`.pdf`)
- Word documents (`.docx`)
- Plain text (`.txt`)

The application remains read-first and distraction-free. Editing controls appear only when editing is active, and the floating reader controls continue to hide automatically.

## Highlights in 2.4

- Adds a visual Markdown editor that uses the same typography and reading surface as the viewer.
- Keeps Markdown portable: N Viewer never embeds HTML or CSS into the `.md` file.
- Creates a matching `.nviewer` sidecar only when the document uses N Viewer-only presentation features such as colors, fonts, alignment, image sizing, or styled tables.
- Deletes an existing `.nviewer` sidecar automatically when the document no longer needs it.
- Adds simple DOCX reading and editing with text formatting, alignment, tables, links, and images.
- Adds pleasant TXT reading with proportional typography, wrapping, comfortable line length, and simple plain-text editing.
- Replaces **New md** with **New file**, allowing the user to create Markdown, DOCX, or TXT.
- Adds **Edit / Done** so the user can leave editing and return to reading without closing the document.
- Adds a compact recent-documents section on the homepage.
- Remembers only the last PDF page, silently restores it, and automatically clears it with recent-file history after seven days.
- Keeps PDFs read-only and removes **Save as copy** for PDF documents.

## Markdown and `.nviewer`

Markdown remains the canonical content source.

A simple edit produces only:

```text
MyNote.md
```

When N Viewer-only presentation is used, the app creates:

```text
MyNote.md
MyNote.nviewer
```

The sidecar is local JSON presentation data tied to a SHA-256 hash of the Markdown. If the Markdown changes outside N Viewer, stale presentation data is ignored rather than applied to the wrong content.

Examples that require a sidecar include:

- text color or highlight
- custom font family or size
- underline
- paragraph alignment
- styled table cells
- inserted images and custom image width

Standard Markdown features such as headings, bold, italic, strike-through, lists, links, blockquotes, code, and ordinary tables remain in the Markdown file. HTML is never inserted into the `.md` file.

Inserted Markdown images are copied beside the document:

```text
MyNote.md
MyNote.nviewer
MyNote-assets/
  diagram.png
```

## Document behavior

### Markdown

- Read and visually edit.
- Save to the original `.md`.
- Save as a copy while modified in edit mode.
- Export the current document to PDF.
- Export the current document to DOCX.
- Use `.nviewer` only when richer presentation is required.

### DOCX

- Read and edit a simplified semantic representation.
- Basic headings, paragraphs, bold, italic, underline, strike-through, colors, fonts, sizes, lists, alignment, links, tables, and images.
- Save to the original DOCX.
- Save as a DOCX copy while modified in edit mode.
- Export to PDF.

N Viewer does not promise Microsoft Word-perfect pagination or preservation of advanced Word features such as tracked changes, comments, SmartArt, macros, complex sections, text boxes, or embedded Office objects.

### TXT

- Read with a proportional font, line wrapping, paragraph spacing, and a comfortable maximum width.
- Edit as plain UTF-8 text.
- Save and Save as copy while modified in edit mode.
- No rich formatting, PDF export, or DOCX export.

### PDF

- Read-only, with PDF.js rendering and selectable text where the PDF contains real text.
- No editing and no Save as copy.
- Silently remembers only the last viewed page.
- Last-page data and recent-file history expire after seven days.
- No bookmarks, notes, labels, progress indicator, resume prompt, or new permanent PDF toolbar.

## New file workflow

Choose **New file** from the homepage, floating menu, native File menu, or `Ctrl+N`.

N Viewer asks for one of:

- Markdown (`.md`)
- Word document (`.docx`)
- Plain text (`.txt`)

The file is created immediately at the chosen location and opens in edit mode.

## Save and unsaved-change rules

- **Save** is enabled only for Markdown, DOCX, and TXT while edit mode is active and the document has changed.
- **Save as copy** follows the same rule and never appears for PDF.
- **Save as PDF** is available for Markdown and DOCX.
- **Save as DOCX** is available for Markdown.
- Opening, creating, closing, or exiting with unsaved changes shows **Save / Don't Save / Cancel**.
- Clicking **Done** returns to reading mode without closing the document or discarding unsaved changes.

## Recent files and PDF resume

The homepage shows up to eight recently opened Markdown, PDF, DOCX, and TXT documents.

History is stored only in N Viewer's local application-data directory. It:

- expires automatically after seven days
- removes missing or moved files silently
- stores only path, name, type, and last-opened time
- additionally stores only the last page for PDF files

No document content is placed in history.

## Security and privacy

- Documents are processed locally and are not uploaded.
- Electron uses sandboxing, context isolation, no renderer Node.js integration, narrow IPC, sender validation, blocked navigation, and a restrictive Content Security Policy.
- Markdown and DOCX-derived HTML is sanitized before rendering.
- Remote document images are blocked for privacy.
- External links open only after confirmation in the system browser.
- Local linked documents and assets are restricted to the active document's folder tree.
- SVG insertion is intentionally excluded because SVG can contain active or externally referenced content.

## Requirements

- Windows 10 or Windows 11, 64-bit
- Node.js 22.12 or newer
- npm
- Visual Studio, Visual Studio Code, or another editor

## Open in Visual Studio

1. Extract the source ZIP.
2. In Visual Studio, choose **File → Open → Folder**.
3. Select the `N-Viewer` folder.
4. Open **View → Terminal**.
5. Run:

```powershell
npm install
npm run check
npm run dev
```

A `.sln` file is not required. This is a standard Node.js/Electron folder project.

## Commands

```powershell
# Development with Vite and Electron
npm run dev

# Build the renderer, then start Electron
npm start

# Syntax checks, unit tests, and renderer production build
npm run check

# Build unpacked application files
npm run build:dir

# Create the Windows NSIS installer
npm run build:win
```

Installer output is written to `release/`.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open document | `Ctrl+O` |
| New file | `Ctrl+N` |
| Edit / Done | `Ctrl+E` |
| Save | `Ctrl+S` |
| Save as copy | `Ctrl+Shift+S` |
| Dark reading mode | `Ctrl+Shift+D` |
| Zoom in/out | `Ctrl++` / `Ctrl+-` |
| Reset zoom | `Ctrl+0` |
| Fit PDF width | `Ctrl+1` |
| Fit whole PDF page | `Ctrl+2` |
| Actual PDF size | `Ctrl+3` |
| Full screen | `F11` |

## Project structure

```text
main/             Electron main process, document services, temporary history, menus, protocol, export
preload/          Narrow context-isolated renderer bridge
renderer/         Vite HTML shell
renderer/src/     UI, rich editor, Markdown codec, PDF viewer, and styles
scripts/          Development launcher
test/             Node unit and behavior tests
assets/           Application and file-association icons
samples/          Sample documents
renderer-dist/    Generated renderer build, not included in source archives
release/          Generated installer/build output, not included in source archives
```

## Deliberate scope boundaries

N Viewer 2.4 does not include:

- legacy `.doc`
- PDF editing or annotations
- permanent reading history
- PDF bookmarks, labels, notes, or progress indicators
- HTML embedded inside Markdown
- cloud synchronization
- Word-perfect layout preservation
- tracked changes or comments
- macros, SmartArt, equations, or embedded Office objects
- advanced merged-cell table editing
