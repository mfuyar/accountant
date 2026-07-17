import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

// Rasterizes each page of an oversized PDF (typically scanned commitment letters / plot plans)
// and rebuilds a smaller PDF from re-compressed JPEG pages. Browsers have no native PDF
// re-encoder, so this is the only way to shrink a PDF without a server-side tool.
export async function compressPdfFile(file, maxBytes) {
  if (file.size <= maxBytes) return file
  try {
    const originalBytes = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: originalBytes }).promise

    let scale = 1.5
    let quality = 0.75
    let outputBytes = null

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const pdfDoc = await PDFDocument.create()
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        // eslint-disable-next-line no-await-in-loop
        const page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d')
        // eslint-disable-next-line no-await-in-loop
        await page.render({ canvasContext: ctx, viewport }).promise
        // eslint-disable-next-line no-await-in-loop
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
        if (!blob) continue
        // eslint-disable-next-line no-await-in-loop
        const jpgBytes = new Uint8Array(await blob.arrayBuffer())
        // eslint-disable-next-line no-await-in-loop
        const jpgImage = await pdfDoc.embedJpg(jpgBytes)
        const newPage = pdfDoc.addPage([viewport.width, viewport.height])
        newPage.drawImage(jpgImage, { x: 0, y: 0, width: viewport.width, height: viewport.height })
      }
      // eslint-disable-next-line no-await-in-loop
      outputBytes = await pdfDoc.save()
      if (outputBytes.byteLength <= maxBytes) break
      if (quality > 0.4) quality -= 0.15
      else scale = Math.max(0.6, scale * 0.75)
    }

    if (!outputBytes || outputBytes.byteLength > maxBytes) return file
    return new File([outputBytes], file.name, { type: 'application/pdf' })
  } catch {
    return file
  }
}
