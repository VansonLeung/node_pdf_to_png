# PDF Assembly Studio (React + Vite + MuPDF)

A client-side PDF assembly app that:

- appends one or more PDF files and renders each page to a PNG-backed card
- appends standalone PNG images into the same ordered board
- lets you drag and drop cards into a new sequence
- exports the reordered board as a single PDF file in the browser

## Features

- Asynchronous PDF page rendering in a worker so the UI stays responsive
- Mixed board of rendered PDF pages and uploaded PNG images
- Drag-and-drop reordering with live previews
- Single PDF export for the current board order
- Per-item PNG download and item removal controls

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

- `src/App.jsx`: main React UI, ordered item board, PNG append flow, and PDF export orchestration
- `src/pdfRenderWorker.js`: MuPDF worker that renders PDF pages to PNGs
- `src/App.css`, `src/index.css`: UI styling
- `vite.config.js`: worker output set to `es` for MuPDF module support

## Notes

- MuPDF.js is AGPL-3.0; ensure your project license is compatible.
- PDF pages are exported as PNG-backed pages inside the generated PDF, so the final output preserves the visual order you arrange in the board.
- Worker uses array buffer transfer for lower overhead and incremental page append.

## Troubleshooting

- `npm run build` fails with top-level await in worker: ensure `vite.config.js` has `worker: { format: 'es' }`.
- If rendering is stalled, check browser console for any uncaught worker errors.
- Large PDFs or many high-resolution PNGs will increase memory use because all board items stay in memory for preview and export.

## Clean up temporary objects

On each reload/close, blob object URLs are released to avoid leaks.

