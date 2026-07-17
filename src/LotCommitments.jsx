import { Fragment, useEffect, useMemo, useState } from 'react'
import { classifyLotDocument, extractLotCommitmentFromDocument } from './lib/gemini'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

const subdivisionKey = 'Subdivision'
const loanLotKeys = ['Lot 2', 'Lot 3', 'Lot 4']
const commitmentLotKeys = ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4']
const allLotKeys = [subdivisionKey, ...commitmentLotKeys]
const emptyLotCommitments = []
const emptyIncomes = []
const emptyChecks = []

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

const loadImageElement = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => resolve({ img, url })
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')) }
  img.src = url
})

// Downscales/re-encodes an oversized photo until it fits the upload limit, instead of just
// rejecting it — phone camera photos routinely land well above 10 MB.
const compressImageFile = async (file, maxBytes) => {
  if (!file.type.startsWith('image/') || file.size <= maxBytes) return file
  let img
  let url
  try {
    ;({ img, url } = await loadImageElement(file))
  } catch {
    return file
  }
  try {
    let width = img.naturalWidth
    let height = img.naturalHeight
    let quality = 0.9
    let blob = null
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    for (let attempt = 0; attempt < 8; attempt += 1) {
      canvas.width = width
      canvas.height = height
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      // eslint-disable-next-line no-await-in-loop
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (!blob || blob.size <= maxBytes) break
      if (quality > 0.5) quality -= 0.15
      else { width = Math.round(width * 0.75); height = Math.round(height * 0.75) }
    }
    if (!blob || blob.size > maxBytes) return file
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(url)
  }
}

const isPdfFile = (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

// Compresses oversized images/PDFs automatically, then validates. Returns { file } on success or
// { error } if the document is unsupported or still too large after compression. PDF compression
// pulls in pdfjs-dist/pdf-lib via a dynamic import so those libraries only load when actually needed.
const prepareLotDocument = async (file) => {
  if (!file) return { error: 'Choose an image or PDF before uploading.' }
  const supported = file.type.startsWith('image/') || isPdfFile(file)
  if (!supported) return { error: 'Documents must be images or PDFs.' }
  let prepared = file
  if (file.type.startsWith('image/')) {
    prepared = await compressImageFile(file, MAX_DOCUMENT_BYTES)
  } else if (isPdfFile(file) && file.size > MAX_DOCUMENT_BYTES) {
    try {
      const { compressPdfFile } = await import('./lib/pdfCompression')
      prepared = await compressPdfFile(file, MAX_DOCUMENT_BYTES)
    } catch {
      // Keep the original file — the size check below will surface a clear error.
    }
  }
  if (prepared.size > MAX_DOCUMENT_BYTES) return { error: 'Choose a document smaller than 10 MB — this one is too large even after compression.' }
  return { file: prepared }
}

// Merges a newly classified document into a lot's attachment list. If another document with the
// same label already exists, keeps only the one with the later documentDate — unless either side's
// date is unknown, in which case both are kept and the new one is flagged for manual review rather
// than guessing which is actually newer.
const mergeAttachmentByLabel = (existingAttachments, attachment, documentDate) => {
  const duplicateIndex = existingAttachments.findIndex((entry) => entry.label === attachment.label)
  if (duplicateIndex === -1) {
    return { attachments: [...existingAttachments, { ...attachment, documentDate: documentDate || null }], note: null }
  }
  const existing = existingAttachments[duplicateIndex]
  if (documentDate && existing.documentDate && documentDate < existing.documentDate) {
    const next = [...existingAttachments]
    next.splice(duplicateIndex + 1, 0, { ...attachment, label: `${attachment.label} (older duplicate — verify)`, documentDate })
    return { attachments: next, note: `kept the existing newer "${attachment.label}" and flagged the older upload for review` }
  }
  if (documentDate && existing.documentDate) {
    const next = [...existingAttachments]
    next[duplicateIndex] = { ...attachment, documentDate }
    return { attachments: next, note: `replaced the older "${attachment.label}"` }
  }
  const next = [...existingAttachments]
  next[duplicateIndex] = existing
  next.splice(duplicateIndex + 1, 0, { ...attachment, label: `${attachment.label} (needs review — duplicate, unclear date)`, documentDate: documentDate || null })
  return { attachments: next, note: `flagged duplicate "${attachment.label}" for manual review (date unclear)` }
}

const cleanDocumentName = (fileName) => fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || fileName

const truncateFileName = (name, max = 42) => {
  if (!name || name.length <= max) return name
  const extMatch = name.match(/\.[^.]+$/)
  const ext = extMatch ? extMatch[0] : ''
  const base = ext ? name.slice(0, name.length - ext.length) : name
  const keep = Math.max(6, max - ext.length - 1)
  return `${base.slice(0, keep)}…${ext}`
}

const lotDraftsFromCommitments = (lotCommitments) => {
  const drafts = {}
  allLotKeys.forEach((lot) => {
    const existing = lotCommitments.find((entry) => entry.lot === lot)
    drafts[lot] = {
      address: existing?.address || '',
      commitmentAmount: existing ? String(existing.commitmentAmount) : '',
      permitNumber: existing?.permitNumber || '',
      attachments: existing?.attachments || [],
    }
  })
  return drafts
}

function LotCommitments({ lotCommitments = emptyLotCommitments, incomes = emptyIncomes, checks = emptyChecks, activeProjectId, onSaveLotCommitment, onUploadDocument, onOpenDocument, onGetDocumentUrl }) {
  const [lotDrafts, setLotDrafts] = useState(() => lotDraftsFromCommitments(lotCommitments))
  const [uploadingLotLetter, setUploadingLotLetter] = useState(null)
  const [message, setMessage] = useState('')
  const [lotDocLabels, setLotDocLabels] = useState({})
  const [uploadingLotDoc, setUploadingLotDoc] = useState(null)
  const [expandedLots, setExpandedLots] = useState(() => new Set())
  const [previewDocument, setPreviewDocument] = useState(null)
  const [previewLot, setPreviewLot] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [pendingDeleteKey, setPendingDeleteKey] = useState(null)
  const [deletingKey, setDeletingKey] = useState(null)
  const [bulkSummary, setBulkSummary] = useState([])
  const [bulkUploading, setBulkUploading] = useState(false)
  const [renamingKey, setRenamingKey] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingBusy, setRenamingBusy] = useState(false)
  const [unresolvedDocuments, setUnresolvedDocuments] = useState([])
  const [resolvingKey, setResolvingKey] = useState(null)
  const [resolveLotChoice, setResolveLotChoice] = useState({})

  const toggleLot = (lot) => setExpandedLots((current) => {
    const next = new Set(current)
    if (next.has(lot)) next.delete(lot)
    else next.add(lot)
    return next
  })

  useEffect(() => {
    setLotDrafts(lotDraftsFromCommitments(lotCommitments))
  }, [lotCommitments])

  const lotDrawnTotals = useMemo(() => {
    const totals = {}
    loanLotKeys.forEach((lot) => { totals[lot] = 0 })
    incomes.forEach((income) => {
      if (income.type !== 'loan_draw') return
      ;(income.lotBreakdown || []).forEach((entry) => {
        if (loanLotKeys.includes(entry.lot)) totals[entry.lot] += Number(entry.amount) || 0
      })
    })
    return totals
  }, [incomes])

  const lotSpentTotals = useMemo(() => {
    const totals = {}
    checks.forEach((check) => {
      if (check.status === 'voided' || !check.lot) return
      totals[check.lot] = (totals[check.lot] || 0) + Number(check.amount || 0)
    })
    return totals
  }, [checks])

  const setLotDraftField = (lot, field, value) => setLotDrafts((current) => ({ ...current, [lot]: { ...current[lot], [field]: value } }))

  const persistLotDraft = async (lot, draft) => {
    const numericCommitment = Number(draft.commitmentAmount)
    if (draft.commitmentAmount !== '' && (!Number.isFinite(numericCommitment) || numericCommitment < 0)) {
      setMessage(`Enter a valid commitment amount for ${lot}.`)
      return null
    }
    if (!onSaveLotCommitment) {
      setMessage('Saving lot commitments is unavailable. Sign in and try again.')
      return null
    }
    try {
      const saved = await onSaveLotCommitment({
        projectId: Number(activeProjectId),
        lot,
        address: draft.address.trim(),
        commitmentAmount: numericCommitment || 0,
        permitNumber: (draft.permitNumber || '').trim(),
        attachments: draft.attachments,
      })
      if (saved) {
        setLotDrafts((current) => ({
          ...current,
          [lot]: {
            address: saved.address || '',
            commitmentAmount: String(saved.commitmentAmount ?? numericCommitment ?? 0),
            permitNumber: saved.permitNumber || '',
            attachments: Array.isArray(saved.attachments) ? saved.attachments : draft.attachments,
          },
        }))
      }
      return saved
    } catch (saveError) {
      setMessage(`${lot} commitment could not be saved: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`)
      return null
    }
  }

  const handleBulkUpload = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return

    setMessage('')
    setBulkSummary([])
    setBulkUploading(true)
    const working = { ...lotDrafts }
    const touchedLots = new Set()
    const summary = []
    const unresolved = []
    try {
      for (const rawFile of files) {
        const prepared = await prepareLotDocument(rawFile)
        if (prepared.error) {
          summary.push({ fileName: rawFile.name, error: prepared.error })
          continue
        }
        const file = prepared.file
        let storedDocument
        try {
          storedDocument = onUploadDocument ? await onUploadDocument(file) : null
        } catch (uploadError) {
          summary.push({ fileName: file.name, error: `upload failed — ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}` })
          continue
        }
        if (!storedDocument) {
          summary.push({ fileName: file.name, error: 'upload unavailable' })
          continue
        }
        const knownLots = allLotKeys
          .filter((key) => working[key]?.address)
          .map((key) => ({ lot: key, address: working[key].address }))
        let classification = { lot: null, documentType: 'Other', address: '', commitmentAmount: null }
        try {
          classification = await classifyLotDocument(file, knownLots)
        } catch {
          // Keep the fallback classification — the upload itself already succeeded.
        }
        const lotKnown = allLotKeys.includes(classification.lot)
        // Rather than guessing (which previously defaulted unsure documents to Lot 1 and let
        // unrelated files collide/overwrite each other there), hold these aside for the user to
        // pick the right lot themselves.
        if (!lotKnown) {
          unresolved.push({
            key: storedDocument.documentId || `${file.name}-${Date.now()}`,
            fileName: file.name,
            storedDocument,
            classification,
          })
          summary.push({ fileName: file.name, docType: classification.documentType, needsReview: true })
          continue
        }
        const targetLot = classification.lot
        const isCommitmentLetter = classification.documentType === 'Commitment Letter'
        // A lot can have multiple pre-sale contracts over time (a fallen-through buyer, then a
        // replacement buyer) — unlike Plot Plan/Elevation Drawings, contracts are never duplicates
        // of each other just because they share the "Contract" type, so they must never be merged
        // or overwritten by label. Distinguishing each by its source file keeps them all visible.
        const isContract = classification.documentType === 'Contract'
        const amountValid = Number.isFinite(Number(classification.commitmentAmount)) && Number(classification.commitmentAmount) > 0
        const attachment = {
          ...storedDocument,
          id: storedDocument.documentId,
          name: storedDocument.name || file.name,
          label: isCommitmentLetter ? 'Commitment Letter' : (isContract ? `Contract – ${cleanDocumentName(file.name)}` : classification.documentType),
          uploadedAt: new Date().toISOString(),
        }
        let mergeNote = null
        let mergedAttachments
        if (isCommitmentLetter) {
          mergedAttachments = [...working[targetLot].attachments.filter((entry) => entry.label !== 'Commitment Letter'), { ...attachment, documentDate: classification.documentDate || null }]
        } else if (isContract) {
          mergedAttachments = [...working[targetLot].attachments, { ...attachment, documentDate: classification.documentDate || null }]
        } else {
          const merged = mergeAttachmentByLabel(working[targetLot].attachments, attachment, classification.documentDate)
          mergedAttachments = merged.attachments
          mergeNote = merged.note
        }
        working[targetLot] = {
          address: isCommitmentLetter
            ? (classification.address || working[targetLot].address)
            : (working[targetLot].address.trim() ? working[targetLot].address : (classification.address || '')),
          commitmentAmount: isCommitmentLetter
            ? (amountValid ? String(classification.commitmentAmount) : working[targetLot].commitmentAmount)
            : (working[targetLot].commitmentAmount !== '' ? working[targetLot].commitmentAmount : (amountValid ? String(classification.commitmentAmount) : '')),
          attachments: mergedAttachments,
        }
        touchedLots.add(targetLot)
        summary.push({ fileName: file.name, lot: targetLot, docType: classification.documentType, note: mergeNote })
      }

      setLotDrafts(working)
      for (const lot of touchedLots) {
        await persistLotDraft(lot, working[lot])
      }
      if (unresolved.length) {
        setUnresolvedDocuments((current) => [...current, ...unresolved])
      }
      const failedCount = summary.filter((entry) => entry.error).length
      const reviewNote = unresolved.length ? ` — ${unresolved.length} need${unresolved.length === 1 ? 's' : ''} you to pick a lot below` : ''
      setMessage(`Sorted ${files.length} document${files.length === 1 ? '' : 's'}${failedCount ? ` (${failedCount} could not be filed)` : ''}${reviewNote} — see the list below.`)
      setBulkSummary(summary)
    } catch (unexpectedError) {
      setMessage(`Bulk upload stopped early: ${unexpectedError instanceof Error ? unexpectedError.message : 'Unknown error'}`)
      setBulkSummary(summary)
      if (unresolved.length) {
        setUnresolvedDocuments((current) => [...current, ...unresolved])
      }
    } finally {
      setBulkUploading(false)
    }
  }

  const resolveDocumentLot = async (entry) => {
    const chosenLot = resolveLotChoice[entry.key] || allLotKeys[0]
    setResolvingKey(entry.key)
    setMessage('')
    try {
      const { classification, storedDocument, fileName } = entry
      const isCommitmentLetter = classification.documentType === 'Commitment Letter'
      const isContract = classification.documentType === 'Contract'
      const amountValid = Number.isFinite(Number(classification.commitmentAmount)) && Number(classification.commitmentAmount) > 0
      const attachment = {
        ...storedDocument,
        id: storedDocument.documentId,
        name: storedDocument.name || fileName,
        label: isCommitmentLetter ? 'Commitment Letter' : (isContract ? `Contract – ${cleanDocumentName(fileName)}` : classification.documentType),
        uploadedAt: new Date().toISOString(),
      }
      const currentDraft = lotDrafts[chosenLot]
      let mergedAttachments
      if (isCommitmentLetter) {
        mergedAttachments = [...currentDraft.attachments.filter((item) => item.label !== 'Commitment Letter'), { ...attachment, documentDate: classification.documentDate || null }]
      } else if (isContract) {
        mergedAttachments = [...currentDraft.attachments, { ...attachment, documentDate: classification.documentDate || null }]
      } else {
        mergedAttachments = mergeAttachmentByLabel(currentDraft.attachments, attachment, classification.documentDate).attachments
      }
      const nextDraft = {
        address: isCommitmentLetter
          ? (classification.address || currentDraft.address)
          : (currentDraft.address.trim() ? currentDraft.address : (classification.address || '')),
        commitmentAmount: isCommitmentLetter
          ? (amountValid ? String(classification.commitmentAmount) : currentDraft.commitmentAmount)
          : currentDraft.commitmentAmount,
        permitNumber: currentDraft.permitNumber,
        attachments: mergedAttachments,
      }
      setLotDrafts((current) => ({ ...current, [chosenLot]: nextDraft }))
      const saved = await persistLotDraft(chosenLot, nextDraft)
      if (saved) {
        setUnresolvedDocuments((current) => current.filter((item) => item.key !== entry.key))
        setMessage(`Filed "${fileName}" under ${chosenLot}.`)
      }
    } finally {
      setResolvingKey(null)
    }
  }

  const openLotDocument = async (attachment) => {
    if (!onOpenDocument) return
    try {
      await onOpenDocument(attachment)
    } catch (openError) {
      setMessage(`The document could not be opened: ${openError instanceof Error ? openError.message : 'Unknown error'}`)
    }
  }

  const previewLotDocument = async (lot, attachment) => {
    if (!onGetDocumentUrl) {
      openLotDocument(attachment)
      return
    }
    setPreviewDocument(attachment)
    setPreviewLot(lot)
    setPreviewUrl('')
    setPreviewError('')
    setPreviewLoading(true)
    try {
      const url = await onGetDocumentUrl(attachment)
      setPreviewUrl(url)
    } catch (previewErr) {
      setPreviewError(`The preview could not be loaded: ${previewErr instanceof Error ? previewErr.message : 'Unknown error'}`)
    } finally {
      setPreviewLoading(false)
    }
  }

  const closePreview = () => {
    setPreviewDocument(null)
    setPreviewLot(null)
    setPreviewUrl('')
    setPreviewError('')
    setPreviewLoading(false)
  }

  const deleteLotDocument = async (lot, attachment) => {
    const key = `${lot}:${attachment.id || attachment.storagePath}`
    setDeletingKey(key)
    setMessage('')
    const nextDraft = {
      ...lotDrafts[lot],
      attachments: lotDrafts[lot].attachments.filter((entry) => (entry.id || entry.storagePath) !== (attachment.id || attachment.storagePath)),
    }
    setLotDrafts((current) => ({ ...current, [lot]: nextDraft }))
    const saved = await persistLotDraft(lot, nextDraft)
    if (saved) setMessage(`Removed "${attachment.label || attachment.name}" from ${lot}.`)
    setPendingDeleteKey(null)
    setDeletingKey(null)
  }

  const startRenameDocument = (lot, attachment) => {
    setRenamingKey(`${lot}:${attachment.id || attachment.storagePath}`)
    setRenameValue(attachment.label || attachment.name || '')
    setMessage('')
  }

  const cancelRenameDocument = () => {
    setRenamingKey(null)
    setRenameValue('')
  }

  const saveRenameDocument = async (lot, attachment) => {
    const trimmed = renameValue.trim()
    if (!trimmed) {
      setMessage('Enter a label before saving.')
      return
    }
    const attachmentKey = attachment.id || attachment.storagePath
    setRenamingBusy(true)
    const nextDraft = {
      ...lotDrafts[lot],
      attachments: lotDrafts[lot].attachments.map((entry) =>
        (entry.id || entry.storagePath) === attachmentKey ? { ...entry, label: trimmed } : entry),
    }
    setLotDrafts((current) => ({ ...current, [lot]: nextDraft }))
    const saved = await persistLotDraft(lot, nextDraft)
    setRenamingBusy(false)
    if (saved) {
      setMessage(`Renamed to "${trimmed}".`)
      setRenamingKey(null)
      setRenameValue('')
      setPreviewDocument((current) =>
        (current && (current.id || current.storagePath) === attachmentKey) ? { ...current, label: trimmed } : current)
    }
  }

  const handleLotDocumentUpload = async (lot, event) => {
    const [rawFile] = Array.from(event.target.files || [])
    event.target.value = ''
    if (!rawFile) return
    setMessage('')
    setUploadingLotDoc(lot)
    try {
      const prepared = await prepareLotDocument(rawFile)
      if (prepared.error) {
        setMessage(prepared.error)
        return
      }
      const file = prepared.file
      const storedDocument = onUploadDocument ? await onUploadDocument(file) : null
      if (!storedDocument) {
        setMessage('Document upload is unavailable. Sign in and try again.')
        return
      }
      const label = (lotDocLabels[lot] || '').trim() || file.name
      const attachment = {
        ...storedDocument,
        id: storedDocument.documentId,
        name: storedDocument.name || file.name,
        label,
        uploadedAt: new Date().toISOString(),
      }
      let extractedAddress = ''
      try {
        const extracted = await extractLotCommitmentFromDocument(file)
        extractedAddress = extracted.address || ''
      } catch {
        // Address extraction is a bonus for generic documents — the upload itself already succeeded.
      }
      const nextDraft = {
        ...lotDrafts[lot],
        address: lotDrafts[lot].address.trim() ? lotDrafts[lot].address : extractedAddress,
        attachments: [...lotDrafts[lot].attachments, attachment],
      }
      setLotDrafts((current) => ({ ...current, [lot]: nextDraft }))
      setLotDocLabels((current) => ({ ...current, [lot]: '' }))
      const saved = await persistLotDraft(lot, nextDraft)
      if (saved) {
        setMessage(extractedAddress && !lotDrafts[lot].address.trim()
          ? `Added "${label}" to ${lot} and saved the address Gemini read from it.`
          : `Added "${label}" to ${lot} and saved.`)
      }
    } catch (uploadError) {
      setMessage(`The document could not be uploaded: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`)
    } finally {
      setUploadingLotDoc(null)
    }
  }

  const handleCommitmentLetterUpload = async (lot, event) => {
    const [rawFile] = Array.from(event.target.files || [])
    event.target.value = ''
    if (!rawFile) return
    setMessage('')
    setUploadingLotLetter(lot)
    try {
      const prepared = await prepareLotDocument(rawFile)
      if (prepared.error) {
        setMessage(prepared.error)
        return
      }
      const file = prepared.file
      const storedDocument = onUploadDocument ? await onUploadDocument(file) : null
      const attachment = storedDocument ? {
        ...storedDocument,
        id: storedDocument.documentId,
        name: storedDocument.name || file.name,
        uploadedAt: new Date().toISOString(),
      } : null
      const extracted = await extractLotCommitmentFromDocument(file)
      const hadExistingLetter = lotDrafts[lot].attachments.some((entry) => entry.label === 'Commitment Letter')
      const extractedAmountValid = Number.isFinite(Number(extracted.commitmentAmount)) && Number(extracted.commitmentAmount) > 0
      const nextDraft = {
        // The commitment letter is the authoritative source for these fields, so trust whatever
        // it reads even if the user already typed (or a prior letter set) something else.
        address: extracted.address || lotDrafts[lot].address,
        commitmentAmount: extractedAmountValid ? String(extracted.commitmentAmount) : lotDrafts[lot].commitmentAmount,
        attachments: attachment
          ? [...lotDrafts[lot].attachments.filter((entry) => entry.label !== 'Commitment Letter'), { ...attachment, label: 'Commitment Letter' }]
          : lotDrafts[lot].attachments,
      }
      setLotDrafts((current) => ({ ...current, [lot]: nextDraft }))
      const saved = await persistLotDraft(lot, nextDraft)
      if (saved) {
        const verb = hadExistingLetter ? 'Replaced the commitment letter with' : 'Uploaded'
        setMessage(extracted.address || extracted.commitmentAmount
          ? `${verb} ${file.name}, filled in what Gemini could read for ${lot}, and saved it.`
          : `${verb} ${file.name} and saved it, but Gemini couldn't read details from it${extracted.notes ? ` — ${extracted.notes}` : ''}. Enter the address and commitment amount manually, then save again.`)
      }
    } catch (uploadError) {
      setMessage(`The commitment letter could not be processed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`)
    } finally {
      setUploadingLotLetter(null)
    }
  }

  const saveLotDraft = async (lot) => {
    const saved = await persistLotDraft(lot, lotDrafts[lot])
    if (saved) setMessage(`${lot} commitment saved.`)
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Construction lots</p>
          <h2>Lots</h2>
        </div>
      </div>

      <div className="lot-bulk-upload">
        <label>Bulk upload documents for all lots
          <input aria-label="Bulk upload documents" type="file" accept="image/*,.pdf" multiple disabled={bulkUploading} onChange={handleBulkUpload} />
        </label>
        <span>Sorts each file to a lot and names it automatically — review the summary after upload.</span>
        {bulkUploading ? <span className="loading-indicator"><span className="spinner" aria-hidden="true" />Sorting and saving documents…</span> : null}
      </div>

      {message ? <p className="wide-field" role="status">{message}</p> : null}
      {bulkSummary.length > 0 ? (
        <ul className="bulk-upload-summary wide-field">
          {bulkSummary.map((entry, index) => (
            <li key={`${entry.fileName}-${index}`} className={entry.error ? 'bulk-upload-summary-error' : ''}>
              {entry.error ? (
                <>
                  <span className="bulk-upload-summary-filename" title={entry.fileName}>{truncateFileName(entry.fileName)}</span>
                  <span className="bulk-upload-summary-detail">{entry.error}</span>
                </>
              ) : entry.needsReview ? (
                <>
                  <span className="bulk-upload-summary-target">{entry.docType}</span>
                  <span className="bulk-upload-summary-flag">needs review — pick a lot below</span>
                  <span className="bulk-upload-summary-filename" title={entry.fileName}>{truncateFileName(entry.fileName)}</span>
                </>
              ) : (
                <>
                  <span className="bulk-upload-summary-target">{entry.lot} · {entry.docType}</span>
                  <span className="bulk-upload-summary-filename" title={entry.fileName}>{truncateFileName(entry.fileName)}</span>
                  {entry.note ? <span className="bulk-upload-summary-detail">{entry.note}</span> : null}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {unresolvedDocuments.length > 0 ? (
        <div className="lot-needs-review wide-field">
          <p className="eyebrow">Needs review</p>
          <span>Couldn't confidently tell which lot these belong to — pick one for each.</span>
          <ul>
            {unresolvedDocuments.map((entry) => (
              <li key={entry.key}>
                <span className="bulk-upload-summary-filename" title={entry.fileName}>{truncateFileName(entry.fileName)}</span>
                <span className="bulk-upload-summary-target">{entry.classification.documentType}</span>
                <select
                  aria-label={`Assign ${entry.fileName} to lot`}
                  value={resolveLotChoice[entry.key] || allLotKeys[0]}
                  disabled={resolvingKey === entry.key}
                  onChange={(event) => setResolveLotChoice((current) => ({ ...current, [entry.key]: event.target.value }))}
                >
                  {allLotKeys.map((lot) => <option key={lot} value={lot}>{lot === subdivisionKey ? 'Subdivision' : lot}</option>)}
                </select>
                <button type="button" className="secondary-button" disabled={resolvingKey === entry.key} onClick={() => resolveDocumentLot(entry)}>
                  {resolvingKey === entry.key ? 'Filing…' : 'Assign'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="lot-commitment-accordion">
        {allLotKeys.map((lot) => {
          const draft = lotDrafts[lot]
          const isSubdivision = lot === subdivisionKey
          const hasLoan = loanLotKeys.includes(lot)
          const commitmentAmount = Number(draft.commitmentAmount) || 0
          const drawn = lotDrawnTotals[lot] || 0
          const remaining = commitmentAmount - drawn
          const spent = lotSpentTotals[lot] || 0
          const documentCount = draft.attachments.length
          const isExpanded = expandedLots.has(lot)
          const hasCommitmentLetter = draft.attachments.some((entry) => entry.label === 'Commitment Letter')
          const savedEntry = lotCommitments.find((entry) => entry.lot === lot)
          const savedAddress = savedEntry?.address || ''
          const savedAmount = savedEntry ? String(savedEntry.commitmentAmount ?? 0) : ''
          const savedPermitNumber = savedEntry?.permitNumber || ''
          const isDirty = draft.address !== savedAddress
            || (hasLoan && draft.commitmentAmount !== savedAmount)
            || (draft.permitNumber || '') !== savedPermitNumber
          const showSaveButton = !hasLoan || !hasCommitmentLetter || isDirty
          return <Fragment key={lot}>
          <div className={`lot-commitment-card${isSubdivision ? ' lot-commitment-card-parent' : ''}`}>
            <button type="button" className="lot-commitment-toggle" aria-expanded={isExpanded} aria-label={`${lot} details`} onClick={() => toggleLot(lot)}>
              <span className="lot-commitment-toggle-title">
                <strong>{isSubdivision ? 'Subdivision (applies to all lots)' : lot}</strong>
                <span>{draft.address || 'No address yet'}</span>
              </span>
              <span className="lot-commitment-toggle-summary">
                <span>{draft.permitNumber ? `Permit ${draft.permitNumber}` : 'No permit number yet'}</span>
                <span>{documentCount} document{documentCount === 1 ? '' : 's'}</span>
                {!isSubdivision ? <span>Spent {currency.format(spent)}</span> : null}
              </span>
              <span className="lot-commitment-toggle-icon" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
            </button>
            {isExpanded ? <div className="lot-commitment-body">
              <label>{isSubdivision ? 'Subdivision name / address' : 'Address'}
                <input aria-label={`${lot} address`} value={draft.address} onChange={(event) => setLotDraftField(lot, 'address', event.target.value)} />
              </label>
              {hasLoan ? <label>Commitment amount
                <input aria-label={`${lot} commitment amount`} type="number" min="0" step="0.01" value={draft.commitmentAmount} onChange={(event) => setLotDraftField(lot, 'commitmentAmount', event.target.value)} />
              </label> : <span>{isSubdivision ? 'Shared documents that apply to every lot (subdivision plat, subdivision drawings, etc.).' : 'No loan on this lot — spending shown below is tracked from checks tagged to it.'}</span>}
              <label>Permit number
                <input aria-label={`${lot} permit number`} value={draft.permitNumber || ''} onChange={(event) => setLotDraftField(lot, 'permitNumber', event.target.value)} />
              </label>
              {hasLoan ? <label className="lot-commitment-upload">Upload commitment letter
                <input aria-label={`Upload ${lot} commitment letter`} type="file" accept="image/*,.pdf" disabled={uploadingLotLetter === lot} onChange={(event) => handleCommitmentLetterUpload(lot, event)} />
              </label> : null}
              {uploadingLotLetter === lot ? <span className="loading-indicator"><span className="spinner" aria-hidden="true" />Reading the commitment letter…</span> : null}
              {draft.attachments.length ? <ul className="lot-commitment-documents">
                {draft.attachments.map((attachment) => {
                  const deleteKey = `${lot}:${attachment.id || attachment.storagePath}`
                  const isPreviewing = previewDocument && previewLot === lot && (previewDocument.id || previewDocument.storagePath) === (attachment.id || attachment.storagePath)
                  const isRenaming = renamingKey === deleteKey && !isPreviewing
                  return <li key={attachment.id || attachment.storagePath}>
                    {isRenaming ? (
                      <span className="lot-commitment-rename">
                        <input
                          aria-label={`Rename ${attachment.label || attachment.name}`}
                          value={renameValue}
                          disabled={renamingBusy}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={(event) => { if (event.key === 'Enter') saveRenameDocument(lot, attachment) }}
                        />
                        <button type="button" className="secondary-button" disabled={renamingBusy} onClick={() => saveRenameDocument(lot, attachment)}>Save</button>
                        <button type="button" className="secondary-button" disabled={renamingBusy} onClick={cancelRenameDocument}>Cancel</button>
                      </span>
                    ) : <span>{attachment.label || attachment.name}</span>}
                    <div className="button-row">
                      {onGetDocumentUrl ? <button type="button" className="secondary-button" onClick={() => previewLotDocument(lot, attachment)}>Preview</button> : null}
                      {onOpenDocument ? <button type="button" className="secondary-button" onClick={() => openLotDocument(attachment)}>Download</button> : null}
                      {!isRenaming ? <button type="button" className="secondary-button" onClick={() => startRenameDocument(lot, attachment)}>Rename</button> : null}
                      {pendingDeleteKey === deleteKey ? (
                        <>
                          <button type="button" className="danger-button" disabled={deletingKey === deleteKey} onClick={() => deleteLotDocument(lot, attachment)}>Confirm delete</button>
                          <button type="button" className="secondary-button" onClick={() => setPendingDeleteKey(null)}>Cancel</button>
                        </>
                      ) : (
                        <button type="button" className="danger-button" onClick={() => setPendingDeleteKey(deleteKey)}>Delete</button>
                      )}
                    </div>
                  </li>
                })}
              </ul> : null}
              <label className="lot-commitment-upload">Document label (e.g. Plot Plan, Elevation Drawings, Architectural Plans)
                <input aria-label={`${lot} document label`} value={lotDocLabels[lot] || ''} onChange={(event) => setLotDocLabels((current) => ({ ...current, [lot]: event.target.value }))} />
              </label>
              <label className="lot-commitment-upload">Add document
                <input aria-label={`Add ${lot} document`} type="file" accept="image/*,.pdf" disabled={uploadingLotDoc === lot} onChange={(event) => handleLotDocumentUpload(lot, event)} />
              </label>
              {uploadingLotDoc === lot ? <span className="loading-indicator"><span className="spinner" aria-hidden="true" />Uploading document…</span> : null}
              <div className="lot-commitment-totals">
                {hasLoan ? <span>Drawn so far: {currency.format(drawn)}</span> : null}
                {hasLoan ? <span>Left: {currency.format(remaining)}</span> : null}
                {!isSubdivision ? <span>Spent (checks tagged to {lot}): {currency.format(spent)}</span> : null}
              </div>
              {showSaveButton ? (
                <div className="button-row">
                  <button type="button" className="secondary-button" onClick={() => saveLotDraft(lot)}>Save {isSubdivision ? 'Subdivision' : lot} {hasLoan ? 'commitment' : 'address'}</button>
                </div>
              ) : <p className="lot-commitment-autosaved">Saved automatically from the commitment letter — no need to save again.</p>}
            </div> : null}
          </div>
          {isSubdivision ? <p className="lot-commitment-divider">Individual lots</p> : null}
          </Fragment>
        })}
      </div>

      {previewDocument ? <div className="document-preview-overlay" role="dialog" aria-label={`Preview of ${previewDocument.label || previewDocument.name}`} onClick={closePreview}>
        <div className="document-preview-panel" onClick={(event) => event.stopPropagation()}>
          <div className="document-preview-header">
            {renamingKey === `${previewLot}:${previewDocument.id || previewDocument.storagePath}` ? (
              <span className="lot-commitment-rename">
                <input
                  aria-label={`Rename ${previewDocument.label || previewDocument.name}`}
                  value={renameValue}
                  disabled={renamingBusy}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') saveRenameDocument(previewLot, previewDocument) }}
                />
                <button type="button" className="secondary-button" disabled={renamingBusy} onClick={() => saveRenameDocument(previewLot, previewDocument)}>Save</button>
                <button type="button" className="secondary-button" disabled={renamingBusy} onClick={cancelRenameDocument}>Cancel</button>
              </span>
            ) : (
              <>
                <strong>{previewDocument.label || previewDocument.name}</strong>
                <button type="button" className="secondary-button" onClick={() => startRenameDocument(previewLot, previewDocument)}>Rename</button>
              </>
            )}
            <button type="button" className="secondary-button" onClick={closePreview}>Close</button>
          </div>
          {previewLoading ? <span className="loading-indicator"><span className="spinner" aria-hidden="true" />Loading preview…</span> : null}
          {previewError ? <p className="validation-error">{previewError}</p> : null}
          {!previewLoading && previewUrl ? (
            previewDocument.mimeType?.startsWith('image/')
              ? <img className="document-preview-media" src={previewUrl} alt={previewDocument.label || previewDocument.name} />
              : <>
                <iframe className="document-preview-media" src={previewUrl} title={previewDocument.label || previewDocument.name} />
                <small>Some browsers block inline PDF preview for security reasons. If the box above is empty, use "Open in new tab" below — it opens the same PDF using your browser's own viewer.</small>
              </>
          ) : null}
          {previewUrl ? <div className="button-row">
            {!previewDocument.mimeType?.startsWith('image/') ? <a className="secondary-button" href={previewUrl} target="_blank" rel="noopener noreferrer">Open in new tab</a> : null}
            <a className="secondary-button" href={previewUrl} download={previewDocument.name}>Download</a>
          </div> : null}
        </div>
      </div> : null}
    </section>
  )
}

export default LotCommitments
