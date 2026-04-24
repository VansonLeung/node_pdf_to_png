import mupdf from 'mupdf'

const RENDER_SCALE = 2
const SUPPORTED_OUTPUT_FORMATS = new Set(['png-zip', 'markdown-single', 'markdown-pages'])
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

  const { requestId, buffer, outputFormat = 'png-zip' } = message

  try {
    if (!SUPPORTED_OUTPUT_FORMATS.has(outputFormat)) {
      throw new Error('Unsupported output format.')
    }

    ensureColorManagement()

    const document = mupdf.Document.openDocument(new Uint8Array(buffer), 'application/pdf')

    try {
      const totalPages = document.countPages()

      self.postMessage({
        type: 'start',
        requestId,
        outputFormat,
        totalPages,
      })

      for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
        const page = document.loadPage(pageIndex)

        try {
          if (outputFormat === 'png-zip') {
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
                  outputFormat,
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

            continue
          }

          const structuredText = page.toStructuredText()

          try {
            self.postMessage({
              type: 'page',
              requestId,
              outputFormat,
              pageNumber: pageIndex + 1,
              totalPages,
              markdown: structuredText.asText(),
            })
          } finally {
            structuredText.destroy()
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
      outputFormat,
    })
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      error: error instanceof Error ? error.message : 'Could not process the PDF.',
    })
  }
})