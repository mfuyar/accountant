import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function AttachmentPreviewModal({ attachment, onClose, onGetUrl, onDownload, paidWatermark = null }) {
  const [url, setUrl] = useState('')
  const [pdf, setPdf] = useState(null)
  const [page, setPage] = useState(1)
  const [pageImage, setPageImage] = useState('')
  const [printPages, setPrintPages] = useState([])
  const [preparingPrint, setPreparingPrint] = useState(false)
  const [error, setError] = useState('')
  const lowerName = attachment.name?.toLowerCase() || ''
  const isPdf = attachment.mimeType === 'application/pdf' || lowerName.endsWith('.pdf')
  const isImage = attachment.mimeType?.startsWith('image/') || /\.(?:jpe?g|png|webp|gif|heic|heif)$/i.test(lowerName)

  useEffect(() => {
    let cancelled = false
    setUrl('')
    setPdf(null)
    setPage(1)
    setPageImage('')
    setPrintPages([])
    setError('')
    onGetUrl(attachment).then(async (signedUrl) => {
      if (cancelled) return
      setUrl(signedUrl)
      if (isPdf) {
        const { loadPdfDocument } = await import('./lib/pdfPreview')
        const document = await loadPdfDocument(signedUrl)
        if (!cancelled) setPdf(document)
      }
    }).catch((previewError) => {
      if (!cancelled) setError(previewError.message || 'The document could not be previewed.')
    })
    return () => { cancelled = true }
  }, [attachment, isPdf, onGetUrl])

  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    import('./lib/pdfPreview').then(({ renderPdfPageToDataUrl }) => renderPdfPageToDataUrl(pdf, page)).then((image) => {
      if (!cancelled) setPageImage(image)
    }).catch((pageError) => {
      if (!cancelled) setError(pageError.message || 'The PDF page could not be rendered.')
    })
    return () => { cancelled = true }
  }, [page, pdf])

  const printPaidCopy = async () => {
    if (!paidWatermark || (!pdf && !url)) return
    setError('')
    setPreparingPrint(true)
    try {
      let pages = []
      if (pdf) {
        const { renderPdfPageToDataUrl } = await import('./lib/pdfPreview')
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          // Sequential rendering keeps large multi-page invoices from exhausting browser memory.
          // eslint-disable-next-line no-await-in-loop
          pages.push(await renderPdfPageToDataUrl(pdf, pageNumber, 1600))
        }
      } else {
        pages = [url]
      }
      setPrintPages(pages)
      window.setTimeout(() => window.print(), 0)
    } catch (printError) {
      setError(printError.message || 'The paid invoice copy could not be prepared for printing.')
    } finally {
      setPreparingPrint(false)
    }
  }

  const watermarkDetails = paidWatermark ? [
    paidWatermark.checkNumber ? `Check #${paidWatermark.checkNumber}` : '',
    paidWatermark.date || '',
    paidWatermark.amount || '',
  ].filter(Boolean).join(' · ') : ''

  return <><div className="document-preview-overlay" role="dialog" aria-label={`Preview of ${attachment.name}`} onClick={onClose}>
    <div className="document-preview-panel" onClick={(event) => event.stopPropagation()}>
      <div className="document-preview-header">
        <strong>{attachment.name}</strong>
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      </div>
      <div className="document-preview-body">
        {error ? <p className="validation-error" role="alert">{error}</p> : null}
        {!url && !error ? <p>Loading preview…</p> : null}
        {url && isPdf && !pageImage && !error ? <p>Rendering PDF preview…</p> : null}
        {url && isImage ? <div className={`document-preview-page${paidWatermark ? ' paid-invoice-preview-page' : ''}`}><img className="document-preview-media" src={url} alt={attachment.name} />{paidWatermark ? <span className="paid-invoice-preview-watermark">PAID</span> : null}</div> : null}
        {url && !isPdf && !isImage ? <div className="cost-empty-state"><strong>Preview is not available for this file type.</strong><p>Download the document to open it in its original application.</p></div> : null}
        {pdf && pageImage ? <div className={`document-preview-page${paidWatermark ? ' paid-invoice-preview-page' : ''}`}><img className="document-preview-media" src={pageImage} alt={`${attachment.name} — page ${page}`} />{paidWatermark ? <span className="paid-invoice-preview-watermark">PAID</span> : null}</div> : null}
      </div>
      {pdf && pageImage ? (
        <div className="button-row document-preview-pager">
          <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous page</button>
          <span>Page {page} of {pdf.numPages}</span>
          <button type="button" className="secondary-button" disabled={page >= pdf.numPages} onClick={() => setPage((current) => current + 1)}>Next page</button>
        </div>
      ) : null}
      <div className="button-row document-preview-actions">
        {paidWatermark ? <button type="button" className="action-button" disabled={preparingPrint || (!pdf && !url)} onClick={printPaidCopy}>{preparingPrint ? 'Preparing paid copy…' : 'Print invoice with PAID watermark'}</button> : null}
        {onDownload ? <button type="button" className="secondary-button" onClick={() => onDownload(attachment)}>Download a copy</button> : null}
      </div>
    </div>
  </div>
  {printPages.length ? createPortal(<section className="print-paid-invoice-sheet" aria-label={`Printable paid copy of ${attachment.name}`}>
    <style>{'@page { size: letter; margin: 0.35in; }'}</style>
    {printPages.map((image, index) => <article className="paid-invoice-print-page" key={`${index}-${image.slice(-16)}`}>
      <img src={image} alt="" />
      <div className="paid-invoice-print-watermark" aria-hidden="true">
        <strong>PAID</strong>
        {watermarkDetails ? <span>{watermarkDetails}</span> : null}
        {paidWatermark.payee ? <span>{paidWatermark.payee}</span> : null}
      </div>
    </article>)}
  </section>, document.body) : null}</>
}

export default AttachmentPreviewModal
