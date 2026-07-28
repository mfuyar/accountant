import { useEffect, useState } from 'react'

function AttachmentPreviewModal({ attachment, onClose, onGetUrl, onDownload }) {
  const [url, setUrl] = useState('')
  const [pdf, setPdf] = useState(null)
  const [page, setPage] = useState(1)
  const [pageImage, setPageImage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setUrl('')
    setPdf(null)
    setPage(1)
    setPageImage('')
    setError('')
    onGetUrl(attachment).then(async (signedUrl) => {
      if (cancelled) return
      setUrl(signedUrl)
      const isPdf = attachment.mimeType === 'application/pdf' || attachment.name?.toLowerCase().endsWith('.pdf')
      if (isPdf) {
        const { loadPdfDocument } = await import('./lib/pdfPreview')
        const document = await loadPdfDocument(signedUrl)
        if (!cancelled) setPdf(document)
      }
    }).catch((previewError) => {
      if (!cancelled) setError(previewError.message || 'The document could not be previewed.')
    })
    return () => { cancelled = true }
  }, [attachment, onGetUrl])

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

  return <div className="document-preview-overlay" role="dialog" aria-label={`Preview of ${attachment.name}`} onClick={onClose}>
    <div className="document-preview-dialog" onClick={(event) => event.stopPropagation()}>
      <div className="document-preview-header">
        <strong>{attachment.name}</strong>
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      </div>
      {error ? <p className="validation-error" role="alert">{error}</p> : null}
      {!url && !error ? <p>Loading preview…</p> : null}
      {url && attachment.mimeType?.startsWith('image/') ? <img className="document-preview-media" src={url} alt={attachment.name} /> : null}
      {pdf && pageImage ? <>
        <img className="document-preview-media" src={pageImage} alt={`${attachment.name} — page ${page}`} />
        <div className="button-row document-preview-pagination">
          <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous page</button>
          <span>Page {page} of {pdf.numPages}</span>
          <button type="button" className="secondary-button" disabled={page >= pdf.numPages} onClick={() => setPage((current) => current + 1)}>Next page</button>
        </div>
      </> : null}
      <div className="button-row">
        <button type="button" className="action-button" onClick={() => onDownload(attachment)}>Download</button>
      </div>
    </div>
  </div>
}

export default AttachmentPreviewModal
