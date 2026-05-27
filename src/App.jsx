import { useEffect, useMemo, useRef, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import './App.css'

const AUTO_SCROLL_EDGE_THRESHOLD = 96
const AUTO_SCROLL_MAX_STEP = 24

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
      .replace(/\.(pdf|png)$/i, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'export'
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

function createItemId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function revokeItemPreview(item) {
  URL.revokeObjectURL(item.previewUrl)
}

function insertItemBefore(items, sourceId, targetId) {
  const sourceIndex = items.findIndex((item) => item.id === sourceId)
  const targetIndex = items.findIndex((item) => item.id === targetId)

  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return items
  }

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(sourceIndex, 1)
  const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
  nextItems.splice(adjustedTargetIndex, 0, movedItem)
  return nextItems
}

function moveItemToEnd(items, sourceId) {
  const sourceIndex = items.findIndex((item) => item.id === sourceId)

  if (sourceIndex === -1 || sourceIndex === items.length - 1) {
    return items
  }

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(sourceIndex, 1)
  nextItems.push(movedItem)
  return nextItems
}

function loadPngItem(file) {
  return new Promise((resolve, reject) => {
    const previewUrl = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      resolve({
        id: createItemId('png'),
        kind: 'png',
        sourceName: file.name,
        fileName: file.name.toLowerCase().endsWith('.png') ? file.name : `${sanitizeBaseName(file.name)}.png`,
        width: image.naturalWidth,
        height: image.naturalHeight,
        blob: file,
        previewUrl,
      })
    }

    image.onerror = () => {
      URL.revokeObjectURL(previewUrl)
      reject(new Error(`Could not read ${file.name} as a PNG image.`))
    }

    image.src = previewUrl
  })
}

function makeExportFileName(items) {
  if (items.length === 1) {
    return `${sanitizeBaseName(items[0].sourceName)}.pdf`
  }

  return 'reordered-items.pdf'
}

function App() {
  const [items, setItems] = useState([])
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' })
  const [isProcessingPdf, setIsProcessingPdf] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [draggedItemId, setDraggedItemId] = useState('')
  const [dropTargetId, setDropTargetId] = useState('')
  const workerRef = useRef(null)
  const requestIdRef = useRef(0)
  const itemsRef = useRef([])
  const dragPointerYRef = useRef(null)
  const autoScrollFrameRef = useRef(0)

  const totalPngSize = useMemo(
    () => items.reduce((sum, item) => sum + item.blob.size, 0),
    [items],
  )

  const pdfPageCount = useMemo(
    () => items.filter((item) => item.kind === 'pdf-page').length,
    [items],
  )

  const pngImageCount = items.length - pdfPageCount
  const isBusy = isProcessingPdf || isExportingPdf

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    workerRef.current = new Worker(new URL('./pdfRenderWorker.js', import.meta.url), {
      type: 'module',
    })

    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
      itemsRef.current.forEach(revokeItemPreview)
    }
  }, [])

  useEffect(() => {
    if (!draggedItemId) {
      dragPointerYRef.current = null

      if (autoScrollFrameRef.current) {
        cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = 0
      }

      return undefined
    }

    function scheduleAutoScroll() {
      if (autoScrollFrameRef.current) {
        return
      }

      autoScrollFrameRef.current = requestAnimationFrame(() => {
        autoScrollFrameRef.current = 0

        if (dragPointerYRef.current == null) {
          return
        }

        const viewportHeight = window.innerHeight
        const distanceToTop = dragPointerYRef.current
        const distanceToBottom = viewportHeight - dragPointerYRef.current
        let scrollDelta = 0

        if (distanceToTop < AUTO_SCROLL_EDGE_THRESHOLD) {
          const intensity = (AUTO_SCROLL_EDGE_THRESHOLD - distanceToTop) / AUTO_SCROLL_EDGE_THRESHOLD
          scrollDelta = -Math.ceil(intensity * AUTO_SCROLL_MAX_STEP)
        } else if (distanceToBottom < AUTO_SCROLL_EDGE_THRESHOLD) {
          const intensity = (AUTO_SCROLL_EDGE_THRESHOLD - distanceToBottom) / AUTO_SCROLL_EDGE_THRESHOLD
          scrollDelta = Math.ceil(intensity * AUTO_SCROLL_MAX_STEP)
        }

        if (scrollDelta !== 0) {
          window.scrollBy({ top: scrollDelta, left: 0, behavior: 'auto' })
          scheduleAutoScroll()
        }
      })
    }

    function handleWindowDragOver(event) {
      dragPointerYRef.current = event.clientY
      scheduleAutoScroll()
    }

    function stopAutoScroll() {
      dragPointerYRef.current = null

      if (autoScrollFrameRef.current) {
        cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = 0
      }
    }

    window.addEventListener('dragover', handleWindowDragOver)
    window.addEventListener('drop', stopAutoScroll)
    window.addEventListener('dragend', stopAutoScroll)

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver)
      window.removeEventListener('drop', stopAutoScroll)
      window.removeEventListener('dragend', stopAutoScroll)
      stopAutoScroll()
    }
  }, [draggedItemId])

  function clearDragState() {
    dragPointerYRef.current = null

    if (autoScrollFrameRef.current) {
      cancelAnimationFrame(autoScrollFrameRef.current)
      autoScrollFrameRef.current = 0
    }

    setDraggedItemId('')
    setDropTargetId('')
  }

  function clearAllItems() {
    setItems((existingItems) => {
      existingItems.forEach(revokeItemPreview)
      return []
    })
    clearDragState()
    setErrorMessage('')
  }

  function removeItem(itemId) {
    setItems((existingItems) => {
      const itemToRemove = existingItems.find((item) => item.id === itemId)

      if (!itemToRemove) {
        return existingItems
      }

      revokeItemPreview(itemToRemove)
      return existingItems.filter((item) => item.id !== itemId)
    })
  }

  async function appendPdfFile(file) {
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
          setProgress({ current: 0, total: message.totalPages, label: file.name })
          return
        }

        if (message.type === 'page') {
          const blob = new Blob([message.pngBuffer], { type: 'image/png' })

          setItems((existingItems) => [
            ...existingItems,
            {
              id: createItemId('pdf-page'),
              kind: 'pdf-page',
              sourceName: file.name,
              pageNumber: message.pageNumber,
              fileName: makePngFileName(baseName, message.pageNumber),
              blob,
              width: message.width,
              height: message.height,
              previewUrl: URL.createObjectURL(blob),
            },
          ])

          setProgress({ current: message.pageNumber, total: message.totalPages, label: file.name })
          return
        }

        if (message.type === 'done') {
          cleanup()
          resolve()
          return
        }

        if (message.type === 'error') {
          cleanup()
          reject(new Error(message.error || `Could not process ${file.name}.`))
        }
      }

      const onError = () => {
        cleanup()
        reject(new Error(`The render worker crashed while processing ${file.name}.`))
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
          outputFormat: 'png-zip',
        },
        [data],
      )
    })
  }

  async function handlePdfChange(event) {
    const files = Array.from(event.target.files || [])

    if (!files.length) {
      return
    }

    setErrorMessage('')
    setIsProcessingPdf(true)

    try {
      for (const file of files) {
        const looksLikePdf =
          file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

        if (!looksLikePdf) {
          throw new Error(`Please choose PDF files only. ${file.name} is not a PDF.`)
        }

        await appendPdfFile(file)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not process the PDF files.')
    } finally {
      setIsProcessingPdf(false)
      setProgress({ current: 0, total: 0, label: '' })
      event.target.value = ''
    }
  }

  async function handlePngChange(event) {
    const files = Array.from(event.target.files || [])

    if (!files.length) {
      return
    }

    setErrorMessage('')

    try {
      const newItems = []

      for (const file of files) {
        const looksLikePng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')

        if (!looksLikePng) {
          throw new Error(`Please choose PNG files only. ${file.name} is not a PNG.`)
        }

        newItems.push(await loadPngItem(file))
      }

      setItems((existingItems) => [...existingItems, ...newItems])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not append the PNG files.')
    } finally {
      event.target.value = ''
    }
  }

  function handleDragStart(event, itemId) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', itemId)
    setDraggedItemId(itemId)
    setDropTargetId(itemId)
  }

  function handleDragOver(event, itemId) {
    event.preventDefault()

    if (draggedItemId && draggedItemId !== itemId) {
      setDropTargetId(itemId)
    }
  }

  function handleDropBefore(event, itemId) {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/plain') || draggedItemId

    clearDragState()

    if (!sourceId || sourceId === itemId) {
      return
    }

    setItems((existingItems) => insertItemBefore(existingItems, sourceId, itemId))
  }

  function handleDropAtEnd(event) {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/plain') || draggedItemId

    clearDragState()

    if (!sourceId) {
      return
    }

    setItems((existingItems) => moveItemToEnd(existingItems, sourceId))
  }

  async function handlePdfDownload() {
    if (!items.length) {
      return
    }

    setIsExportingPdf(true)
    setErrorMessage('')

    try {
      const pdfDocument = await PDFDocument.create()

      for (const item of items) {
        const pngBytes = await item.blob.arrayBuffer()
        const pngImage = await pdfDocument.embedPng(pngBytes)
        const page = pdfDocument.addPage([item.width, item.height])

        page.drawImage(pngImage, {
          x: 0,
          y: 0,
          width: item.width,
          height: item.height,
        })
      }

      const pdfBytes = await pdfDocument.save()
      downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), makeExportFileName(items))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not build the PDF file.')
    } finally {
      setIsExportingPdf(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="panel panel-hero">
        <p className="eyebrow">PDF Assembly Studio</p>
        <h1>Append PDF pages and PNGs, reorder them, then export one PDF.</h1>
        <p className="subtitle">
          Each imported PDF page is rendered client-side into a PNG-backed card. Append more PDFs,
          add standalone PNG images, drag cards into the order you want, and download the result as
          a single PDF.
        </p>
      </section>

      <section className="panel panel-uploader">
        <div className="controls-grid">
          <label className="file-label" htmlFor="pdf-input">
            <span>Append PDF files</span>
            <input
              id="pdf-input"
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={handlePdfChange}
              disabled={isBusy}
            />
          </label>

          <label className="file-label" htmlFor="png-input">
            <span>Append PNG images</span>
            <input
              id="png-input"
              type="file"
              accept="image/png,.png"
              multiple
              onChange={handlePngChange}
              disabled={isBusy}
            />
          </label>
        </div>

        <p className="meta-line">
          Appended items stay in memory until you remove them or clear the board.
        </p>

        {isProcessingPdf && progress.total > 0 && (
          <div className="progress-wrap" role="status" aria-live="polite">
            <p>
              Rendering {progress.label}: {progress.current}/{progress.total}
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

      {items.length > 0 && (
        <section className="panel panel-actions">
          <p>
            Board contains <strong>{items.length}</strong> items: <strong>{pdfPageCount}</strong>{' '}
            PDF pages and <strong>{pngImageCount}</strong> PNG images ({formatFileSize(totalPngSize)})
          </p>
          <div className="action-group">
            <button type="button" onClick={handlePdfDownload} disabled={isBusy}>
              {isExportingPdf ? 'Building PDF...' : 'Download reordered PDF'}
            </button>
            <button type="button" className="button-secondary" onClick={clearAllItems} disabled={isBusy}>
              Clear board
            </button>
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section className="panel panel-notes">
          <p className="section-title">Arrange the board</p>
          <p className="meta-line">
            Drag any card onto another card to place it before that item. Drop onto the end zone to
            move it to the last position.
          </p>
        </section>
      )}

      {items.length > 0 && (
        <>
          <section className="gallery" aria-label="Ordered PDF and PNG items">
            {items.map((item, index) => (
              <article
                className={`page-card ${dropTargetId === item.id ? 'page-card-drop-target' : ''}`}
                key={item.id}
                draggable={!isBusy}
                onDragStart={(event) => handleDragStart(event, item.id)}
                onDragOver={(event) => handleDragOver(event, item.id)}
                onDrop={(event) => handleDropBefore(event, item.id)}
                onDragEnd={clearDragState}
              >
                <div className="preview-frame">
                  <span className="item-order">{String(index + 1).padStart(2, '0')}</span>
                  <img
                    src={item.previewUrl}
                    alt={item.kind === 'pdf-page' ? `PDF page ${item.pageNumber}` : item.sourceName}
                    loading="lazy"
                  />
                </div>
                <p>
                  {item.kind === 'pdf-page' ? `PDF page ${item.pageNumber}` : 'PNG image'}
                </p>
                <p className="page-source">{item.sourceName}</p>
                <p>
                  {item.width} x {item.height}
                </p>
                <div className="card-actions">
                  <button type="button" onClick={() => downloadBlob(item.blob, item.fileName)}>
                    Download PNG
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => removeItem(item.id)}
                    disabled={isBusy}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </section>

          <div
            className={`drop-zone ${dropTargetId === 'end' ? 'drop-zone-active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              if (draggedItemId) {
                setDropTargetId('end')
              }
            }}
            onDrop={handleDropAtEnd}
            onDragEnd={clearDragState}
          >
            Drop here to move an item to the end
          </div>
        </>
      )}
    </main>
  )
}

export default App