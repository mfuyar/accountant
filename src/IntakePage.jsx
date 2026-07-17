import { useEffect, useState } from 'react'
import { extractTransactionFromImage, suggestCategory } from './lib/gemini'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function validateDocument(file) {
  const supportedType = file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!supportedType) {
    return 'Upload an image or PDF document. Other file types are not supported.'
  }
  if (file.size > 10 * 1024 * 1024) {
    return 'The document is too large. Choose a file smaller than 10 MB.'
  }
  return ''
}

function IntakePage({ activeProject, savedItems = [], onSaveIntakeItem, onBack }) {
  const [invoiceDetails, setInvoiceDetails] = useState('')
  const [invoiceImports, setInvoiceImports] = useState([])
  const [imageImports, setImageImports] = useState([])
  const [statementImports, setStatementImports] = useState([])
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!savedItems.length) return
    const entries = savedItems.map((item) => ({
      ...(item.rawData || {}),
      id: item.id,
      sourceName: item.sourceName || item.rawData?.sourceName || '',
      vendor: item.vendor || item.rawData?.vendor || '',
      amount: item.amount,
      description: item.description || item.rawData?.description || '',
      entryType: item.entryType,
      date: item.date,
      notes: item.notes,
      status: item.status,
    }))
    setInvoiceImports(entries.filter((item) => item.type === 'invoice'))
    setImageImports(entries.filter((item) => item.type === 'image'))
    setStatementImports(entries.filter((item) => item.type === 'statement'))
  }, [savedItems])

  const parseInvoiceDetails = (rawText) => {
    const normalized = rawText.trim()
    if (!normalized) {
      return null
    }

    const invoiceNumberMatch = normalized.match(/invoice\s*#?([A-Za-z0-9-]+)/i)
    const vendorMatch = normalized.match(/vendor:\s*([^\n]+)/i)
    const amountMatch = normalized.match(/amount:\s*([$€£]?\s?[0-9,]+(?:\.\d{1,2})?)/i)
    const descriptionMatch = normalized.match(/description:\s*([^\n]+)/i)

    const amountValue = amountMatch?.[1]
      ? Number(String(amountMatch[1]).replace(/[^0-9.]/g, ''))
      : 0

    return {
      invoiceNumber: invoiceNumberMatch?.[1] ?? `INV-${Date.now()}`,
      vendorName: vendorMatch?.[1]?.trim() ?? '',
      amount: amountValue,
      description: descriptionMatch?.[1]?.trim() ?? 'Imported invoice',
    }
  }

  const handleInvoiceImport = async (event) => {
    event.preventDefault()
    const parsedInvoice = parseInvoiceDetails(invoiceDetails)
    if (!parsedInvoice) {
      setErrorMessage('Paste the invoice details before selecting Import invoice.')
      return
    }

    const missingFields = []
    if (!parsedInvoice.vendorName) missingFields.push('vendor')
    if (!Number.isFinite(parsedInvoice.amount) || parsedInvoice.amount <= 0) missingFields.push('amount greater than 0')
    if (missingFields.length) {
      setErrorMessage(`Invoice details are missing: ${missingFields.join(' and ')}. Use labels such as “Vendor:” and “Amount:”.`)
      return
    }

    setErrorMessage('')

    let classificationName = 'Uncategorized'
    try {
      const classification = await suggestCategory(parsedInvoice.description, activeProject?.name || 'Project')
      classificationName = classification?.category ?? 'Uncategorized'
    } catch {
      // Saving the invoice is more important than an optional AI suggestion.
    }

    try {
      const newEntry = {
        id: Date.now(),
        type: 'invoice',
        invoiceNumber: parsedInvoice.invoiceNumber,
        vendor: parsedInvoice.vendorName,
        amount: parsedInvoice.amount,
        description: parsedInvoice.description,
        classification: classificationName,
        status: 'pending',
      }
      const saved = onSaveIntakeItem ? await onSaveIntakeItem(newEntry) : null
      setInvoiceImports((current) => [{ ...newEntry, id: saved?.reviewItem?.id || newEntry.id }, ...current])
      setInvoiceDetails('')
      setMessage(`Saved ${parsedInvoice.invoiceNumber} to Supabase`)
    } catch (error) {
      setErrorMessage(`The invoice could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleImageUpload = async (event) => {
    const [file] = Array.from(event.target.files || [])
    if (!file) {
      return
    }

    const fileError = validateDocument(file)
    if (fileError) {
      setErrorMessage(fileError)
      event.target.value = ''
      return
    }

    setUploading(true)
    setErrorMessage('')
    setMessage(`Processing ${file.name}`)

    try {
      const extracted = await extractTransactionFromImage(file, activeProject?.name || 'Project')
      let classificationName = 'Uncategorized'
      try {
        const classification = await suggestCategory(`${extracted.vendor || ''} ${extracted.description || ''}`, activeProject?.name || 'Project')
        classificationName = classification?.category ?? 'Uncategorized'
      } catch {
        // Keep the extracted document in the queue even without an AI suggestion.
      }

      const imageEntry = {
        id: Date.now(),
        type: 'image',
        sourceName: file.name,
        vendor: extracted.vendor || 'Unknown source',
        amount: Number(extracted.amount || 0),
        description: extracted.description || 'Uploaded receipt or invoice',
        entryType: extracted.entryType || 'unknown',
        classification: classificationName,
        date: extracted.date || '',
        notes: extracted.notes || '',
      }

      const saved = onSaveIntakeItem ? await onSaveIntakeItem(imageEntry, file) : null
      setImageImports((current) => [{ ...imageEntry, id: saved?.reviewItem?.id || imageEntry.id }, ...current])
      setMessage(`Saved to Supabase: ${imageEntry.vendor}`)
    } catch (error) {
      setErrorMessage(`Gemini could not read this document: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setUploading(false)
    }
    event.target.value = ''
  }

  const handleBankStatementUpload = async (event) => {
    const [file] = Array.from(event.target.files || [])
    if (!file) {
      return
    }

    const fileError = validateDocument(file)
    if (fileError) {
      setErrorMessage(fileError)
      event.target.value = ''
      return
    }

    setUploading(true)
    setErrorMessage('')
    setMessage(`Reading statement ${file.name}`)

    try {
      const extracted = await extractTransactionFromImage(file, activeProject?.name || 'Project')
      let classificationName = 'Uncategorized'
      try {
        const classification = await suggestCategory(`bank statement ${extracted.description || ''}`, activeProject?.name || 'Project')
        classificationName = classification?.category ?? 'Uncategorized'
      } catch {
        // Keep the extracted statement in the queue even without an AI suggestion.
      }

      const statementEntry = {
        id: Date.now(),
        type: 'statement',
        sourceName: file.name,
        vendor: extracted.vendor || 'Bank statement',
        amount: Number(extracted.amount || 0),
        description: extracted.description || 'Bank statement transaction',
        entryType: extracted.entryType || 'unknown',
        classification: classificationName,
        date: extracted.date || '',
        notes: extracted.notes || '',
      }

      const saved = onSaveIntakeItem ? await onSaveIntakeItem(statementEntry, file) : null
      setStatementImports((current) => [{ ...statementEntry, id: saved?.reviewItem?.id || statementEntry.id }, ...current])
      setMessage(`Statement saved to Supabase: ${statementEntry.description}`)
    } catch (error) {
      setErrorMessage(`Gemini could not read this statement: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setUploading(false)
    }
    event.target.value = ''
  }

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Intake workspace</p>
          <h1>Receipt, invoice, and document intake</h1>
          <p className="hero-copy">Upload receipts, checks, invoices, and statements for review and classification in one place.</p>
        </div>
        <button type="button" className="action-button" onClick={onBack}>Back to dashboard</button>
      </header>

      <section className="section-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Text intake</p>
              <h2>Paste invoice details</h2>
            </div>
          </div>
          <form className="owner-form" noValidate onSubmit={handleInvoiceImport}>
            <label>
              Invoice details
              <textarea aria-label="Invoice details" rows="5" required value={invoiceDetails} onChange={(event) => setInvoiceDetails(event.target.value)} />
            </label>
            <button type="submit" className="action-button">Import invoice</button>
          </form>
          {errorMessage ? <p className="validation-error" role="alert">{errorMessage}</p> : null}
          {message ? <div className="table-row total-row"><div><strong>{message}</strong><p>Saved to the project intake review queue</p></div></div> : null}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Image intake</p>
              <h2>Upload receipt, invoice, or bank statement</h2>
            </div>
          </div>
          <div className="owner-form">
            <label>
              Upload receipt / invoice / PDF
              <input type="file" accept="image/*,.pdf" onChange={handleImageUpload} />
            </label>
            <label>
              Upload bank statement / PDF
              <input type="file" accept="image/*,.pdf" onChange={handleBankStatementUpload} />
            </label>
            {uploading ? <p className="loading-indicator"><span className="spinner" aria-hidden="true" />Processing image…</p> : null}
          </div>
        </div>
      </section>

      <section className="section-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Imported invoices</p>
              <h2>Review queue</h2>
            </div>
          </div>
          <div className="table-card">
            {invoiceImports.map((invoice) => (
              <div key={invoice.id} className="table-row">
                <div>
                  <strong>{invoice.invoiceNumber}</strong>
                  <p>{invoice.vendor} • {invoice.description}</p>
                </div>
                <div>{currency.format(invoice.amount)}</div>
                <div>{invoice.classification || invoice.status} • {invoice.status || 'pending'}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Scanned items</p>
              <h2>Receipt and statement results</h2>
            </div>
          </div>
          <div className="table-card">
            {imageImports.map((imageEntry) => (
              <div key={imageEntry.id} className="table-row">
                <div>
                  <strong>{imageEntry.vendor}</strong>
                  <p>{imageEntry.description} • {imageEntry.date || 'Date pending'}</p>
                </div>
                <div>{currency.format(imageEntry.amount || 0)}</div>
                <div>{imageEntry.classification}</div>
              </div>
            ))}
            {statementImports.map((statementEntry) => (
              <div key={statementEntry.id} className="table-row">
                <div>
                  <strong>{statementEntry.vendor}</strong>
                  <p>{statementEntry.description} • {statementEntry.date || 'Date pending'}</p>
                </div>
                <div>{currency.format(statementEntry.amount || 0)}</div>
                <div>{statementEntry.classification}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export default IntakePage
