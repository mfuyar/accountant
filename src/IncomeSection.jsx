import { useEffect, useMemo, useState } from 'react'
import { extractLoanDrawFromDocument } from './lib/gemini'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

const lotKeys = ['Lot 2', 'Lot 3', 'Lot 4']
const emptyLotAmounts = { 'Lot 2': '', 'Lot 3': '', 'Lot 4': '' }
const emptyChecks = []

const validateDrawSheet = (file) => {
  if (!file) return 'Choose an image or PDF draw sheet before uploading.'
  const supported = file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!supported) return 'Draw sheets must be images or PDFs.'
  if (file.size > 10 * 1024 * 1024) return 'Choose a document smaller than 10 MB.'
  return ''
}

const lotAmountsTotal = (lotAmounts) => lotKeys.reduce((sum, lot) => sum + (Number(lotAmounts[lot]) || 0), 0)

function IncomeSection({ incomes, checks = emptyChecks, projects, onAddIncome, onEditIncome, onDeleteIncome, onUploadDocument, onOpenDocument }) {
  const [description, setDescription] = useState('')
  const [source, setSource] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [type, setType] = useState('project_income')
  const [projectId, setProjectId] = useState(() => projects[0]?.id ?? '')
  const [lotAmounts, setLotAmounts] = useState(emptyLotAmounts)
  const [drawDocument, setDrawDocument] = useState(null)
  const [uploadingDrawSheet, setUploadingDrawSheet] = useState(false)
  const [editingIncomeId, setEditingIncomeId] = useState(null)
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [expandedIncomeId, setExpandedIncomeId] = useState(null)
  const [error, setError] = useState('')
  const [uploadStatus, setUploadStatus] = useState('')

  const drawSpentTotals = useMemo(() => {
    const totals = {}
    checks.forEach((check) => {
      if (check.status === 'voided' || check.fundedByIncomeId == null) return
      totals[check.fundedByIncomeId] = (totals[check.fundedByIncomeId] || 0) + Number(check.amount || 0)
    })
    return totals
  }, [checks])

  const drawJobs = useMemo(() => {
    const byDraw = {}
    checks.forEach((check) => {
      if (check.status === 'voided' || check.fundedByIncomeId == null) return
      if (!byDraw[check.fundedByIncomeId]) byDraw[check.fundedByIncomeId] = []
      byDraw[check.fundedByIncomeId].push(check)
    })
    return byDraw
  }, [checks])


  const totalIncome = useMemo(() => {
    return incomes.reduce((sum, income) => sum + Number(income.amount || 0), 0)
  }, [incomes])

  useEffect(() => {
    setProjectId((current) => projects.some((project) => String(project.id) === String(current)) ? current : projects[0]?.id ?? '')
  }, [projects])

  const resetForm = () => {
    setDescription('')
    setSource('')
    setAmount('')
    setDate('')
    setType('project_income')
    setProjectId(projects[0]?.id ?? '')
    setLotAmounts(emptyLotAmounts)
    setDrawDocument(null)
    setEditingIncomeId(null)
    setError('')
    setUploadStatus('')
  }

  const setLotAmount = (lot, value) => setLotAmounts((current) => ({ ...current, [lot]: value }))

  const splitLotsEvenly = () => {
    const numericAmount = Number(amount)
    if (amount === '' || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter a valid income amount before splitting it evenly across lots.')
      return
    }
    const share = Math.round((numericAmount / 3) * 100) / 100
    const lastShare = Math.round((numericAmount - share * 2) * 100) / 100
    setLotAmounts({ 'Lot 2': String(share), 'Lot 3': String(share), 'Lot 4': String(lastShare) })
    setError('')
  }

  const handleDrawSheetUpload = async (event) => {
    const [file] = Array.from(event.target.files || [])
    event.target.value = ''
    const fileError = validateDrawSheet(file)
    if (fileError) {
      setError(fileError)
      return
    }
    setError('')
    setUploadStatus('')
    setUploadingDrawSheet(true)
    try {
      const storedDocument = onUploadDocument ? await onUploadDocument(file) : null
      if (storedDocument) {
        setDrawDocument({
          ...storedDocument,
          id: storedDocument.documentId,
          name: storedDocument.name || file.name,
          uploadedAt: new Date().toISOString(),
        })
      }
      const extracted = await extractLoanDrawFromDocument(file)
      const filledFields = []
      if (Number.isFinite(Number(extracted.totalAmount)) && Number(extracted.totalAmount) > 0) {
        setAmount((current) => current === '' ? String(extracted.totalAmount) : current)
        filledFields.push('amount')
      }
      if (extracted.date) {
        setDate((current) => current || extracted.date)
        filledFields.push('date')
      }
      if (extracted.lender) {
        setSource((current) => current.trim() ? current : extracted.lender)
        filledFields.push('lender')
      }
      if (extracted.drawNumber) {
        setDescription((current) => current.trim() ? current : `Draw ${extracted.drawNumber}`)
        filledFields.push('draw number')
      }
      if (Array.isArray(extracted.lots) && extracted.lots.length) {
        setLotAmounts((current) => {
          const next = { ...current }
          extracted.lots.forEach((entry) => {
            if (lotKeys.includes(entry.lot) && Number.isFinite(Number(entry.amount))) next[entry.lot] = String(entry.amount)
          })
          return next
        })
        filledFields.push('lot amounts')
      }
      setUploadStatus(filledFields.length
        ? `Uploaded ${file.name} and filled in: ${filledFields.join(', ')}. Review before saving.`
        : `Uploaded ${file.name}, but Gemini couldn't read any fields from it${extracted.notes ? ` — ${extracted.notes}` : ''}. Enter the amount, date, and lot breakdown manually.`)
    } catch (uploadError) {
      setError(`The draw sheet could not be processed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`)
    } finally {
      setUploadingDrawSheet(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!description.trim()) {
      setError('Enter a description for this income.')
      return
    }
    if (!source.trim()) {
      setError('Enter who or where the income was received from.')
      return
    }
    const numericAmount = Number(amount)
    if (amount === '' || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter a valid income amount greater than 0.')
      return
    }
    if (!date) {
      setError('Select the date the income was received.')
      return
    }
    if (projectId === '') {
      setError('Add and select a project before saving income.')
      return
    }

    let lotBreakdown = []
    if (type === 'loan_draw') {
      lotBreakdown = lotKeys.map((lot) => ({ lot, amount: Number(lotAmounts[lot]) || 0 }))
      const lotsTotal = lotAmountsTotal(lotAmounts)
      if (Math.abs(lotsTotal - numericAmount) > 0.01) {
        setError(`The lot breakdown (${currency.format(lotsTotal)}) must add up to the total draw amount (${currency.format(numericAmount)}).`)
        return
      }
    }

    const payload = {
      description: description.trim(),
      source: source.trim(),
      amount: numericAmount,
      date,
      type,
      projectId: Number(projectId),
      lotBreakdown,
      attachments: drawDocument ? [drawDocument] : [],
    }

    try {
      if (editingIncomeId != null) {
        await onEditIncome(editingIncomeId, payload)
      } else {
        await onAddIncome(payload)
      }
    } catch (saveError) {
      setError(`The income could not be saved: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`)
      return
    }
    resetForm()
  }

  const handleDelete = async (incomeId) => {
    try {
      await onDeleteIncome(incomeId)
      setPendingDeleteId(null)
    } catch (deleteError) {
      setError(`The income could not be deleted: ${deleteError instanceof Error ? deleteError.message : 'Unknown error'}`)
    }
  }

  const handleEdit = (income) => {
    setEditingIncomeId(income.id)
    setDescription(income.description)
    setSource(income.source)
    setAmount(String(income.amount))
    setDate(income.date)
    setType(income.type)
    setProjectId(income.projectId)
    const nextLotAmounts = { ...emptyLotAmounts }
    ;(income.lotBreakdown || []).forEach((entry) => {
      if (lotKeys.includes(entry.lot)) nextLotAmounts[entry.lot] = entry.amount ? String(entry.amount) : ''
    })
    setLotAmounts(nextLotAmounts)
    setDrawDocument(income.attachments?.[0] || null)
    setError('')
  }

  const openDrawDocument = async (attachment) => {
    if (!onOpenDocument) return
    try {
      await onOpenDocument(attachment)
    } catch (openError) {
      setError(`The draw sheet could not be opened: ${openError instanceof Error ? openError.message : 'Unknown error'}`)
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Money received</p>
          <h2>Income</h2>
        </div>
        <div className="metric-stack">
          <span>Total income</span>
          <strong>{currency.format(totalIncome)}</strong>
        </div>
      </div>

      <div className="section-grid">
        <form className="owner-form" noValidate onSubmit={handleSubmit}>
          <label>
            Description
            <input aria-label="Income description" required value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label>
            Received from
            <input aria-label="Income source" required value={source} onChange={(event) => setSource(event.target.value)} />
          </label>
          <label>
            Amount
            <input aria-label="Income amount" type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label>
            Date received
            <input aria-label="Income date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Project
            <select aria-label="Income project" required value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.length === 0 ? <option value="">Add a project first</option> : null}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            Income type
            <select aria-label="Income type" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="project_income">Project income</option>
              <option value="loan_draw">Loan draw</option>
              <option value="refund">Refund</option>
              <option value="reimbursement">Reimbursement</option>
              <option value="other">Other</option>
            </select>
          </label>
          {type === 'loan_draw' ? (
            <div className="wide-field loan-draw-fields">
              <label className="loan-draw-upload">Upload draw sheet
                <input aria-label="Upload loan draw sheet" type="file" accept="image/*,.pdf" disabled={uploadingDrawSheet} onChange={handleDrawSheetUpload} />
              </label>
              {uploadingDrawSheet ? <span className="loading-indicator"><span className="spinner" aria-hidden="true" />Reading the draw sheet…</span> : null}
              {drawDocument ? <span>Attached: {drawDocument.name}</span> : null}
              {!uploadingDrawSheet && uploadStatus ? <span role="status">{uploadStatus}</span> : null}
              <div className="loan-draw-lots">
                <div className="loan-draw-lots-header">
                  <span>Lot breakdown (must total the amount above, kept for audit)</span>
                  <button type="button" className="secondary-button" onClick={splitLotsEvenly}>Split evenly</button>
                </div>
                {lotKeys.map((lot) => (
                  <label key={lot}>{lot}
                    <input aria-label={`${lot} draw amount`} type="number" min="0" step="0.01" value={lotAmounts[lot]} onChange={(event) => setLotAmount(lot, event.target.value)} />
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {error ? <p className="validation-error" role="alert">{error}</p> : null}
          <div className="button-row">
            <button type="submit" className="action-button">{editingIncomeId != null ? 'Save income changes' : 'Add income'}</button>
            {editingIncomeId != null ? <button type="button" className="secondary-button" onClick={resetForm}>Cancel</button> : null}
          </div>
        </form>

        <div className="table-card">
          {incomes.length === 0 ? (
            <div className="table-row">
              <div>
                <strong>No income recorded</strong>
                <p>Add the first income entry using the form.</p>
              </div>
            </div>
          ) : null}
          {incomes.map((income) => {
            const project = projects.find((entry) => Number(entry.id) === Number(income.projectId))
            const isLoanDraw = income.type === 'loan_draw'
            const isExpanded = expandedIncomeId === income.id
            return <div key={income.id} className="table-row loan-draw-row">
              <div className="loan-draw-row-main">
                <div>
                  <strong>{income.description}</strong>
                  <p>{project?.name || 'Unknown project'} • {income.source} • {income.date} • {income.type.replace('_', ' ')}</p>
                </div>
                <div>{currency.format(income.amount)}</div>
                <div className="button-row">
                  {isLoanDraw ? <button type="button" className="secondary-button" onClick={() => setExpandedIncomeId(isExpanded ? null : income.id)}>{isExpanded ? 'Hide draw details' : 'View draw details'}</button> : null}
                  <button type="button" className="secondary-button" onClick={() => handleEdit(income)}>Edit income</button>
                  {pendingDeleteId === income.id ? (
                    <>
                      <button type="button" className="danger-button" onClick={() => handleDelete(income.id)}>Confirm delete</button>
                      <button type="button" className="secondary-button" onClick={() => setPendingDeleteId(null)}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" className="danger-button" onClick={() => setPendingDeleteId(income.id)}>Delete income</button>
                  )}
                </div>
              </div>
              {isLoanDraw && isExpanded ? (
                <div className="loan-draw-details">
                  {(income.lotBreakdown || []).map((entry) => (
                    <span key={entry.lot}>{entry.lot}: {currency.format(entry.amount || 0)}</span>
                  ))}
                  <span>Spent so far: {currency.format(drawSpentTotals[income.id] || 0)}</span>
                  <span>Left from this draw: {currency.format(income.amount - (drawSpentTotals[income.id] || 0))}</span>
                  {onOpenDocument && income.attachments?.[0] ? <button type="button" className="secondary-button" onClick={() => openDrawDocument(income.attachments[0])}>Open draw sheet</button> : null}
                  <div className="loan-draw-jobs">
                    <strong>Jobs paid from this draw</strong>
                    {drawJobs[income.id]?.length ? (
                      <ul>
                        {drawJobs[income.id].map((check) => (
                          <li key={check.id}>
                            <span>#{check.checkNumber} · {check.payee}{check.memo ? ` · ${check.memo}` : ''}{check.lot ? ` · ${check.lot}` : ''}</span>
                            <span>{currency.format(check.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <p>No checks tagged to this draw yet.</p>}
                  </div>
                </div>
              ) : null}
            </div>
          })}
        </div>
      </div>
    </section>
  )
}

export default IncomeSection
