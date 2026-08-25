# N Viewer 2.2.0 Update

## Included

- Markdown editor with preview toggle.
- Save to the original Markdown file.
- Save edited Markdown as a separate copy.
- Export Markdown, including unsaved editor content, as PDF.
- New Markdown creation with a native filename/folder dialog.
- Unsaved-change confirmation before opening another document, creating a new file, closing the file, or exiting the app.
- Existing floating toolbar updated with a three-line menu, Edit, and Save.
- Toolbar hidden on the homepage.
- Clean homepage with New md, creator credit, and the existing app icon.
- Separate `document.ico` for `.md`, `.markdown`, and `.pdf` Windows file associations.

## Build

From the `N-Viewer` directory:

```powershell
Remove-Item -Recurse -Force .\renderer-dist -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .\release -ErrorAction SilentlyContinue
npm install
npm run build:installer
```

The installer output is configured as:

```text
release\N-Viewer-Setup-2.2.0-x64.exe
```

## Windows icon cache

After reinstalling, Windows may temporarily retain an older associated-file icon. Restart Windows Explorer or sign out and back in if necessary.
