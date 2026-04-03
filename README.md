# PDF to PNG Converter (React + Vite + MuPDF)

A client-side PDF processing app that:

- loads a PDF from file input
- renders every page to PNG using MuPDF.js in a Web Worker
- shows previews and download buttons for every page
- generates a ZIP with all PNG pages, using JSZip

## Features

- Asynchronous PDF processing in a worker (UI remains responsive)
- Progressive rendering and status updates as pages are converted
- Full ZIP download of rendered pages
- Per-page PNG download

## Installation

```bash
cd /Users/user/Desktop/node_pdf_to_png
npm install
```

## Run in development

```bash
npm run dev
```

Open `http://localhost:5173` (or the URL printed by Vite).

## Build for production

```bash
npm run build
npm run preview
```

## File layout

- `src/App.jsx`: main React UI + renderer orchestration
- `src/pdfRenderWorker.js`: MuPDF worker that does the conversion
- `src/App.css`, `src/index.css`: UI styling
- `vite.config.js`: worker output set to `es` for MuPDF module support

## Notes

- MuPDF.js is AGPL-3.0; ensure your project license is compatible.
- Worker makes array buffer transfer for lowest overhead and incremental updates.
- If colors or images look wrong in some PDFs, this version is much more robust than pdfjs-dist on mixed CMYK/JPX content.

## Troubleshooting

- `npm run build` fails with top-level await in worker: ensure `vite.config.js` has `worker: { format: 'es' }`.
- If rendering is stalled, check browser console for any uncaught worker errors.
- Large PDFs may produce large memory usage because each page output is held in memory for preview and zip.

## Clean up temporary objects

On each reload/close, blob object URLs are released to avoid leaks.

