import { useMemo, useState } from 'react'

const formatSize = (bytes) => {
  const size = Number(bytes || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const canAnalyzeDocument = (document) => {
  const mimeType = String(document.mimeType || '').toLowerCase()
  const filename = String(document.originalName || document.name || '').toLowerCase()
  return mimeType === 'application/pdf' || mimeType.startsWith('image/') || /\.(pdf|png|jpe?g|webp|gif)$/.test(filename)
}

const documentFileType = (document) => {
  const mimeType = String(document.mimeType || '').toLowerCase()
  const filename = String(document.originalName || document.name || '').toLowerCase()
  if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) return 'pdf'
  if (mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif)$/.test(filename)) return 'image'
  if (/word|excel|spreadsheet|csv|text/.test(mimeType) || /\.(docx?|xlsx?|csv|txt)$/.test(filename)) return 'office'
  return 'other'
}

function ProjectDocuments({ documents = [], onUpload, onOpen, onDownload, onDelete, onUpdate, onAnalyze }) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [detailsFilter, setDetailsFilter] = useState('all')
  const [sortBy, setSortBy] = useState('uploaded-newest')
  const [uploading, setUploading] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [analyzingId, setAnalyzingId] = useState(null)
  const [message, setMessage] = useState(null)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return documents
      .filter((document) => !query || [document.name, document.originalName, document.documentDate, document.description]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      .filter((document) => typeFilter === 'all' || documentFileType(document) === typeFilter)
      .filter((document) => {
        if (detailsFilter === 'complete') return Boolean(document.documentDate && document.description)
        if (detailsFilter === 'missing') return !document.documentDate || !document.description
        return true
      })
      .sort((left, right) => {
        if (sortBy === 'name') return String(left.name || '').localeCompare(String(right.name || ''))
        if (sortBy === 'document-newest') return String(right.documentDate || '').localeCompare(String(left.documentDate || ''))
        return String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
      })
  }, [detailsFilter, documents, search, sortBy, typeFilter])

  const uploadFile = async (file) => {
    if (!file || uploading) return
    setUploading(true)
    setMessage(null)
    try {
      await onUpload(file)
      setMessage({ type: 'success', text: `${file.name} added to miscellaneous documents.` })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'The document could not be uploaded.' })
    } finally {
      setUploading(false)
    }
  }

  const removeDocument = async (document) => {
    setMessage(null)
    try {
      await onDelete(document)
      setPendingDeleteId(null)
      setMessage({ type: 'success', text: `${document.name} removed.` })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'The document could not be removed.' })
    }
  }

  const beginEditing = (document) => {
    setEditingId(document.documentId || document.id)
    setEditName(document.name || document.originalName || '')
    setEditDate(document.documentDate || '')
    setEditDescription(document.description || '')
    setMessage(null)
  }

  const saveDocumentDetails = async (document) => {
    const documentId = document.documentId || document.id
    if (!editName.trim() || savingId) return
    setSavingId(documentId)
    setMessage(null)
    try {
      await onUpdate(documentId, { name: editName.trim(), documentDate: editDate, description: editDescription.trim() })
      setEditingId(null)
      setMessage({ type: 'success', text: 'Document name and description saved.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'The document details could not be saved.' })
    } finally {
      setSavingId(null)
    }
  }

  const analyzeDocument = async (document) => {
    const documentId = document.documentId || document.id
    if (analyzingId) return
    setAnalyzingId(documentId)
    setMessage(null)
    try {
      await onAnalyze(document)
      setMessage({ type: 'success', text: `${document.name} analyzed. Review the generated name and description.` })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'The document could not be analyzed.' })
    } finally {
      setAnalyzingId(null)
    }
  }

  return <section className="panel project-documents-panel">
    <div className="panel-header">
      <div>
        <p className="eyebrow">Project archive</p>
        <h2>Miscellaneous documents</h2>
        <p>Store general project files here. Receipts, draw sheets, commitment letters, and lot documents remain in their dedicated sections.</p>
      </div>
      <strong>{documents.length} file{documents.length === 1 ? '' : 's'}</strong>
    </div>

    <div
      className="misc-document-drop-zone"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        uploadFile(Array.from(event.dataTransfer.files || [])[0])
      }}
    >
      <strong>{uploading ? 'Uploading…' : 'Drop a miscellaneous document here'}</strong>
      <span>PDF, image, Word, Excel, CSV, or text · up to 10 MB</span>
      <label className="action-button">
        Choose document
        <input className="file-input-hidden" aria-label="Upload miscellaneous document" type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.csv,.txt" disabled={uploading} onChange={(event) => {
          uploadFile(Array.from(event.target.files || [])[0])
          event.target.value = ''
        }} />
      </label>
    </div>

    {message ? <p className={message.type === 'error' ? 'validation-error' : 'connection-success'} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}

    <div className="misc-document-toolbar">
      <label className="misc-document-search">
        Search documents
        <input aria-label="Search miscellaneous documents" type="search" placeholder="Name, original file, date, or description…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <label>
        File type
        <select aria-label="Filter documents by file type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="all">All file types</option>
          <option value="pdf">PDF</option>
          <option value="image">Images</option>
          <option value="office">Office, CSV, and text</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        Details
        <select aria-label="Filter documents by details" value={detailsFilter} onChange={(event) => setDetailsFilter(event.target.value)}>
          <option value="all">All documents</option>
          <option value="complete">Date and description complete</option>
          <option value="missing">Missing date or description</option>
        </select>
      </label>
      <label>
        Sort
        <select aria-label="Sort documents" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="uploaded-newest">Newest upload</option>
          <option value="document-newest">Newest document date</option>
          <option value="name">Name A–Z</option>
        </select>
      </label>
    </div>

    {(search || typeFilter !== 'all' || detailsFilter !== 'all') ? <div className="misc-document-filter-summary">
      <span>{filtered.length} of {documents.length} documents</span>
      <button type="button" className="text-button" onClick={() => {
        setSearch('')
        setTypeFilter('all')
        setDetailsFilter('all')
      }}>Clear filters</button>
    </div> : null}

    <div className="misc-document-list">
      {!filtered.length ? <div className="cost-empty-state"><strong>{documents.length ? 'No matching documents' : 'No miscellaneous documents yet'}</strong><p>{documents.length ? 'Clear or change the search.' : 'Upload general project records that do not belong to another accounting section.'}</p></div> : null}
      {filtered.map((document) => {
        const documentId = document.documentId || document.id
        const isEditing = editingId === documentId
        return <article className={`misc-document-card${isEditing ? ' is-editing' : ''}`} key={documentId}>
          {isEditing ? <div className="misc-document-edit-form">
            <label>
              Rename document
              <input aria-label={`Document name for ${document.name}`} value={editName} onChange={(event) => setEditName(event.target.value)} />
            </label>
            <label>
              Document date
              <input aria-label={`Document date for ${document.name}`} type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} />
            </label>
            <label>
              Description
              <textarea aria-label={`Description for ${document.name}`} rows="3" value={editDescription} onChange={(event) => setEditDescription(event.target.value)} placeholder="What this document contains and why it matters…" />
            </label>
            <div className="button-row">
              <button type="button" className="action-button" disabled={!editName.trim() || savingId === documentId} onClick={() => saveDocumentDetails(document)}>{savingId === documentId ? 'Saving…' : 'Save details'}</button>
              <button type="button" className="secondary-button" disabled={savingId === documentId} onClick={() => setEditingId(null)}>Cancel</button>
            </div>
          </div> : <>
            <div className="misc-document-details">
              <strong>{document.name}</strong>
              {document.description ? <p className="misc-document-description">{document.description}</p> : <p className="misc-document-description is-empty">No description yet.</p>}
              {document.documentDate ? <p className="misc-document-date">Document date: {document.documentDate}</p> : <p className="misc-document-date is-empty">Document date not set.</p>}
              {document.originalName && document.originalName !== document.name ? <p className="misc-document-original">Original file: {document.originalName}</p> : null}
              <p>{formatSize(document.size)}{document.createdAt ? ` · Added ${String(document.createdAt).slice(0, 10)}` : ''}</p>
            </div>
            <div className="button-row">
              {canAnalyzeDocument(document) ? <button type="button" className="action-button" disabled={analyzingId === documentId} onClick={() => analyzeDocument(document)}>{analyzingId === documentId ? 'Analyzing…' : 'Analyze'}</button> : null}
              <button type="button" className="secondary-button" onClick={() => beginEditing(document)}>Edit details</button>
              <button type="button" className="secondary-button" onClick={() => onOpen(document)}>Preview</button>
              <button type="button" className="secondary-button" onClick={() => onDownload(document)}>Download</button>
              {pendingDeleteId === documentId ? <>
                <button type="button" className="danger-button" onClick={() => removeDocument(document)}>Confirm remove</button>
                <button type="button" className="secondary-button" onClick={() => setPendingDeleteId(null)}>Cancel</button>
              </> : <button type="button" className="danger-button" onClick={() => setPendingDeleteId(documentId)}>Remove</button>}
            </div>
          </>}
        </article>
      })}
    </div>
  </section>
}

export default ProjectDocuments
