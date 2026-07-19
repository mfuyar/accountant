import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { extractTransactionFromImage } from './lib/gemini'
import ConstructionDrafts from './ConstructionDrafts'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const phaseLabel = (phase) => ({
  development: 'Development',
  construction: 'Construction',
  soft_cost: 'Soft Cost',
  other: 'Other',
}[phase] || phase || 'Development')

const validateCostDocument = (file) => {
  if (!file) return 'Choose a file before uploading.'
  const supportedType = file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!supportedType) return 'Upload an image or PDF invoice. Other file types are not supported.'
  if (file.size > 10 * 1024 * 1024) return 'The invoice file is too large. Choose a file smaller than 10 MB.'
  return ''
}

function CostPage({ owners, developmentCosts, breakdownCosts = [], costVersions, constructionDrafts = [], projectChecks = [], initialParentCostId = null, onBack, onAddDevelopmentCost, onEditDevelopmentCost, onDeleteDevelopmentCost, onUploadDocument, onAttachDocument, onOpenDocument, onMergeBreakdowns, onAddItemsToGroup, onUnmergeGroup, onSaveConstructionDraft, onConvertConstructionDraft, sharedDevelopmentCostTotal = 0 }) {
  const getDefaultOwnerId = (ownerList) => {
    const normalized = (value) => value?.toLowerCase().replace(/\s+/g, '').trim()
    const greenfortOwner = (ownerList || []).find((owner) => {
      const name = normalized(owner.name)
      return name === 'greenfort' || name.includes('greenfort')
    })

    return greenfortOwner?.id ?? ownerList?.[0]?.id ?? null
  }

  const initialParentCost = developmentCosts.find((cost) => cost.costId === initialParentCostId)
  const [costName, setCostName] = useState('')
  const [costAmount, setCostAmount] = useState('')
  const [costDate, setCostDate] = useState(() => initialParentCost?.date || '')
  const [selectedOwnerId, setSelectedOwnerId] = useState(() => initialParentCost?.ownerId ?? getDefaultOwnerId(owners))
  const [costPhase, setCostPhase] = useState(() => initialParentCost?.phase || 'development')
  const [attachments, setAttachments] = useState([])
  const [uploadStatus, setUploadStatus] = useState(() => initialParentCost ? `Adding a breakdown inside ${initialParentCost.name}` : '')
  const [formError, setFormError] = useState('')
  const [editingCostId, setEditingCostId] = useState(null)
  const [parentCostId, setParentCostId] = useState(() => initialParentCost?.costId || null)
  const [costEntryType, setCostEntryType] = useState(() => initialParentCost ? 'breakdown' : 'cost')
  const [pendingDeleteCostId, setPendingDeleteCostId] = useState(null)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [breakdownSort, setBreakdownSort] = useState('amount_desc')
  const [expandedBreakdownIds, setExpandedBreakdownIds] = useState(() => new Set())
  const [attachingCostId, setAttachingCostId] = useState(null)
  const [selectedBreakdownIds, setSelectedBreakdownIds] = useState(() => new Set())
  const [mergeName, setMergeName] = useState('')
  const [mergingBreakdowns, setMergingBreakdowns] = useState(false)
  const [addingToGroupId, setAddingToGroupId] = useState(null)
  const [groupItemIds, setGroupItemIds] = useState(() => new Set())
  const [pendingUnmergeGroupId, setPendingUnmergeGroupId] = useState(null)
  const [updatingGroup, setUpdatingGroup] = useState(false)
  const [savingCost, setSavingCost] = useState(false)
  const [sourceDraftId, setSourceDraftId] = useState(null)
  const [costSearch, setCostSearch] = useState('')
  const [costPhaseFilter, setCostPhaseFilter] = useState('all')
  const [costOwnerFilter, setCostOwnerFilter] = useState('all')
  const costEditorRef = useRef(null)
  const costNameInputRef = useRef(null)
  const costListRef = useRef(null)
  const historyRef = useRef(null)

  const ownerOptions = useMemo(() => owners || [], [owners])
  const availableParentCosts = useMemo(
    () => developmentCosts.filter((cost) => cost.costId !== editingCostId),
    [developmentCosts, editingCostId],
  )

  const filteredDevelopmentCosts = useMemo(() => {
    const search = costSearch.trim().toLowerCase()
    return developmentCosts.filter((cost) => {
      const owner = ownerOptions.find((entry) => entry.id === cost.ownerId)
      const matchesSearch = !search || `${cost.name} ${owner?.name || ''}`.toLowerCase().includes(search)
      const matchesPhase = costPhaseFilter === 'all' || cost.phase === costPhaseFilter
      const matchesOwner = costOwnerFilter === 'all' || String(cost.ownerId) === costOwnerFilter
      return matchesSearch && matchesPhase && matchesOwner
    })
  }, [costOwnerFilter, costPhaseFilter, costSearch, developmentCosts, ownerOptions])

  useEffect(() => {
    if (!ownerOptions.length) {
      return
    }

    setSelectedOwnerId((current) => {
      const currentOwnerExists = ownerOptions.some((owner) => owner.id === current)
      return currentOwnerExists ? current : getDefaultOwnerId(ownerOptions)
    })
  }, [ownerOptions])

  const totalDevelopment = useMemo(() => {
    return developmentCosts.filter((cost) => cost.phase === 'development').reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
  }, [developmentCosts])

  const totalConstruction = useMemo(() => {
    return developmentCosts.filter((cost) => cost.phase === 'construction').reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
  }, [developmentCosts])

  const totalSoftCost = useMemo(() => {
    return developmentCosts.filter((cost) => cost.phase === 'soft_cost').reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
  }, [developmentCosts])

  const totalOther = useMemo(() => {
    return developmentCosts.filter((cost) => cost.phase === 'other').reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
  }, [developmentCosts])

  const sortedVersions = useMemo(() => {
    return [...(costVersions || [])].sort((a, b) => {
      const costComparison = String(a.costId ?? a.id).localeCompare(String(b.costId ?? b.id))
      return costComparison === 0 ? Number(b.version || 1) - Number(a.version || 1) : costComparison
    })
  }, [costVersions])

  const sortBreakdowns = (items) => [...items].sort((a, b) => {
    if (breakdownSort === 'amount_desc') return Number(b.amount || 0) - Number(a.amount || 0)
    if (breakdownSort === 'amount_asc') return Number(a.amount || 0) - Number(b.amount || 0)
    if (breakdownSort === 'date_desc') return String(b.date || '').localeCompare(String(a.date || ''))
    if (breakdownSort === 'date_asc') return String(a.date || '').localeCompare(String(b.date || ''))
    if (breakdownSort === 'name_desc') return String(b.name || '').localeCompare(String(a.name || ''))
    return String(a.name || '').localeCompare(String(b.name || ''))
  })

  const toggleBreakdowns = (costId) => {
    setExpandedBreakdownIds((current) => {
      const next = new Set(current)
      if (next.has(costId)) next.delete(costId)
      else next.add(costId)
      return next
    })
  }

  const selectedBreakdownParentId = useMemo(() => {
    const [selectedId] = selectedBreakdownIds
    return breakdownCosts.find((cost) => cost.costId === selectedId)?.parentCostId || null
  }, [breakdownCosts, selectedBreakdownIds])

  const toggleBreakdownSelection = (breakdown, parent) => {
    const removing = selectedBreakdownIds.has(breakdown.costId)
    if (removing && selectedBreakdownIds.size === 1) setMergeName('')
    if (!removing && selectedBreakdownParentId !== parent.costId) {
      setMergeName(`${parent.name} merged breakdown`)
    }
    setSelectedBreakdownIds((current) => {
      const next = new Set(current)
      if (next.has(breakdown.costId)) {
        next.delete(breakdown.costId)
      } else {
        next.add(breakdown.costId)
      }
      return next
    })
  }

  const handleMergeSelected = async (parent) => {
    const selectedIds = [...selectedBreakdownIds].filter((costId) => breakdownCosts.some((cost) => (
      cost.costId === costId && cost.parentCostId === parent.costId
    )))
    if (selectedIds.length < 2) {
      setFormError('Select at least two breakdowns under the same parent.')
      return
    }
    if (!mergeName.trim()) {
      setFormError('Enter a name for the merged breakdown.')
      return
    }
    if (!onMergeBreakdowns) {
      setFormError('Breakdown merging is not available. Sign in and try again.')
      return
    }
    setMergingBreakdowns(true)
    setFormError('')
    try {
      await onMergeBreakdowns(parent.costId, selectedIds, mergeName.trim())
      setSelectedBreakdownIds(new Set())
      setMergeName('')
      setUploadStatus(`${selectedIds.length} breakdowns merged into ${mergeName.trim()}`)
    } catch (error) {
      setFormError(`The breakdowns could not be merged: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setMergingBreakdowns(false)
    }
  }

  const toggleGroupItemSelection = (costId) => {
    setGroupItemIds((current) => {
      const next = new Set(current)
      if (next.has(costId)) next.delete(costId)
      else next.add(costId)
      return next
    })
  }

  const handleAddSelectedToGroup = async (group) => {
    const selectedIds = [...groupItemIds]
    if (!selectedIds.length) {
      setFormError('Select at least one breakdown to add to this group.')
      return
    }
    if (!onAddItemsToGroup) {
      setFormError('Changing breakdown groups is not available. Sign in and try again.')
      return
    }
    setUpdatingGroup(true)
    setFormError('')
    try {
      await onAddItemsToGroup(group.costId, selectedIds)
      setAddingToGroupId(null)
      setGroupItemIds(new Set())
      setUploadStatus(`${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} added to ${group.name}`)
    } catch (error) {
      setFormError(`The items could not be added: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setUpdatingGroup(false)
    }
  }

  const handleUnmergeGroup = async (group) => {
    if (!onUnmergeGroup) {
      setFormError('Unmerging breakdown groups is not available. Sign in and try again.')
      return
    }
    setUpdatingGroup(true)
    setFormError('')
    try {
      await onUnmergeGroup(group.costId)
      setPendingUnmergeGroupId(null)
      setAddingToGroupId(null)
      setGroupItemIds(new Set())
      setUploadStatus(`${group.name} was unmerged. Its individual items are still available.`)
    } catch (error) {
      setFormError(`The group could not be unmerged: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setUpdatingGroup(false)
    }
  }

  const revealEditor = () => {
    costEditorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    costNameInputRef.current?.focus({ preventScroll: true })
  }

  const handleAddCost = async (event) => {
    event?.preventDefault()
    if (savingCost) return
    if (!costName.trim()) {
      setFormError('Enter a cost name before saving.')
      return
    }
    const amount = Number(costAmount)
    if (costAmount === '' || !Number.isFinite(amount) || amount <= 0) {
      setFormError('Enter a valid cost amount greater than 0.')
      return
    }
    if (!costDate) {
      setFormError('Select the date when the cost occurred.')
      return
    }
    if (selectedOwnerId == null) {
      setFormError('Add and select an owner before saving the cost.')
      return
    }
    if (costEntryType === 'breakdown' && !parentCostId) {
      setFormError('Select the parent cost that this breakdown belongs to.')
      return
    }

    const payload = {
      name: costName.trim(),
      amount,
      ownerId: selectedOwnerId,
      phase: costPhase,
      date: costDate,
      attachments,
      parentCostId: costEntryType === 'breakdown' ? parentCostId : null,
    }

    const wasEditing = Boolean(editingCostId)
    setSavingCost(true)
    try {
      let savedCost
      if (editingCostId) {
        savedCost = await onEditDevelopmentCost({ costId: editingCostId, ...payload })
      } else {
        savedCost = await onAddDevelopmentCost(payload)
      }
      if (sourceDraftId && savedCost?.costId && onConvertConstructionDraft) {
        await onConvertConstructionDraft(sourceDraftId, savedCost.costId)
      }
    } catch (error) {
      setFormError(`The cost could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return
    } finally {
      setSavingCost(false)
    }

    setCostName('')
    setCostAmount('')
    setCostDate('')
    setAttachments([])
    setEditingCostId(null)
    setParentCostId(null)
    setCostEntryType('cost')
    setSourceDraftId(null)
    setFormError('')
    setUploadStatus(wasEditing ? 'New cost version saved to Supabase' : 'Cost saved to Supabase')
  }

  const handleStartEdit = (cost) => {
    setEditingCostId(cost.costId)
    setCostName(cost.name)
    setCostAmount(String(cost.amount))
    setCostDate(cost.date || '')
    setSelectedOwnerId(cost.ownerId)
    setCostPhase(cost.phase || 'development')
    setAttachments(cost.attachments || [])
    setParentCostId(cost.parentCostId || null)
    setCostEntryType(cost.parentCostId ? 'breakdown' : 'cost')
    setSourceDraftId(null)
    setFormError('')
    setUploadStatus(`Editing ${cost.name} · version ${cost.version}`)
    revealEditor()
  }

  const handleStartBreakdown = (parentCost) => {
    setEditingCostId(null)
    setParentCostId(parentCost.costId)
    setCostEntryType('breakdown')
    setSourceDraftId(null)
    setCostName('')
    setCostAmount('')
    setCostDate(parentCost.date || '')
    setSelectedOwnerId(parentCost.ownerId)
    setCostPhase(parentCost.phase || 'development')
    setAttachments([])
    setFormError('')
    setUploadStatus(`Adding a breakdown inside ${parentCost.name}`)
    revealEditor()
  }

  const handleCancelEdit = () => {
    setEditingCostId(null)
    setCostName('')
    setCostAmount('')
    setCostDate('')
    setAttachments([])
    setParentCostId(null)
    setCostEntryType('cost')
    setSourceDraftId(null)
    setUploadStatus('Edit cancelled')
    setFormError('')
  }

  const handleStartNewCost = () => {
    handleCancelEdit()
    setUploadStatus('Ready to add a new top-level cost')
    revealEditor()
  }

  const handleShowHistory = () => {
    setShowVersionHistory(true)
    historyRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  const handleUseConstructionDraft = (draft) => {
    setEditingCostId(null)
    setSourceDraftId(draft.id)
    setParentCostId(null)
    setCostEntryType('cost')
    setCostName(draft.name)
    setCostAmount(draft.plannedAmount == null ? '' : String(draft.plannedAmount))
    setCostDate(draft.plannedDate || '')
    setCostPhase('construction')
    setAttachments(draft.attachments || [])
    setFormError('')
    setUploadStatus(`Creating a construction cost from the ${draft.name} draft. Enter the actual amount and date before saving.`)
    revealEditor()
  }

  const applyParentCost = (nextParentId) => {
    const parent = developmentCosts.find((cost) => cost.costId === nextParentId)
    setParentCostId(nextParentId || null)
    if (!parent) return
    setSelectedOwnerId(parent.ownerId)
    setCostPhase(parent.phase || 'development')
    setCostDate(parent.date || '')
  }

  const handleEntryTypeChange = (nextType) => {
    setCostEntryType(nextType)
    setFormError('')
    if (nextType === 'cost') {
      setParentCostId(null)
      return
    }
    if (!availableParentCosts.length) {
      setParentCostId(null)
      setFormError('Add a parent cost before creating a breakdown.')
      return
    }
    applyParentCost(parentCostId && availableParentCosts.some((cost) => cost.costId === parentCostId)
      ? parentCostId
      : availableParentCosts[0].costId)
  }

  const handleConfirmDelete = async (costId) => {
    try {
      await onDeleteDevelopmentCost(costId)
      setPendingDeleteCostId(null)
      setUploadStatus('Cost soft deleted in Supabase; its version history was preserved')
    } catch (error) {
      setFormError(`The cost could not be deleted: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const processFormDocument = async (file) => {
    const fileError = validateCostDocument(file)
    if (fileError) {
      setFormError(fileError)
      return
    }

    setFormError('')
    let storedDocument = null
    try {
      storedDocument = onUploadDocument ? await onUploadDocument(file) : null
    } catch (error) {
      setFormError(`The document could not be uploaded: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return
    }

    let extracted = {}
    let extractionFailed = false
    try {
      extracted = await extractTransactionFromImage(file, 'Greenfort Cost Intake')
    } catch {
      extractionFailed = true
    }

    try {
      const extractedAmount = Number(extracted.amount)
      const extractedDate = typeof extracted.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)
        ? extracted.date
        : ''
      const newAttachment = {
        id: Date.now(),
        name: file.name,
        vendor: extracted.vendor || 'Unknown source',
        amount: Number.isFinite(extractedAmount) ? extractedAmount : 0,
        date: extractedDate,
        description: extracted.description || 'Uploaded cost document',
        ...(storedDocument || {}),
      }

      setAttachments((current) => [newAttachment, ...current])
      setCostName((current) => current.trim() ? current : extracted.description || extracted.vendor || '')
      if (Number.isFinite(extractedAmount) && extractedAmount > 0) {
        setCostAmount((current) => current === '' ? String(extractedAmount) : current)
      }
      if (extractedDate) {
        setCostDate((current) => current || extractedDate)
      }
      setUploadStatus(extractionFailed
        ? `Uploaded ${file.name} to Supabase; enter any fields Gemini could not read`
        : `Uploaded ${file.name} to Supabase and filled available invoice fields`)
    } catch (error) {
      setFormError(`The attachment could not be prepared: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

  }

  const handleImageUpload = async (event) => {
    const [file] = Array.from(event.target.files || [])
    await processFormDocument(file)
    event.target.value = ''
  }

  const handleFormDrop = async (event) => {
    event.preventDefault()
    const [file] = Array.from(event.dataTransfer.files || [])
    await processFormDocument(file)
  }

  const handleDirectDocument = async (cost, file) => {
    const fileError = validateCostDocument(file)
    if (fileError) {
      setFormError(fileError)
      return
    }
    if (!onAttachDocument) {
      setFormError('Document storage is not available. Sign in and try again.')
      return
    }
    setAttachingCostId(cost.costId)
    setFormError('')
    try {
      await onAttachDocument(cost, file)
      setUploadStatus(`${file.name} attached to ${cost.name} and saved as a new version`)
    } catch (error) {
      setFormError(`The document could not be attached: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setAttachingCostId(null)
    }
  }

  const handleOpenAttachment = async (attachment) => {
    if (!onOpenDocument) return
    try {
      await onOpenDocument(attachment)
    } catch (error) {
      setFormError(`The attachment could not be opened: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const renderAttachmentArea = (cost) => (
    <div
      className="cost-attachment-area"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const [file] = Array.from(event.dataTransfer.files || [])
        handleDirectDocument(cost, file)
      }}
    >
      <span className={attachingCostId === cost.costId ? 'loading-indicator' : undefined}>{attachingCostId === cost.costId ? <><span className="spinner" aria-hidden="true" />Uploading…</> : 'Drop PDF or image here'}</span>
      <label className="attachment-picker">
        Choose file
        <input
          className="file-input-hidden"
          type="file"
          aria-label={`Attach file to ${cost.name}`}
          accept="image/*,.pdf"
          disabled={attachingCostId === cost.costId}
          onChange={(event) => {
            const [file] = Array.from(event.target.files || [])
            handleDirectDocument(cost, file)
            event.target.value = ''
          }}
        />
      </label>
      {cost.attachments?.length ? (
        <div className="attachment-list">
          {cost.attachments.map((attachment) => (
            <button key={attachment.documentId || attachment.id || attachment.storagePath || attachment.name} type="button" onClick={() => handleOpenAttachment(attachment)}>
              {attachment.name || 'Open attachment'}
            </button>
          ))}
        </div>
      ) : <small>No attachments</small>}
    </div>
  )

  const renderAttachedChecks = (costId) => {
    const attached = projectChecks.filter((check) => check.costId === costId && check.status !== 'voided')
    return attached.length ? <div className="check-link-summary"><strong>Checks</strong>{attached.map((check) => <span key={check.id}>#{check.checkNumber} · {currency.format(check.amount)} · {check.status}</span>)}</div> : null
  }

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Cost tracking</p>
          <h1>Project costs by phase</h1>
          <p className="hero-copy">Track development, construction, soft costs, and other spending separately with a clear audit history.</p>
        </div>
        <button type="button" className="action-button" onClick={onBack}>Back to dashboard</button>
      </header>

      <nav className="cost-page-nav" aria-label="Cost page sections">
        <button type="button" className="action-button" onClick={handleStartNewCost}>Add a cost</button>
        <button type="button" className="secondary-button" onClick={() => costListRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}>View cost list</button>
        <button type="button" className="secondary-button" onClick={handleShowHistory}>View version history</button>
      </nav>

      {uploadStatus || formError ? (
        <div className={`cost-feedback${formError ? ' error' : ''}`} role={formError ? 'alert' : 'status'} aria-live="polite">
          <span>{formError || uploadStatus}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => {
            setFormError('')
            setUploadStatus('')
          }}>×</button>
        </div>
      ) : null}

      <section className="section-grid">
        <div
          id="cost-editor"
          ref={costEditorRef}
          className={`panel cost-editor-panel${editingCostId ? ' is-editing' : ''}`}
        >
          <div className="panel-header">
            <div>
              <p className="eyebrow">{editingCostId ? 'Editing selected cost' : 'Add cost'}</p>
              <h2>{editingCostId
                ? (costEntryType === 'breakdown' ? 'Edit cost breakdown' : 'Edit project cost')
                : (costEntryType === 'breakdown' ? `New breakdown for ${developmentCosts.find((cost) => cost.costId === parentCostId)?.name || 'cost'}` : 'New project cost')}</h2>
            </div>
          </div>
          <form className="owner-form" noValidate onSubmit={handleAddCost}>
            {editingCostId ? <p className="edit-context">Update the fields below, then choose <strong>Save new version</strong>.</p> : null}
            <label>
              Cost type
              <select aria-label="Cost type" value={costEntryType} onChange={(event) => handleEntryTypeChange(event.target.value)}>
                <option value="cost">Top-level cost</option>
                <option value="breakdown">Cost breakdown</option>
              </select>
            </label>
            {costEntryType === 'breakdown' ? (
              <label>
                Parent cost
                <select aria-label="Parent cost" value={parentCostId || ''} onChange={(event) => applyParentCost(event.target.value)}>
                  {availableParentCosts.length === 0 ? <option value="">No parent costs available</option> : null}
                  {availableParentCosts.map((parent) => {
                    const parentOwner = ownerOptions.find((owner) => owner.id === parent.ownerId)
                    return <option key={parent.costId} value={parent.costId}>{parent.name} — {parentOwner?.name || 'Owner'} — {currency.format(parent.amount)}</option>
                  })}
                </select>
              </label>
            ) : null}
            <label>
              Cost name
              <input ref={costNameInputRef} aria-label="Cost name" required value={costName} onChange={(event) => setCostName(event.target.value)} />
            </label>
            <label>
              Amount
              <input aria-label="Cost amount" type="number" min="0.01" step="0.01" required value={costAmount} onChange={(event) => setCostAmount(event.target.value)} />
            </label>
            <label>
              Cost date
              <input aria-label="Cost date" type="date" required value={costDate} onChange={(event) => setCostDate(event.target.value)} />
            </label>
            <label>
              Phase
              <select aria-label="Cost phase" value={costPhase} onChange={(event) => setCostPhase(event.target.value)}>
                <option value="development">Development</option>
                <option value="construction">Construction</option>
                <option value="soft_cost">Soft Cost</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Owner
              <select aria-label="Owner" value={selectedOwnerId ?? ''} onChange={(event) => setSelectedOwnerId(event.target.value ? Number(event.target.value) : null)}>
                {ownerOptions.length === 0 ? <option value="">Add an owner first</option> : null}
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>{owner.name}</option>
                ))}
              </select>
            </label>
            <div className="form-file-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleFormDrop}>
              <strong>Drop receipt, cost image, or PDF here</strong>
              <span>or choose a file</span>
              <input aria-label="Upload receipt, cost image, or PDF" type="file" accept="image/*,.pdf" onChange={handleImageUpload} />
              {attachments.length ? <small>{attachments.map((attachment) => attachment.name).join(', ')}</small> : null}
            </div>
            <div className="button-row">
              <button type="submit" className="action-button" disabled={savingCost}>{savingCost ? 'Saving…' : (editingCostId ? 'Save new version' : (costEntryType === 'breakdown' ? 'Add breakdown' : 'Add cost'))}</button>
              {editingCostId || costEntryType === 'breakdown' ? <button type="button" className="secondary-button" disabled={savingCost} onClick={handleCancelEdit}>Cancel</button> : null}
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Summary</p>
              <h2>Phase totals</h2>
            </div>
          </div>
          <div className="table-card">
            <div className="table-row total-row">
              <div>
                <strong>Development total</strong>
                <p>All costs in development phase</p>
              </div>
              <div>{currency.format(totalDevelopment)}</div>
            </div>
            <div className="table-row total-row">
              <div>
                <strong>Construction total</strong>
                <p>All costs in construction phase</p>
              </div>
              <div>{currency.format(totalConstruction)}</div>
            </div>
            <div className="table-row total-row">
              <div>
                <strong>Soft Cost total</strong>
                <p>All costs in the soft cost phase</p>
              </div>
              <div>{currency.format(totalSoftCost)}</div>
            </div>
            <div className="table-row total-row">
              <div>
                <strong>Other total</strong>
                <p>Costs assigned to another phase</p>
              </div>
              <div>{currency.format(totalOther)}</div>
            </div>
          </div>
        </div>
      </section>

      <ConstructionDrafts
        drafts={constructionDrafts}
        onSaveDraft={onSaveConstructionDraft}
        onUseDraft={handleUseConstructionDraft}
        onUploadDocument={onUploadDocument}
        onOpenDocument={onOpenDocument}
        sharedDevelopmentCostTotal={sharedDevelopmentCostTotal}
      />

      <section ref={costListRef} className="panel cost-list-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Cost list</p>
            <h2>All tracked costs</h2>
          </div>
        </div>
        <div className="cost-list-toolbar">
          <label>
            Search costs
            <input type="search" aria-label="Search costs" placeholder="Name or owner" value={costSearch} onChange={(event) => setCostSearch(event.target.value)} />
          </label>
          <label>
            Filter by phase
            <select aria-label="Filter costs by phase" value={costPhaseFilter} onChange={(event) => setCostPhaseFilter(event.target.value)}>
              <option value="all">All phases</option>
              <option value="development">Development</option>
              <option value="construction">Construction</option>
              <option value="soft_cost">Soft Cost</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Filter by owner
            <select aria-label="Filter costs by owner" value={costOwnerFilter} onChange={(event) => setCostOwnerFilter(event.target.value)}>
              <option value="all">All owners</option>
              {ownerOptions.map((owner) => <option key={owner.id} value={String(owner.id)}>{owner.name}</option>)}
            </select>
          </label>
          <label className="cost-list-toolbar-secondary">
            Sort breakdowns
            <select aria-label="Sort breakdowns" value={breakdownSort} onChange={(event) => setBreakdownSort(event.target.value)}>
              <option value="amount_desc">Amount: highest first</option>
              <option value="amount_asc">Amount: lowest first</option>
              <option value="date_desc">Date: newest first</option>
              <option value="date_asc">Date: oldest first</option>
              <option value="name_asc">Description: A–Z</option>
              <option value="name_desc">Description: Z–A</option>
            </select>
          </label>
          <div className="cost-filter-summary">
            <span>Showing {filteredDevelopmentCosts.length} of {developmentCosts.length}</span>
            {(costSearch || costPhaseFilter !== 'all' || costOwnerFilter !== 'all') ? (
              <button type="button" className="secondary-button" onClick={() => {
                setCostSearch('')
                setCostPhaseFilter('all')
                setCostOwnerFilter('all')
              }}>Clear filters</button>
            ) : null}
          </div>
        </div>
        <div className="table-card">
          {filteredDevelopmentCosts.map((cost) => {
            const owner = ownerOptions.find((entry) => entry.id === cost.ownerId)
            const children = sortBreakdowns(breakdownCosts.filter((entry) => entry.parentCostId === cost.costId))
            const allocated = children.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
            const remaining = Number(cost.amount || 0) - allocated
            const breakdownsExpanded = expandedBreakdownIds.has(cost.costId)
            return (
              <Fragment key={cost.id}>
                <div className={`table-row cost-parent-row${editingCostId === cost.costId ? ' is-being-edited' : ''}`}>
                  <div className="cost-row-summary">
                    <strong>{cost.name}</strong>
                    <p>{owner?.name || 'Owner'} • {phaseLabel(cost.phase)} • {cost.date}</p>
                  </div>
                  <div className="cost-row-amount">{currency.format(cost.amount)}</div>
                  <div className="button-row cost-row-actions">
                    {children.length ? (
                      <button
                        type="button"
                        className="secondary-button"
                        aria-expanded={breakdownsExpanded}
                        aria-controls={`cost-breakdowns-${cost.costId}`}
                        onClick={() => toggleBreakdowns(cost.costId)}
                      >
                        {breakdownsExpanded ? 'Hide breakdowns' : `Show breakdowns (${children.length})`}
                      </button>
                    ) : null}
                    <button type="button" className="secondary-button" aria-label={`Add breakdown to ${cost.name}`} onClick={() => handleStartBreakdown(cost)}>Add breakdown</button>
                    <button type="button" className="action-button" onClick={() => handleStartEdit(cost)}>Edit cost</button>
                    {pendingDeleteCostId === cost.costId ? (
                      <>
                        <button type="button" className="danger-button" onClick={() => handleConfirmDelete(cost.costId)}>Confirm delete</button>
                        <button type="button" className="secondary-button" onClick={() => setPendingDeleteCostId(null)}>Cancel</button>
                      </>
                    ) : (
                      <button type="button" className="danger-button" onClick={() => setPendingDeleteCostId(cost.costId)}>Delete cost</button>
                    )}
                  </div>
                  <div className="cost-row-details">
                    <small>Breakdown {currency.format(allocated)} • Unallocated {currency.format(remaining)}</small>
                    {renderAttachedChecks(cost.costId)}
                    {renderAttachmentArea(cost)}
                  </div>
                </div>
                {breakdownsExpanded ? <div id={`cost-breakdowns-${cost.costId}`} className="cost-breakdown-group">
                  {children.length >= 2 ? (
                    <div className="breakdown-merge-bar">
                      <span>{children.filter((child) => selectedBreakdownIds.has(child.costId)).length} selected</span>
                      <input
                        aria-label={`Merged breakdown name for ${cost.name}`}
                        placeholder="Merged breakdown name"
                        value={selectedBreakdownParentId === cost.costId ? mergeName : ''}
                        disabled={selectedBreakdownParentId != null && selectedBreakdownParentId !== cost.costId}
                        onChange={(event) => setMergeName(event.target.value)}
                      />
                      <button
                        type="button"
                        className="action-button"
                        disabled={mergingBreakdowns || children.filter((child) => selectedBreakdownIds.has(child.costId)).length < 2}
                        onClick={() => handleMergeSelected(cost)}
                      >
                        {mergingBreakdowns ? 'Merging…' : 'Merge selected'}
                      </button>
                    </div>
                  ) : null}
                  {children.map((child) => {
                    const mergedItems = sortBreakdowns(breakdownCosts.filter((entry) => entry.parentCostId === child.costId))
                    const mergedItemsExpanded = expandedBreakdownIds.has(child.costId)
                    const eligibleGroupItems = children.filter((candidate) => (
                      candidate.costId !== child.costId
                      && !breakdownCosts.some((entry) => entry.parentCostId === candidate.costId)
                    ))
                    const addItemsExpanded = addingToGroupId === child.costId
                    return <Fragment key={child.id}>
                      <div className={`table-row cost-breakdown-row${editingCostId === child.costId ? ' is-being-edited' : ''}`}>
                        <div className="cost-row-summary">
                          {mergedItems.length ? (
                            <strong>↳ {child.name}</strong>
                          ) : (
                            <label className="breakdown-select-control">
                              <input
                                type="checkbox"
                                aria-label={`Select ${child.name} for merge`}
                                checked={selectedBreakdownIds.has(child.costId)}
                                disabled={selectedBreakdownParentId != null && selectedBreakdownParentId !== cost.costId}
                                onChange={() => toggleBreakdownSelection(child, cost)}
                              />
                              <strong>↳ {child.name}</strong>
                            </label>
                          )}
                          <p>{mergedItems.length ? 'Merged breakdown total' : `Breakdown of ${cost.name}`} • {phaseLabel(child.phase)} • {child.date}</p>
                        </div>
                        <div className="cost-row-amount">{currency.format(child.amount)}</div>
                        <div className="button-row cost-row-actions">
                          {mergedItems.length ? (
                            <>
                              <button type="button" className="secondary-button" aria-expanded={mergedItemsExpanded} onClick={() => toggleBreakdowns(child.costId)}>
                                {mergedItemsExpanded ? 'Hide merged items' : `Show merged items (${mergedItems.length})`}
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                aria-expanded={addItemsExpanded}
                                aria-label={`Add items to ${child.name}`}
                                onClick={() => {
                                  setAddingToGroupId(addItemsExpanded ? null : child.costId)
                                  setGroupItemIds(new Set())
                                }}
                              >
                                Add items
                              </button>
                              {pendingUnmergeGroupId === child.costId ? (
                                <>
                                  <button type="button" className="danger-button" disabled={updatingGroup} onClick={() => handleUnmergeGroup(child)}>
                                    {updatingGroup ? 'Unmerging…' : 'Confirm unmerge'}
                                  </button>
                                  <button type="button" className="secondary-button" disabled={updatingGroup} onClick={() => setPendingUnmergeGroupId(null)}>Cancel</button>
                                </>
                              ) : (
                                <button type="button" className="secondary-button" onClick={() => setPendingUnmergeGroupId(child.costId)}>Unmerge</button>
                              )}
                            </>
                          ) : null}
                          <button type="button" className="action-button" onClick={() => handleStartEdit(child)}>{mergedItems.length ? 'Edit group' : 'Edit breakdown'}</button>
                          {pendingDeleteCostId === child.costId ? (
                            <>
                              <button type="button" className="danger-button" onClick={() => handleConfirmDelete(child.costId)}>Confirm delete</button>
                              <button type="button" className="secondary-button" onClick={() => setPendingDeleteCostId(null)}>Cancel</button>
                            </>
                          ) : (
                            <button type="button" className="danger-button" onClick={() => setPendingDeleteCostId(child.costId)}>{mergedItems.length ? 'Delete group' : 'Delete breakdown'}</button>
                          )}
                        </div>
                        <div className="cost-row-details">
                          {renderAttachedChecks(child.costId)}
                          {renderAttachmentArea(child)}
                        </div>
                      </div>
                      {addItemsExpanded ? <div className="breakdown-group-editor">
                        <strong>Add existing breakdowns to {child.name}</strong>
                        {eligibleGroupItems.length ? (
                          <>
                            <div className="breakdown-group-options">
                              {eligibleGroupItems.map((item) => (
                                <label key={item.costId} className="breakdown-group-option">
                                  <input
                                    type="checkbox"
                                    aria-label={`Add ${item.name} to ${child.name}`}
                                    checked={groupItemIds.has(item.costId)}
                                    onChange={() => toggleGroupItemSelection(item.costId)}
                                  />
                                  <span><strong>{item.name}</strong><small>{item.date} · {currency.format(item.amount)}</small></span>
                                </label>
                              ))}
                            </div>
                            <div className="button-row">
                              <button type="button" className="action-button" disabled={updatingGroup || groupItemIds.size === 0} onClick={() => handleAddSelectedToGroup(child)}>
                                {updatingGroup ? 'Adding…' : `Add selected to group (${groupItemIds.size})`}
                              </button>
                              <button type="button" className="secondary-button" disabled={updatingGroup} onClick={() => {
                                setAddingToGroupId(null)
                                setGroupItemIds(new Set())
                              }}>Cancel</button>
                            </div>
                          </>
                        ) : <p>No ungrouped breakdowns are available under this parent cost.</p>}
                      </div> : null}
                      {mergedItemsExpanded ? <div className="merged-breakdown-items">
                        {mergedItems.map((item) => (
                          <div key={item.id} className={`table-row cost-breakdown-row merged-breakdown-item-row${editingCostId === item.costId ? ' is-being-edited' : ''}`}>
                            <div className="cost-row-summary">
                              <strong>↳↳ {item.name}</strong>
                              <p>Individual item • {phaseLabel(item.phase)} • {item.date}</p>
                            </div>
                            <div className="cost-row-amount">{currency.format(item.amount)}</div>
                            <div className="button-row cost-row-actions">
                              <button type="button" className="action-button" onClick={() => handleStartEdit(item)}>Edit item</button>
                            </div>
                            <div className="cost-row-details">
                              {renderAttachedChecks(item.costId)}
                              {renderAttachmentArea(item)}
                            </div>
                          </div>
                        ))}
                      </div> : null}
                    </Fragment>
                  })}
                </div> : null}
              </Fragment>
            )
          })}
          {developmentCosts.length === 0 ? (
            <div className="cost-empty-state">
              <strong>No costs have been added yet</strong>
              <p>Add the first project cost, then create detailed breakdowns under it.</p>
              <button type="button" className="action-button" onClick={handleStartNewCost}>Add the first cost</button>
            </div>
          ) : filteredDevelopmentCosts.length === 0 ? (
            <div className="cost-empty-state">
              <strong>No costs match these filters</strong>
              <p>Adjust the filters above or choose Clear filters to see all saved project costs.</p>
            </div>
          ) : null}
        </div>
      </section>

      <section ref={historyRef} className="panel cost-history-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Audit history</p>
            <h2>Cost versions</h2>
          </div>
          <button
            type="button"
            className="secondary-button"
            aria-expanded={showVersionHistory}
            aria-controls="cost-version-history"
            onClick={() => setShowVersionHistory((current) => !current)}
          >
            {showVersionHistory ? 'Hide version history' : `Show version history (${sortedVersions.length})`}
          </button>
        </div>
        {showVersionHistory ? (
          <div id="cost-version-history" className="table-card">
            {sortedVersions.map((cost) => (
              <div key={cost.id} className={`table-row ${cost.deletedAt ? 'deleted-row' : ''}`}>
                <div>
                  <strong>{cost.name} · v{cost.version || 1}</strong>
                  <p>{cost.date || 'No date'} • {phaseLabel(cost.phase)}{cost.deletedAt ? ` • Deleted ${cost.deletedAt.slice(0, 10)}` : ''}</p>
                </div>
                <div>{currency.format(cost.amount)}</div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  )
}

export default CostPage
