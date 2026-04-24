import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import './App.css'

const MARKDOWN_MIME_TYPE = 'text/markdown;charset=utf-8'
const OUTPUT_OPTIONS = [
  { value: 'png-zip', label: 'PNG pages as ZIP' },
  { value: 'markdown-single', label: 'Single Markdown file' },
  { value: 'markdown-pages', label: 'One Markdown file per page' },
]

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

function makeMarkdownFileName(baseName, pageNumber) {
  return `${baseName}-page-${String(pageNumber).padStart(3, '0')}.md`
}

function getDocumentTitle(fileName) {
  return fileName.replace(/\.pdf$/i, '').trim() || 'Document'
}

function normalizeMarkdownText(text) {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return normalized || '_No extractable text on this page._'
}

function buildMarkdownPageDocument(page) {
  return `# Page ${page.pageNumber}\n\n${page.content}\n`
}

function buildCombinedMarkdownDocument(fileName, pages) {
  if (!pages.length) {
    return ''
  }

  const sections = pages
    .map((page) => `## Page ${page.pageNumber}\n\n${page.content}`)
    .join('\n\n---\n\n')

  return `# ${getDocumentTitle(fileName)}\n\n${sections}\n`
}

function makeMarkdownBlob(content) {
  return new Blob([content], { type: MARKDOWN_MIME_TYPE })
}

function truncatePreview(text, maxLength = 320) {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trimEnd()}...`
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
  const [outputFormat, setOutputFormat] = useState('png-zip')
  const [resultFormat, setResultFormat] = useState('')
  const [sourcePdfName, setSourcePdfName] = useState('')
  const [pngPages, setPngPages] = useState([])
  const [markdownPages, setMarkdownPages] = useState([])
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

  function resetResults() {
    resetPages()
    setMarkdownPages([])
  }

  const totalPngSize = useMemo(
    () => pngPages.reduce((sum, page) => sum + page.blob.size, 0),
    [pngPages],
  )

  const combinedMarkdown = useMemo(
    () => buildCombinedMarkdownDocument(sourcePdfName, markdownPages),
    [markdownPages, sourcePdfName],
  )

  const totalMarkdownSize = useMemo(() => {
    if (!markdownPages.length) {
      return 0
    }

    if (resultFormat === 'markdown-single') {
      return makeMarkdownBlob(combinedMarkdown).size
    }

    return markdownPages.reduce(
      (sum, page) => sum + makeMarkdownBlob(buildMarkdownPageDocument(page)).size,
      0,
    )
  }, [combinedMarkdown, markdownPages, resultFormat])

  const progressLabel =
    resultFormat === 'png-zip' ? 'Rendering pages in background' : 'Extracting markdown in background'
  const hasPngResults = resultFormat === 'png-zip' && pngPages.length > 0
  const hasMarkdownSingleResult = resultFormat === 'markdown-single' && markdownPages.length > 0
  const hasMarkdownPageResults = resultFormat === 'markdown-pages' && markdownPages.length > 0

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

    const selectedOutputFormat = outputFormat

    setErrorMessage('')
    setSourcePdfName(file.name)
    setResultFormat(selectedOutputFormat)
    setIsRendering(true)
    setProgress({ current: 0, total: 0 })

    try {
      resetResults()
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
            if (selectedOutputFormat === 'png-zip') {
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
            } else {
              const nextPage = {
                pageNumber: message.pageNumber,
                fileName: makeMarkdownFileName(baseName, message.pageNumber),
                content: normalizeMarkdownText(message.markdown || ''),
              }

              setMarkdownPages((existingPages) => [...existingPages, nextPage])
            }

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
            outputFormat: selectedOutputFormat,
          },
          [data],
        )
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not process the PDF.')
      resetResults()
      setResultFormat('')
    } finally {
      setIsRendering(false)
      event.target.value = ''
    }
  }

  async function handlePngZipDownload() {
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

  function handleMarkdownSingleDownload() {
    if (!combinedMarkdown) {
      return
    }

    const baseName = sanitizeBaseName(sourcePdfName || 'document')
    downloadBlob(makeMarkdownBlob(combinedMarkdown), `${baseName}.md`)
  }

  async function handleMarkdownPagesDownload() {
    if (!markdownPages.length) {
      return
    }

    setIsZipping(true)
    setErrorMessage('')

    try {
      const zip = new JSZip()

      markdownPages.forEach((page) => {
        zip.file(page.fileName, buildMarkdownPageDocument(page))
      })

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const zipBaseName = sanitizeBaseName(sourcePdfName || 'document')
      downloadBlob(zipBlob, `${zipBaseName}-markdown-pages.zip`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create ZIP file.')
    } finally {
      setIsZipping(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="panel panel-hero">
        <p className="eyebrow">PDF Export Studio</p>
        <h1>Turn PDFs into PNGs or Markdown files in the browser.</h1>
        <p className="subtitle">
          Choose PNG rendering, a single Markdown export, or one Markdown file per page. Everything
          runs client-side in a worker, so the PDF never leaves the browser.
        </p>
      </section>

      <section className="panel panel-uploader">
        <div className="controls-grid">
          <label className="field-label" htmlFor="output-format">
            <span>Output format</span>
            <select
              id="output-format"
              value={outputFormat}
              onChange={(event) => setOutputFormat(event.target.value)}
              disabled={isRendering}
            >
              {OUTPUT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

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
        </div>

        {sourcePdfName && <p className="meta-line">Source: {sourcePdfName}</p>}

        {isRendering && progress.total > 0 && (
          <div className="progress-wrap" role="status" aria-live="polite">
            <p>
              {progressLabel}: {progress.current}/{progress.total}
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

      {hasPngResults && (
        <section className="panel panel-actions">
          <p>
            Generated <strong>{pngPages.length}</strong> PNG files ({formatFileSize(totalPngSize)})
          </p>
          <div className="action-group">
            <button type="button" onClick={handlePngZipDownload} disabled={isZipping}>
              {isZipping ? 'Building ZIP...' : 'Download ZIP'}
            </button>
          </div>
        </section>
      )}

      {hasPngResults && (
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

      {hasMarkdownSingleResult && (
        <>
          <section className="panel panel-actions">
            <p>
              Generated one Markdown file from <strong>{markdownPages.length}</strong> pages (
              {formatFileSize(totalMarkdownSize)})
            </p>
            <div className="action-group">
              <button type="button" onClick={handleMarkdownSingleDownload}>
                Download Markdown
              </button>
            </div>
          </section>

          <section className="panel">
            <p className="section-title">Markdown preview</p>
            <pre className="markdown-preview">{combinedMarkdown}</pre>
          </section>
        </>
      )}

      {hasMarkdownPageResults && (
        <>
          <section className="panel panel-actions">
            <p>
              Generated <strong>{markdownPages.length}</strong> page-based Markdown files (
              {formatFileSize(totalMarkdownSize)})
            </p>
            <div className="action-group">
              <button type="button" onClick={handleMarkdownPagesDownload} disabled={isZipping}>
                {isZipping ? 'Building ZIP...' : 'Download Markdown ZIP'}
              </button>
            </div>
          </section>

          <section className="gallery" aria-label="Generated Markdown pages">
            {markdownPages.map((page) => (
              <article className="page-card page-card-text" key={page.fileName}>
                <div className="page-meta page-meta-text">
                  <p>Page {page.pageNumber}</p>
                  <p>{page.fileName}</p>
                  <p className="page-snippet">{truncatePreview(page.content)}</p>
                  <button
                    type="button"
                    onClick={() => downloadBlob(makeMarkdownBlob(buildMarkdownPageDocument(page)), page.fileName)}
                  >
                    Download Markdown
                  </button>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  )
}

export default App