export async function extractPdfDocumentText(file) {
  const isPdf = file?.type === 'application/pdf' || file?.name?.toLowerCase().endsWith('.pdf')
  if (!isPdf || typeof file.arrayBuffer !== 'function') return ''

  const { pdfjsLib } = await import('./pdfjsSetup')
  const document = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = []
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 10); pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => item.str).join(' '))
  }
  return pages.join('\n').replace(/\s+/g, ' ').trim().slice(0, 50_000)
}
