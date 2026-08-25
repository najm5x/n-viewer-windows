# Verification Status — N Viewer 2.4.0

## Completed in the rebuild environment

- Node syntax checks passed for all modified main-process, preload, renderer, and PDF modules.
- Fourteen automated tests passed.
- Sidecar tests verify that simple Markdown creates no `.nviewer`, rich formatting creates one, reloading restores it, and removing rich presentation deletes it.
- Markdown and TXT tests cover create, save, and Save as copy behavior.
- Temporary-history tests verify seven-day expiry, PDF last-page restoration, and silent removal of missing files.
- Security tests cover path containment, encoded relative links, and external URL allowlisting.
- PDF layout tests cover fit-width, fit-page, actual-size scaling, and zoom clamping.
- Settings tests verify the Fit Width migration and preservation of a valid selected scale mode.
- Static review confirmed that PDF Save as copy is removed from both native and renderer menus.
- The source package contains no generated installer, `node_modules`, or stale build output.

## Required on the development computer

Run the following from the extracted project folder:

```powershell
npm install
npm run check
npm run dev
```

Then manually verify:

1. Create, edit, save, close, and reopen a simple Markdown file; confirm no `.nviewer` is created.
2. Apply color or alignment; save and confirm the matching `.nviewer` is created and restored.
3. Remove rich styling; save and confirm the sidecar is removed.
4. Insert a local image and verify the relative asset folder, Markdown image path, sidecar, PDF export, and DOCX export.
5. Open a DOCX containing headings, lists, a table, and images; edit, save, reopen, save a copy, and export PDF.
6. Open a long TXT file; verify proportional reading typography, wrapping, editing, save, and save-copy.
7. Open a long PDF, navigate to another page, close it, reopen it, and verify silent last-page restoration.
8. Confirm PDFs offer no Edit, Save, Save as copy, Save as PDF, or Save as DOCX commands.
9. Confirm recent documents appear only on the homepage and expire after seven days.
10. Verify dark mode, fullscreen, PDF zoom/selection, protected PDFs, and installer file associations.

Create the installer only after these checks:

```powershell
npm run build:win
```

## Environment limitation

The rebuild environment's npm registry gateway returned timeouts and a 503 response. Therefore it could not install dependencies, generate a truthful `package-lock.json`, run the Vite production bundle, launch Electron, test real DOCX round trips, or build the Windows installer here.

All source-level syntax checks and dependency-independent automated tests passed. Dependency versions are exact-pinned in `package.json`; the first successful `npm install` on the development computer will create the matching lockfile, which should then be committed to source control.
