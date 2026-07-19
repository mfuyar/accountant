import { useMemo, useState } from 'react'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const validateDocument = (file) => {
  if (!file) return 'Choose an image or PDF before uploading.'
  const supported = file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!supported) return 'Construction draft documents must be images or PDFs.'
  if (file.size > 10 * 1024 * 1024) return 'Choose a document smaller than 10 MB.'
  return ''
}

const estimateLots = [
  ['lot_3', 'Lot #3'],
  ['lot_2', 'Lot #2'],
  ['lot_1', 'Lot #1'],
  ['lot_4', 'Lot #4'],
]

const SHARED_DEVELOPMENT_COST_DRAFT_NAME = 'Lot Cost'

function ConstructionDrafts({ drafts = [], onSaveDraft, onUseDraft, onUploadDocument, onOpenDocument, sharedDevelopmentCostTotal = 0 }) {
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('draft')
  const [editingId, setEditingId] = useState(null)
  const [draftForm, setDraftForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState(null)

  const visibleDrafts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return drafts.filter((draft) => (
      (statusFilter === 'all' || draft.status === statusFilter)
      && (!normalizedSearch || `${draft.name} ${draft.details}`.toLowerCase().includes(normalizedSearch))
    ))
  }, [drafts, search, statusFilter])

  const draftCount = drafts.filter((draft) => draft.status === 'draft').length
  const convertedCount = drafts.filter((draft) => draft.status === 'converted').length
  const estimateTotals = useMemo(() => Object.fromEntries(estimateLots.map(([key]) => [
    key,
    drafts.reduce((total, draft) => {
      const amount = draft.sourceEstimates?.[key]
      return amount == null || amount === '' ? total : total + Number(amount)
    }, 0),
  ])), [drafts])

  const startEditing = (draft) => {
    setEditingId(draft.id)
    setDraftForm({
      details: draft.details || '',
      plannedAmount: draft.plannedAmount ?? '',
      plannedDate: draft.plannedDate || '',
      attachments: draft.attachments || [],
    })
    setMessage(null)
  }

  const saveDraft = async (draft, override = null) => {
    if (!onSaveDraft) {
      setMessage({ type: 'error', text: 'Draft saving is not available. Sign in and try again.' })
      return null
    }
    const values = override || draftForm
    const amount = values.plannedAmount === '' || values.plannedAmount == null ? null : Number(values.plannedAmount)
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      setMessage({ type: 'error', text: 'Planned amount must be 0 or greater, or left blank.' })
      return null
    }
    setSaving(true)
    setMessage(null)
    try {
      const saved = await onSaveDraft(draft.id, {
        ...values,
        plannedAmount: amount,
        status: draft.status,
        convertedCostId: draft.convertedCostId,
      })
      setDraftForm({
        details: saved.details || '',
        plannedAmount: saved.plannedAmount ?? '',
        plannedDate: saved.plannedDate || '',
        attachments: saved.attachments || [],
      })
      setMessage({ type: 'success', text: `${draft.name} draft saved.` })
      return saved
    } catch (error) {
      setMessage({ type: 'error', text: `The draft could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}` })
      return null
    } finally {
      setSaving(false)
    }
  }

  const attachDocument = async (draft, file) => {
    const fileError = validateDocument(file)
    if (fileError) {
      setMessage({ type: 'error', text: fileError })
      return
    }
    if (!onUploadDocument) {
      setMessage({ type: 'error', text: 'Document storage is not available. Sign in and try again.' })
      return
    }
    setUploading(true)
    setMessage(null)
    try {
      const stored = await onUploadDocument(file)
      const attachment = {
        ...stored,
        id: stored.documentId,
        name: stored.name || file.name,
        uploadedAt: new Date().toISOString(),
      }
      const values = { ...draftForm, attachments: [attachment, ...(draftForm.attachments || [])] }
      const saved = await saveDraft(draft, values)
      if (saved) setMessage({ type: 'success', text: `${file.name} attached to ${draft.name}.` })
    } catch (error) {
      setMessage({ type: 'error', text: `The document could not be attached: ${error instanceof Error ? error.message : 'Unknown error'}` })
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="panel construction-drafts-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Construction planning</p>
          <h2>Future construction cost drafts</h2>
          <p className="hero-copy">Prepare details and documents now. Drafts do not affect saved-cost totals until converted.</p>
        </div>
        <button type="button" className="secondary-button" aria-expanded={expanded} aria-controls="construction-draft-list" onClick={() => setExpanded((current) => !current)}>
          {expanded ? 'Hide construction drafts' : `Show construction drafts (${draftCount})`}
        </button>
      </div>

      <div className="construction-draft-summary">
        <div><span>Waiting</span><strong>{draftCount}</strong></div>
        <div><span>Added to costs</span><strong>{convertedCount}</strong></div>
        <div><span>Source</span><strong>Construction cost sheet</strong></div>
      </div>

      <div className="construction-estimate-totals" aria-label="Expected construction totals from source sheet">
        <span>Expected totals from sheet</span>
        {estimateLots.map(([key, label]) => <div key={key}><small>{label}</small><strong>{currency.format(estimateTotals[key])}</strong></div>)}
      </div>

      {expanded ? <div id="construction-draft-list">
        <div className="construction-draft-toolbar">
          <label>
            Find an item
            <input type="search" aria-label="Search construction drafts" placeholder="e.g. HVAC or framing" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label>
            Status
            <select aria-label="Filter construction drafts by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="draft">Waiting</option>
              <option value="converted">Added to costs</option>
              <option value="all">All drafts</option>
            </select>
          </label>
          <span>{visibleDrafts.length} shown</span>
        </div>

        {message ? <div className={`draft-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div> : null}

        <div className="construction-draft-grid">
          {visibleDrafts.map((draft) => {
            const isEditing = editingId === draft.id
            const isSharedDraft = draft.name === SHARED_DEVELOPMENT_COST_DRAFT_NAME
            const sharedLotShare = sharedDevelopmentCostTotal / estimateLots.length
            return <article key={draft.id} className={`construction-draft-card${draft.status === 'converted' ? ' converted' : ''}${isEditing ? ' editing' : ''}`}>
              <div className="construction-draft-card-header">
                <div>
                  <strong>{draft.name}</strong>
                  <p>{isSharedDraft ? 'Shared across all lots — auto-calculated, no action needed' : (draft.status === 'converted' ? 'Added to project costs' : 'Waiting for amount and timing')}</p>
                </div>
                <span className={`draft-status ${draft.status}`}>{isSharedDraft ? 'Auto' : (draft.status === 'converted' ? 'Added' : 'Draft')}</span>
              </div>
              <div className="construction-draft-meta">
                <span>{isSharedDraft ? currency.format(sharedDevelopmentCostTotal) : (draft.plannedAmount == null ? 'Amount not set' : currency.format(draft.plannedAmount))}</span>
                <span>{isSharedDraft ? 'Updates as costs are added' : (draft.plannedDate || 'Date not set')}</span>
                <span>{draft.attachments?.length || 0} file{draft.attachments?.length === 1 ? '' : 's'}</span>
              </div>
              <div className="construction-source-estimates" aria-label={`Expected costs for ${draft.name}`}>
                <span>Sheet estimates</span>
                {estimateLots.map(([key, label]) => <div key={key}>
                  <small>{label}</small>
                  <strong>{isSharedDraft ? currency.format(sharedLotShare) : (draft.sourceEstimates?.[key] == null ? 'Not provided' : currency.format(Number(draft.sourceEstimates[key])))}</strong>
                </div>)}
              </div>
              {draft.details ? <p className="construction-draft-details">{draft.details}</p> : null}
              <div className="button-row">
                <button type="button" className="secondary-button" onClick={() => isEditing ? setEditingId(null) : startEditing(draft)}>{isEditing ? 'Close details' : 'Details & files'}</button>
                {!isSharedDraft && draft.status === 'draft' ? <button type="button" className="action-button" onClick={() => onUseDraft?.(draft)}>Use as construction cost</button> : null}
              </div>

              {isEditing ? <div className="construction-draft-editor">
                <label>
                  Details and scope
                  <textarea aria-label={`Details for ${draft.name}`} rows="3" value={draftForm.details} onChange={(event) => setDraftForm((current) => ({ ...current, details: event.target.value }))} />
                </label>
                {isSharedDraft ? (
                  <p className="construction-draft-details">Amount and date are calculated automatically from total development costs and can't be edited here.</p>
                ) : (
                  <div className="construction-draft-fields">
                    <label>
                      Planned amount (optional)
                      <input aria-label={`Planned amount for ${draft.name}`} type="number" min="0" step="0.01" value={draftForm.plannedAmount} onChange={(event) => setDraftForm((current) => ({ ...current, plannedAmount: event.target.value }))} />
                    </label>
                    <label>
                      Planned date (optional)
                      <input aria-label={`Planned date for ${draft.name}`} type="date" value={draftForm.plannedDate} onChange={(event) => setDraftForm((current) => ({ ...current, plannedDate: event.target.value }))} />
                    </label>
                  </div>
                )}
                <div className="draft-document-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                  event.preventDefault()
                  attachDocument(draft, Array.from(event.dataTransfer.files || [])[0])
                }}>
                  <span className={uploading ? 'loading-indicator' : undefined}>{uploading ? <><span className="spinner" aria-hidden="true" />Uploading…</> : 'Drop an invoice, image, or PDF here'}</span>
                  <label className="attachment-picker">
                    Choose file
                    <input className="file-input-hidden" type="file" accept="image/*,.pdf" aria-label={`Attach document to ${draft.name}`} disabled={uploading} onChange={(event) => {
                      attachDocument(draft, Array.from(event.target.files || [])[0])
                      event.target.value = ''
                    }} />
                  </label>
                </div>
                {draftForm.attachments?.length ? <div className="attachment-list">
                  {draftForm.attachments.map((attachment) => <button key={attachment.documentId || attachment.id || attachment.storagePath || attachment.name} type="button" onClick={() => onOpenDocument?.(attachment)}>{attachment.name || 'Open document'}</button>)}
                </div> : <small>No files attached yet.</small>}
                <button type="button" className="action-button" disabled={saving || uploading} onClick={() => saveDraft(draft)}>{saving ? 'Saving…' : 'Save draft details'}</button>
              </div> : null}
            </article>
          })}
          {visibleDrafts.length === 0 ? <div className="cost-empty-state"><strong>No construction drafts match this view.</strong></div> : null}
        </div>
      </div> : null}
    </section>
  )
}

export default ConstructionDrafts
