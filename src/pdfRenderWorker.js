import mupdf from 'mupdf'

const RENDER_SCALE = 2
let colorManagementReady = false

function ensureColorManagement() {
  if (colorManagementReady) {
    return
  }

  try {
    mupdf.enableICC()
  } catch {
    // ICC support may be unavailable in some runtimes; continue without it.
  }

  colorManagementReady = true
}

self.addEventListener('message', (event) => {
  const message = event.data

  if (!message || message.type !== 'convert-pdf') {
    return
  }

  const { requestId, buffer } = message

  try {
    ensureColorManagement()

    const document = mupdf.Document.openDocument(new Uint8Array(buffer), 'application/pdf')

    try {
      const totalPages = document.countPages()

      self.postMessage({
        type: 'start',
        requestId,
        totalPages,
      })

      for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
        const page = document.loadPage(pageIndex)

        try {
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE),
            mupdf.ColorSpace.DeviceRGB,
            false,
          )

          try {
            const pngBytes = pixmap.asPNG()
            const pngCopy = new Uint8Array(pngBytes)

            self.postMessage(
              {
                type: 'page',
                requestId,
                pageNumber: pageIndex + 1,
                totalPages,
                width: pixmap.getWidth(),
                height: pixmap.getHeight(),
                pngBuffer: pngCopy.buffer,
              },
              [pngCopy.buffer],
            )
          } finally {
            pixmap.destroy()
          }
        } finally {
          page.destroy()
        }
      }
    } finally {
      document.destroy()
    }

    self.postMessage({
      type: 'done',
      requestId,
    })
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      error: error instanceof Error ? error.message : 'Could not process the PDF.',
    })
  }
})