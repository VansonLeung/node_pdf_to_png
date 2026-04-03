import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import './App.css'

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function sanitizeBaseName(fileName) {
  return (
    fileName
      .replace(/\.pdf$/i, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'document'
  )
}

function makePngFileName(baseName, pageNumber) {
  return `${baseName}-page-${String(pageNumber).padStart(3, '0')}.png`
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function App() {
  const [sourcePdfName, setSourcePdfName] = useState('')
  const [pngPages, setPngPages] = useState([])
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [isRendering, setIsRendering] = useState(false)
  const [isZipping, setIsZipping] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const workerRef = useRef(null)
  const requestIdRef = useRef(0)
  const pagesRef = useRef([])

  function revokePages(pages) {
    pages.forEach((page) => URL.revokeObjectURL(page.previewUrl))
  }

  function resetPages() {
    setPngPages((existingPages) => {
      revokePages(existingPages)
      return []
    })
  }

  const totalPngSize = useMemo(
    () => pngPages.reduce((sum, page) => sum + page.blob.size, 0),
    [pngPages],
  )

  useEffect(() => {
    pagesRef.current = pngPages
  }, [pngPages])

  useEffect(() => {
    workerRef.current = new Worker(new URL('./pdfRenderWorker.js', import.meta.url), {
      type: 'module',
    })

    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
      revokePages(pagesRef.current)
    }
  }, [])

  async function handlePdfChange(event) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    const looksLikePdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

    if (!looksLikePdf) {
      setErrorMessage('Please choose a valid PDF file.')
      return
    }

    setErrorMessage('')
    setSourcePdfName(file.name)
    setIsRendering(true)
    setProgress({ current: 0, total: 0 })

    try {
      resetPages()
      const data = await file.arrayBuffer()
      const worker = workerRef.current

      if (!worker) {
        throw new Error('Render worker is not available.')
      }

      const baseName = sanitizeBaseName(file.name)
      const requestId = (requestIdRef.current += 1)

      await new Promise((resolve, reject) => {
        const onMessage = (eventData) => {
          const message = eventData.data

          if (!message || message.requestId !== requestId) {
            return
          }

          if (message.type === 'start') {
            setProgress({ current: 0, total: message.totalPages })
            return
          }

          if (message.type === 'page') {
            const blob = new Blob([message.pngBuffer], { type: 'image/png' })
            const nextPage = {
              pageNumber: message.pageNumber,
              fileName: makePngFileName(baseName, message.pageNumber),
              blob,
              width: message.width,
              height: message.height,
              previewUrl: URL.createObjectURL(blob),
            }

            setPngPages((existingPages) => [...existingPages, nextPage])
            setProgress({ current: message.pageNumber, total: message.totalPages })
            return
          }

          if (message.type === 'done') {
            cleanup()
            resolve()
            return
          }

          if (message.type === 'error') {
            cleanup()
            reject(new Error(message.error || 'Could not process the PDF.'))
          }
        }

        const onError = () => {
          cleanup()
          reject(new Error('The render worker crashed while processing the PDF.'))
        }

        function cleanup() {
          worker.removeEventListener('message', onMessage)
          worker.removeEventListener('error', onError)
        }

        worker.addEventListener('message', onMessage)
        worker.addEventListener('error', onError)
        worker.postMessage(
          {
            type: 'convert-pdf',
            requestId,
            buffer: data,
          },
          [data],
        )
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not process the PDF.')
      resetPages()
    } finally {
      setIsRendering(false)
      event.target.value = ''
    }
  }

  async function handleZipDownload() {
    if (!pngPages.length) {
      return
    }

    setIsZipping(true)
    setErrorMessage('')

    try {
      const zip = new JSZip()

      pngPages.forEach((page) => {
        zip.file(page.fileName, page.blob)
      })

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const zipBaseName = sanitizeBaseName(sourcePdfName || 'document')
      downloadBlob(zipBlob, `${zipBaseName}-png-pages.zip`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create ZIP file.')
    } finally {
      setIsZipping(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="panel panel-hero">
        <p className="eyebrow">PDF to PNG Studio</p>
        <h1>Turn PDF pages into PNG files and download them as a ZIP.</h1>
        <p className="subtitle">
          Drop in a PDF, render every page in-browser, then download any page PNG or the full
          archive.
        </p>
      </section>

      <section className="panel panel-uploader">
        <label className="file-label" htmlFor="pdf-input">
          <span>Choose PDF</span>
          <input
            id="pdf-input"
            type="file"
            accept="application/pdf,.pdf"
            onChange={handlePdfChange}
            disabled={isRendering}
          />
        </label>

        {sourcePdfName && <p className="meta-line">Source: {sourcePdfName}</p>}

        {isRendering && progress.total > 0 && (
          <div className="progress-wrap" role="status" aria-live="polite">
            <p>
              Rendering pages in background: {progress.current}/{progress.total}
            </p>
            <div className="progress-track" aria-hidden="true">
              <div
                className="progress-bar"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {errorMessage && <p className="error-box">{errorMessage}</p>}
      </section>

      {!!pngPages.length && (
        <section className="panel panel-actions">
          <p>
            Generated <strong>{pngPages.length}</strong> PNG files ({formatFileSize(totalPngSize)})
          </p>
          <button type="button" onClick={handleZipDownload} disabled={isZipping}>
            {isZipping ? 'Building ZIP...' : 'Download ZIP'}
          </button>
        </section>
      )}

      {!!pngPages.length && (
        <section className="gallery" aria-label="Generated PNG pages">
          {pngPages.map((page) => (
            <article className="page-card" key={page.fileName}>
              <img src={page.previewUrl} alt={`PDF page ${page.pageNumber}`} loading="lazy" />
              <div className="page-meta">
                <p>Page {page.pageNumber}</p>
                <p>
                  {page.width} x {page.height}
                </p>
                <button type="button" onClick={() => downloadBlob(page.blob, page.fileName)}>
                  Download PNG
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}

export default App