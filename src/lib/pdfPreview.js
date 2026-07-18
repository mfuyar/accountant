import { pdfjsLib } from './pdfjsSetup'

// Renders PDF pages ourselves via pdf.js instead of relying on the browser's native <embed>/
// <iframe> PDF viewer, which is unreliable for cross-origin signed URLs in Chrome (shows a
// generic "Open" placeholder instead of the document, regardless of embedding tag used).
export async function loadPdfDocument(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load the document (HTTP ${response.status})`)
  const bytes = await response.arrayBuffer()
  return pdfjsLib.getDocument({ data: bytes }).promise
}

export async function renderPdfPageToDataUrl(pdf, pageNumber, maxWidth = 900) {
  const page = await pdf.getPage(pageNumber)
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = Math.min(2, maxWidth / baseViewport.width)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/png')
}
