import { useEffect, useMemo, useRef, useState } from 'react'
import { extractLoanDrawFromDocument, extractTransactionFromImage } from './lib/gemini'
import { summarizePreSaleDepositActivities } from './lib/developmentFunding'
import { providenceLoanAccountLabel } from './lib/providenceLoanAccounts'
import { currency } from './lib/currency'

const lotKeys = ['Lot 2', 'Lot 3', 'Lot 4']
const emptyLotAmounts = { 'Lot 2': '', 'Lot 3': '', 'Lot 4': '' }
const emptyLotDetails = { 'Lot 2': {}, 'Lot 3': {}, 'Lot 4': {} }
const emptyChecks = []
const emptyCommitments = []
const depositActivityLabels = {
  receipt: 'Deposit installment received',
  application: 'Applied to project',
  cancellation: 'Agreement cancelled',
  refund: 'Refunded to buyer',
  adjustment_increase: 'Balance increase',
  adjustment_decrease: 'Balance decrease',
}

const validateIncomeDocument = (file) => {
  if (!file) return 'Choose an image or PDF document before uploading.'
  const supported = file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!supported) return 'Income documents must be images or PDFs.'
  if (file.size > 10 * 1024 * 1024) return 'Choose a document smaller than 10 MB.'
  return ''
}

const lotAmountsTotal = (lotAmounts) => lotKeys.reduce((sum, lot) => sum + (Number(lotAmounts[lot]) || 0), 0)
const incomeTypeLabel = (income) => income.type === 'pre_sale_deposit' ? 'pre-sale deposit · applied to development' : income.type.replaceAll('_', ' ')

function IncomeSection({ incomes, checks = emptyChecks, projects, lotCommitments = emptyCommitments, onAddIncome, onEditIncome, onDeleteIncome, onUploadDocument, onOpenDocument }) {
  const [description, setDescription] = useState('')
  const [source, setSource] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [type, setType] = useState('project_income')
  const [projectId, setProjectId] = useState(() => projects[0]?.id ?? '')
  const [lotAmounts, setLotAmounts] = useState(emptyLotAmounts)
  const [lotDetails, setLotDetails] = useState(emptyLotDetails)
  const [drawDocument, setDrawDocument] = useState(null)
  const [uploadingDrawSheet, setUploadingDrawSheet] = useState(false)
  const [editingIncomeId, setEditingIncomeId] = useState(null)
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [expandedIncomeId, setExpandedIncomeId] = useState(null)
  const [activityIncomeId, setActivityIncomeId] = useState(null)
  const [editingActivityId, setEditingActivityId] = useState(null)
  const [relatedActivityId, setRelatedActivityId] = useState(null)
  const [pendingActivityDeleteId, setPendingActivityDeleteId] = useState(null)
  const [activityType, setActivityType] = useState('receipt')
  const [activityAmount, setActivityAmount] = useState('')
  const [activityDate, setActivityDate] = useState('')
  const [activityDescription, setActivityDescription] = useState('')
  const [activityLot, setActivityLot] = useState('')
  const [activityDocument, setActivityDocument] = useState(null)
  const [uploadingActivityDocument, setUploadingActivityDocument] = useState(false)
  const [analyzingActivityDocument, setAnalyzingActivityDocument] = useState(false)
  const [activityAnalysisStatus, setActivityAnalysisStatus] = useState('')
  const [savingActivity, setSavingActivity] = useState(false)
  const [error, setError] = useState('')
  const [uploadStatus, setUploadStatus] = useState('')
  const activityFormRef = useRef(null)

  const drawSpentTotals = useMemo(() => {
    const totals = {}
    checks.forEach((check) => {
      if (check.status === 'voided' || check.checkType === 'internal_transfer' || check.fundedByIncomeId == null) return
      totals[check.fundedByIncomeId] = (totals[check.fundedByIncomeId] || 0) + Number(check.amount || 0)
    })
    return totals
  }, [checks])

  const drawJobs = useMemo(() => {
    const byDraw = {}
    checks.forEach((check) => {
      if (check.status === 'voided' || check.checkType === 'internal_transfer' || check.fundedByIncomeId == null) return
      if (!byDraw[check.fundedByIncomeId]) byDraw[check.fundedByIncomeId] = []
      byDraw[check.fundedByIncomeId].push(check)
    })
    return byDraw
  }, [checks])


  const totalIncome = useMemo(() => {
    return incomes.reduce((sum, income) => sum + Number(income.amount || 0), 0)
  }, [incomes])

  const drawPlan = useMemo(() => {
    const draws = incomes.filter((income) => income.type === 'loan_draw')
    const lots = lotKeys.map((lot) => {
      const drawEntries = draws.flatMap((draw) => (draw.lotBreakdown || []).filter((entry) => entry.lot === lot))
      const detail = drawEntries.find((entry) => Number(entry.constructionAvailable) > 0) || {}
      const commitment = lotCommitments.find((entry) => entry.lot === lot)
      const available = Number(detail.constructionAvailable || commitment?.commitmentAmount || 0)
      const advanced = drawEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
      return {
        lot,
        address: detail.address || commitment?.address || '',
        available,
        advanced,
        completed: Number(detail.completionPercentage || 0),
      }
    })
    const available = lots.reduce((sum, lot) => sum + lot.available, 0)
    const advanced = draws.reduce((sum, draw) => sum + Number(draw.amount || 0), 0)
    return { draws, lots, available, advanced }
  }, [incomes, lotCommitments])

  useEffect(() => {
    setProjectId((current) => projects.some((project) => String(project.id) === String(current)) ? current : projects[0]?.id ?? '')
  }, [projects])

  useEffect(() => {
    if (activityIncomeId == null) return undefined
    const timer = window.setTimeout(() => {
      activityFormRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      activityFormRef.current?.querySelector('input:not(:disabled), select, textarea')?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activityIncomeId, editingActivityId, relatedActivityId])

  const resetForm = () => {
    setDescription('')
    setSource('')
    setAmount('')
    setDate('')
    setType('project_income')
    setProjectId(projects[0]?.id ?? '')
    setLotAmounts(emptyLotAmounts)
    setLotDetails(emptyLotDetails)
    setDrawDocument(null)
    setEditingIncomeId(null)
    setError('')
    setUploadStatus('')
  }

  const resetActivityForm = () => {
    setActivityIncomeId(null)
    setEditingActivityId(null)
    setRelatedActivityId(null)
    setActivityType('receipt')
    setActivityAmount('')
    setActivityDate('')
    setActivityDescription('')
    setActivityLot('')
    setActivityDocument(null)
    setUploadingActivityDocument(false)
    setAnalyzingActivityDocument(false)
    setActivityAnalysisStatus('')
  }

  const startDepositActivity = (income) => {
    setExpandedIncomeId(income.id)
    setActivityIncomeId(income.id)
    setEditingActivityId(null)
    setRelatedActivityId(null)
    setActivityType('receipt')
    setActivityAmount('')
    setActivityDate(new Date().toLocaleDateString('en-CA'))
    setActivityDescription('')
    setActivityLot(income.lotBreakdown?.length === 1 ? income.lotBreakdown[0].lot : '')
    setActivityDocument(null)
    setActivityAnalysisStatus('')
    setError('')
  }

  const startEditDepositActivity = (income, activity) => {
    setExpandedIncomeId(income.id)
    setActivityIncomeId(income.id)
    setEditingActivityId(activity.id)
    setRelatedActivityId(activity.relatedActivityId || null)
    setActivityType(activity.type)
    setActivityAmount(activity.type === 'cancellation' ? '' : String(activity.amount || ''))
    setActivityDate(activity.date || '')
    setActivityDescription(activity.description || '')
    setActivityLot(activity.lot || '')
    setActivityDocument(activity.attachment || null)
    setActivityAnalysisStatus('')
    setPendingActivityDeleteId(null)
    setError('')
  }

  const startReceiptFollowUp = (income, receipt, nextType) => {
    const refundedForReceipt = (income.activities || [])
      .filter((entry) => entry.type === 'refund' && String(entry.relatedActivityId) === String(receipt.id))
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
    const refundableBalance = Math.max(0, Number(receipt.amount || 0) - refundedForReceipt)
    setExpandedIncomeId(income.id)
    setActivityIncomeId(income.id)
    setEditingActivityId(null)
    setRelatedActivityId(receipt.id)
    setActivityType(nextType)
    setActivityAmount(nextType === 'refund' ? String(refundableBalance || '') : '')
    setActivityDate(new Date().toLocaleDateString('en-CA'))
    setActivityDescription(`${nextType === 'refund' ? 'Refund payment' : 'Cancellation'} for ${receipt.description}`)
    setActivityLot(receipt.lot || '')
    setActivityDocument(null)
    setActivityAnalysisStatus('')
    setPendingActivityDeleteId(null)
    setError('')
  }

  const handleActivityDocument = async (event) => {
    const [file] = Array.from(event.target.files || [])
    event.target.value = ''
    if (!file) return
    if (!(file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
      setError('Deposit activity documents must be an image or PDF.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Choose a deposit activity document smaller than 10 MB.')
      return
    }
    if (!onUploadDocument) {
      setError('Document storage is unavailable. Sign in and try again.')
      return
    }
    setUploadingActivityDocument(true)
    setActivityAnalysisStatus('')
    setError('')
    try {
      const stored = await onUploadDocument(file)
      setActivityDocument({ ...stored, id: stored.documentId, name: stored.name || file.name, uploadedAt: new Date().toISOString() })
      setUploadingActivityDocument(false)
      setAnalyzingActivityDocument(true)
      try {
        const income = incomes.find((entry) => String(entry.id) === String(activityIncomeId))
        const project = projects.find((entry) => String(entry.id) === String(income?.projectId))
        const extracted = await extractTransactionFromImage(file, project?.name || 'Project', income?.projectId, {
          knownLots: ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4'],
        })
        const extractedAmount = Number(extracted?.amount)
        const combinedDetails = [extracted?.details, extracted?.description, extracted?.reference ? `Reference: ${extracted.reference}` : '', extracted?.notes]
          .map((value) => String(value || '').trim()).filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join('\n')
        const analysisText = `${file.name} ${combinedDetails}`.toLowerCase()
        if (Number.isFinite(extractedAmount) && extractedAmount > 0) setActivityAmount((current) => current || String(extractedAmount))
        if (extracted?.date) setActivityDate(extracted.date)
        if (combinedDetails) setActivityDescription((current) => current.trim() ? current : combinedDetails)
        if (['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4'].includes(extracted?.lot)) setActivityLot((current) => current || extracted.lot)
        if (/refund|returned to buyer/.test(analysisText)) setActivityType('refund')
        else if (/cancellation agreement|agreement cancel(?:led|ation)|buyer cancellation|cancelled contract/.test(analysisText)) setActivityType('cancellation')
        else if (/increase|additional deposit/.test(analysisText)) setActivityType('adjustment_increase')
        else if (/decrease|correction|write.?down/.test(analysisText)) setActivityType('adjustment_decrease')
        else if (/applied|application|utilized|used for/.test(analysisText)) setActivityType('application')
        else if (/deposit|counter credit|wire in|incoming funds/.test(analysisText)) setActivityType('receipt')
        const filled = [
          Number.isFinite(extractedAmount) && extractedAmount > 0 ? 'amount' : '', extracted?.date ? 'date' : '',
          combinedDetails ? 'details' : '', extracted?.lot ? 'lot' : '',
        ].filter(Boolean)
        setActivityAnalysisStatus(filled.length ? `Attachment analyzed: filled ${filled.join(', ')}. Review before saving.` : 'Attachment saved, but no activity details could be read. Enter them manually.')
      } catch (analysisError) {
        setActivityAnalysisStatus(`Attachment saved, but analysis was unavailable: ${analysisError instanceof Error ? analysisError.message : 'Unknown error'}`)
      } finally {
        setAnalyzingActivityDocument(false)
      }
    } catch (uploadError) {
      setError(`The activity document could not be uploaded: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`)
    } finally {
      setUploadingActivityDocument(false)
    }
  }

  const handleSaveDepositActivity = async (income, event) => {
    event.preventDefault()
    const isCancellation = activityType === 'cancellation'
    const numericAmount = isCancellation ? 0 : Number(activityAmount)
    if (!isCancellation && (activityAmount === '' || !Number.isFinite(numericAmount) || numericAmount <= 0)) {
      setError('Enter a deposit activity amount greater than 0.')
      return
    }
    if (!activityDate) {
      setError('Select the deposit activity date.')
      return
    }
    if (!activityDescription.trim()) {
      setError('Describe the deposit activity.')
      return
    }
    if (isCancellation && !activityDocument) {
      setError('Attach the signed cancellation document before saving the cancellation.')
      return
    }
    const existingActivity = (income.activities || []).find((entry) => String(entry.id) === String(editingActivityId))
    const activity = {
      ...(existingActivity || {}),
      id: editingActivityId || globalThis.crypto?.randomUUID?.() || `activity-${Date.now()}`,
      type: activityType,
      amount: numericAmount,
      date: activityDate,
      description: activityDescription.trim(),
      lot: activityLot || null,
      attachment: activityDocument,
      relatedActivityId: relatedActivityId || existingActivity?.relatedActivityId || null,
      recordedAt: existingActivity?.recordedAt || new Date().toISOString(),
      ...(editingActivityId ? { updatedAt: new Date().toISOString() } : {}),
    }
    const activities = editingActivityId
      ? (income.activities || []).map((entry) => String(entry.id) === String(editingActivityId) ? activity : entry)
      : [...(income.activities || []), activity]
    const payload = {
      projectId: Number(income.projectId),
      description: income.description,
      source: income.source,
      amount: Number(income.amount),
      date: income.date,
      type: 'pre_sale_deposit',
      lotBreakdown: income.lotBreakdown || [],
      activities,
      attachments: income.attachments || [],
    }
    const nextSummary = summarizePreSaleDepositActivities({ ...income, activities })
    if (activityType === 'receipt' && nextSummary.received > Number(income.amount)) {
      setError(`Documented installments exceed the original deposit by ${currency.format(nextSummary.received - Number(income.amount))}.`)
      return
    }
    if (nextSummary.remaining < 0) {
      setError(`This activity exceeds the available deposit balance by ${currency.format(Math.abs(nextSummary.remaining))}.`)
      return
    }
    if (activityType === 'refund' && relatedActivityId) {
      const relatedReceipt = activities.find((entry) => entry.type === 'receipt' && String(entry.id) === String(relatedActivityId))
      const linkedRefundTotal = activities
        .filter((entry) => entry.type === 'refund' && String(entry.relatedActivityId) === String(relatedActivityId))
        .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
      if (relatedReceipt && linkedRefundTotal > Number(relatedReceipt.amount || 0)) {
        setError(`Refund payments for this buyer exceed the received deposit by ${currency.format(linkedRefundTotal - Number(relatedReceipt.amount || 0))}.`)
        return
      }
    }
    setSavingActivity(true)
    setError('')
    try {
      if (income.derivedFromCost) await onAddIncome(payload)
      else await onEditIncome(income.id, payload)
      resetActivityForm()
      setExpandedIncomeId(income.id)
    } catch (saveError) {
      setError(`The deposit activity could not be saved: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`)
    } finally {
      setSavingActivity(false)
    }
  }

  const handleRemoveDepositActivity = async (income, activity) => {
    const activities = (income.activities || []).filter((entry) => String(entry.id) !== String(activity.id))
    const payload = {
      projectId: Number(income.projectId),
      description: income.description,
      source: income.source,
      amount: Number(income.amount),
      date: income.date,
      type: 'pre_sale_deposit',
      lotBreakdown: income.lotBreakdown || [],
      activities,
      attachments: income.attachments || [],
    }
    setSavingActivity(true)
    setError('')
    try {
      if (income.derivedFromCost) await onAddIncome(payload)
      else await onEditIncome(income.id, payload)
      if (String(editingActivityId) === String(activity.id)) resetActivityForm()
      setPendingActivityDeleteId(null)
      setExpandedIncomeId(income.id)
    } catch (removeError) {
      setError(`The deposit activity could not be removed: ${removeError instanceof Error ? removeError.message : 'Unknown error'}`)
    } finally {
      setSavingActivity(false)
    }
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
    const fileError = validateIncomeDocument(file)
    if (fileError) {
      setError(fileError)
      return
    }
    if (!onUploadDocument) {
      setError('Document storage is unavailable. Sign in before attaching an income document.')
      return
    }
    setError('')
    setUploadStatus('')
    setUploadingDrawSheet(true)
    try {
      const storedDocument = await onUploadDocument(file)
      if (storedDocument) {
        setDrawDocument({
          ...storedDocument,
          id: storedDocument.documentId,
          name: storedDocument.name || file.name,
          uploadedAt: new Date().toISOString(),
        })
      }
      if (type !== 'loan_draw') {
        setUploadStatus(`Attached ${file.name}. Review the income and save it to keep this document with the ledger entry.`)
        return
      }
      const extracted = await extractLoanDrawFromDocument(file, projectId, lotCommitments)
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
        setLotDetails((current) => {
          const next = { ...current }
          extracted.lots.forEach((entry) => {
            if (!lotKeys.includes(entry.lot)) return
            next[entry.lot] = {
              address: entry.address || '',
              loanAmount: Number(entry.loanAmount) || 0,
              lotFeeFinance: Number(entry.lotFeeFinance) || 0,
              constructionAvailable: Number(entry.constructionAvailable) || 0,
              completionPercentage: Number(entry.completionPercentage) || 0,
            }
          })
          return next
        })
        filledFields.push('lot amounts')
      }
      setUploadStatus(filledFields.length
        ? `Uploaded ${file.name} and filled in: ${filledFields.join(', ')}. Review before saving.`
        : `Uploaded ${file.name}, but Gemini couldn't read any fields from it${extracted.notes ? ` — ${extracted.notes}` : ''}. Enter the amount, date, and lot breakdown manually.`)
    } catch (uploadError) {
      setError(`The income document could not be processed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`)
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
      if (!drawDocument) {
        setError('Attach and analyze the draw or inspection document before saving this loan advance.')
        return
      }
      lotBreakdown = lotKeys.map((lot) => ({ lot, amount: Number(lotAmounts[lot]) || 0, ...(lotDetails[lot] || {}) }))
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
    const nextLotDetails = { ...emptyLotDetails }
    ;(income.lotBreakdown || []).forEach((entry) => {
      if (lotKeys.includes(entry.lot)) {
        nextLotAmounts[entry.lot] = entry.amount ? String(entry.amount) : ''
        nextLotDetails[entry.lot] = {
          address: entry.address || '',
          loanAmount: Number(entry.loanAmount) || 0,
          lotFeeFinance: Number(entry.lotFeeFinance) || 0,
          constructionAvailable: Number(entry.constructionAvailable) || 0,
          completionPercentage: Number(entry.completionPercentage) || 0,
        }
      }
    })
    setLotAmounts(nextLotAmounts)
    setLotDetails(nextLotDetails)
    setDrawDocument(income.attachments?.[0] || null)
    setError('')
  }

  const openIncomeDocument = async (attachment) => {
    if (!onOpenDocument) return
    try {
      await onOpenDocument(attachment)
    } catch (openError) {
      setError(`The supporting document could not be opened: ${openError instanceof Error ? openError.message : 'Unknown error'}`)
    }
  }

  const renderDepositActivityCard = (income, activity, { nested = false } = {}) => {
    const refundedForReceipt = activity.type === 'receipt' ? (income.activities || [])
      .filter((entry) => entry.type === 'refund' && String(entry.relatedActivityId) === String(activity.id))
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0) : 0
    const refundableBalance = Math.max(0, Number(activity.amount || 0) - refundedForReceipt)
    return <article key={activity.id} className={nested ? 'deposit-activity-nested' : ''}>
      <div className="deposit-activity-copy">
        <strong>{depositActivityLabels[activity.type] || activity.type}</strong>
        <span className="deposit-activity-meta">{activity.date}{activity.lot ? ` · ${activity.lot}` : ''}</span>
        <p>{activity.description}</p>
        {activity.type === 'receipt' && activity.bankDetail ? <div className={`deposit-bank-match ${activity.reconciliationStatus === 'probable_match' ? 'probable' : ''}`}>
          <div>
            <strong>{activity.reconciliationStatus === 'probable_match' ? 'Probable bank match' : 'Bank statement matched'}</strong>
            {activity.sourceStatement ? <span>{activity.sourceStatement}</span> : null}
          </div>
          <p>{activity.bankDetail}</p>
          {activity.matchBasis ? <small>{activity.matchBasis}</small> : null}
        </div> : null}
        {activity.type === 'receipt' && refundedForReceipt > 0 ? <span className="deposit-refund-progress">Refunded {currency.format(refundedForReceipt)} · {currency.format(refundableBalance)} left to refund</span> : null}
      </div>
      <strong className="deposit-activity-amount">{activity.type === 'cancellation' ? 'Status only' : currency.format(activity.amount)}</strong>
      <div className="deposit-activity-actions">
        {activity.attachment && onOpenDocument ? <button type="button" className="secondary-button" onClick={() => openIncomeDocument(activity.attachment)}>Preview document</button> : null}
        <button type="button" className="secondary-button" aria-label={`Edit ${activity.description}`} onClick={() => startEditDepositActivity(income, activity)}>Edit</button>
        {activity.type === 'receipt' ? <button type="button" className="secondary-button" disabled={refundableBalance <= 0} aria-label={`Add refund payment for ${activity.description}`} onClick={() => startReceiptFollowUp(income, activity, 'refund')}>{refundableBalance > 0 ? 'Add refund payment' : 'Fully refunded'}</button> : null}
        {activity.type === 'receipt' ? <button type="button" className="secondary-button" aria-label={`Cancel agreement for ${activity.description}`} onClick={() => startReceiptFollowUp(income, activity, 'cancellation')}>Cancel agreement</button> : null}
        {String(pendingActivityDeleteId) === String(activity.id) ? <>
          <button type="button" className="danger-button" aria-label={`Confirm remove ${activity.description}`} disabled={savingActivity} onClick={() => handleRemoveDepositActivity(income, activity)}>Confirm remove</button>
          <button type="button" className="secondary-button" disabled={savingActivity} onClick={() => setPendingActivityDeleteId(null)}>Keep</button>
        </> : <button type="button" className="danger-button" aria-label={`Remove ${activity.description}`} onClick={() => setPendingActivityDeleteId(activity.id)}>Remove</button>}
      </div>
    </article>
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Construction funding</p>
          <h2>Draws &amp; income</h2>
        </div>
        <div className="metric-stack">
          <span>Total income</span>
          <strong>{currency.format(totalIncome)}</strong>
        </div>
      </div>

      <section className="draw-plan" aria-labelledby="draw-plan-heading">
        <div className="draw-plan-heading">
          <div>
            <p className="eyebrow">Lender draw plan</p>
            <h3 id="draw-plan-heading">Providence advances by lot</h3>
            <p>Upload each multi-page inspection sheet as one loan draw. The app keeps the original PDF, divides the advance by lot, and connects later checks to the funding draw.</p>
          </div>
          <span className="draw-plan-step">Next: {drawPlan.draws.length ? `advance ${drawPlan.draws.length + 1}` : 'upload first advance'}</span>
        </div>
        <div className="draw-plan-metrics">
          <div><span>Construction funds</span><strong>{drawPlan.available ? currency.format(drawPlan.available) : 'Add lot commitments'}</strong></div>
          <div><span>Advanced to date</span><strong>{currency.format(drawPlan.advanced)}</strong></div>
          <div><span>Remaining to draw</span><strong>{drawPlan.available ? currency.format(Math.max(0, drawPlan.available - drawPlan.advanced)) : '—'}</strong></div>
        </div>
        <div className="draw-plan-table-wrap">
          <table className="draw-plan-table">
            <thead><tr><th>Lot / property</th><th>Construction funds</th><th>Latest completion</th><th>Advanced</th><th>Remaining</th></tr></thead>
            <tbody>{drawPlan.lots.map((lot) => (
              <tr key={lot.lot}>
                <td><strong>{lot.lot}</strong><span>{providenceLoanAccountLabel(lot.lot)}</span><span>{lot.address || 'Address not configured'}</span></td>
                <td>{lot.available ? currency.format(lot.available) : '—'}</td>
                <td>{lot.completed ? `${lot.completed}%` : '—'}</td>
                <td>{currency.format(lot.advanced)}</td>
                <td>{lot.available ? currency.format(Math.max(0, lot.available - lot.advanced)) : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <div className="section-grid income-section-grid">
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
              <option value="pre_sale_deposit">Pre-sale deposit</option>
              <option value="loan_draw">Loan draw</option>
              <option value="refund">Refund</option>
              <option value="reimbursement">Reimbursement</option>
              <option value="other">Other</option>
            </select>
          </label>
          <div className="wide-field loan-draw-fields">
              <label className="loan-draw-upload">{type === 'loan_draw' ? 'Advance document' : 'Supporting document'} {type === 'loan_draw' ? <span aria-hidden="true">*</span> : <small>(optional)</small>}
                <input aria-label={type === 'loan_draw' ? 'Upload loan draw sheet' : 'Upload income attachment'} type="file" accept="image/*,.pdf" disabled={uploadingDrawSheet} onChange={handleDrawSheetUpload} />
                <small>{type === 'loan_draw' ? 'Required. Attach the complete draw request or inspection PDF/image; it will be analyzed automatically.' : 'Attach a receipt, agreement, bank record, invoice, or other supporting PDF/image.'}</small>
              </label>
              {uploadingDrawSheet ? <span className="loading-indicator"><span className="spinner" aria-hidden="true" />{type === 'loan_draw' ? 'Uploading and analyzing the advance document…' : 'Uploading supporting document…'}</span> : null}
              {drawDocument ? <div className="loan-draw-attached-document"><span>Attached: {drawDocument.name}</span>{onOpenDocument ? <button type="button" className="secondary-button" onClick={() => openIncomeDocument(drawDocument)}>Preview attachment</button> : null}</div> : null}
              {!uploadingDrawSheet && uploadStatus ? <span role="status">{uploadStatus}</span> : null}
              {!uploadingDrawSheet && drawDocument ? (
                <p className="loan-draw-unsaved-banner" role="status">
                  ⚠ Not saved yet — review the income details{type === 'loan_draw' ? ' and lot breakdown' : ''}, then click "{editingIncomeId != null ? 'Save income changes' : 'Add income'}" at the bottom of this form.
                </p>
              ) : null}
              {type === 'loan_draw' ? (
              <div className="loan-draw-lots">
                <div className="loan-draw-lots-header">
                  <span>Lot breakdown (must total the amount above, kept for audit)</span>
                  <button type="button" className="secondary-button" onClick={splitLotsEvenly}>Split evenly</button>
                </div>
                {lotKeys.map((lot) => (
                  <label key={lot}>{lot}
                    <input aria-label={`${lot} draw amount`} type="number" min="0" step="0.01" value={lotAmounts[lot]} onChange={(event) => setLotAmount(lot, event.target.value)} />
                    {lotDetails[lot]?.address || lotDetails[lot]?.constructionAvailable ? (
                      <small>{lotDetails[lot].address || 'Property'}{lotDetails[lot].constructionAvailable ? ` · ${currency.format(lotDetails[lot].constructionAvailable)} construction funds` : ''}{lotDetails[lot].completionPercentage ? ` · ${lotDetails[lot].completionPercentage}% complete` : ''}</small>
                    ) : null}
                  </label>
                ))}
              </div>
              ) : null}
            </div>
          {error && activityIncomeId == null ? <p className="validation-error" role="alert">{error}</p> : null}
          <div className="button-row">
            <button type="submit" className="action-button" disabled={uploadingDrawSheet}>{editingIncomeId != null ? 'Save income changes' : 'Add income'}</button>
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
            const isPreSaleDeposit = income.type === 'pre_sale_deposit'
            const isExpanded = expandedIncomeId === income.id
            const depositSummary = isPreSaleDeposit ? summarizePreSaleDepositActivities(income) : null
            return <div key={income.id} className={`table-row loan-draw-row${isLoanDraw ? ' compact-loan-draw-row' : ''}`}>
              {isLoanDraw ? (
                <button
                  type="button"
                  className="loan-draw-summary-toggle"
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? 'Hide draw details' : 'View draw details'}
                  onClick={() => setExpandedIncomeId(isExpanded ? null : income.id)}
                >
                  <span className="loan-draw-chevron" aria-hidden="true">›</span>
                  <strong className="loan-draw-summary-name">{income.description}</strong>
                  <span className="loan-draw-summary-meta">{income.date} · {income.source || project?.name || 'Unknown source'} · {(income.lotBreakdown || []).length} {(income.lotBreakdown || []).length === 1 ? 'lot' : 'lots'}</span>
                  <strong className="income-row-amount">{currency.format(income.amount)}</strong>
                </button>
              ) : <div className="loan-draw-row-main">
                <div className="income-row-summary">
                  <div className="income-row-description">
                    <strong>{income.description}</strong>
                    <p>{project?.name || 'Unknown project'} • {income.source} • {income.date} • {incomeTypeLabel(income)}</p>
                    {income.derivedFromCost ? <small>Linked funding source · utilization included once in development costs</small> : null}
                  </div>
                  <strong className="income-row-amount">{currency.format(income.amount)}</strong>
                </div>
                <div className="button-row income-row-actions" aria-label={`Actions for ${income.description}`}>
                  {onOpenDocument && income.attachments?.[0] ? <button type="button" className="secondary-button" onClick={() => openIncomeDocument(income.attachments[0])}>Preview attachment</button> : null}
                  {isPreSaleDeposit ? <button type="button" className="secondary-button" onClick={() => setExpandedIncomeId(isExpanded ? null : income.id)}>{isExpanded ? 'Hide deposit ledger' : 'View deposit ledger'}</button> : null}
                  {isPreSaleDeposit ? <button type="button" className="action-button" onClick={() => startDepositActivity(income)}>Add deposit activity</button> : null}
                  {!income.derivedFromCost && !isPreSaleDeposit ? <button type="button" className="secondary-button" onClick={() => handleEdit(income)}>Edit income</button> : null}
                  {!income.derivedFromCost && !isPreSaleDeposit && pendingDeleteId === income.id ? (
                    <>
                      <button type="button" className="danger-button" onClick={() => handleDelete(income.id)}>Confirm delete</button>
                      <button type="button" className="secondary-button" onClick={() => setPendingDeleteId(null)}>Cancel</button>
                    </>
                  ) : !income.derivedFromCost && !isPreSaleDeposit ? (
                    <button type="button" className="danger-button" onClick={() => setPendingDeleteId(income.id)}>Delete income</button>
                  ) : null}
                </div>
              </div>}
              {isLoanDraw && isExpanded ? (
                <div className="loan-draw-details" aria-label={`Draw details for ${income.description}`}>
                  <div className="loan-draw-detail-metrics">
                    <div><span>Draw total</span><strong>{currency.format(income.amount)}</strong></div>
                    <div><span>Spent so far</span><strong>{currency.format(drawSpentTotals[income.id] || 0)}</strong></div>
                    <div><span>Left from this draw</span><strong>{currency.format(income.amount - (drawSpentTotals[income.id] || 0))}</strong></div>
                  </div>
                  <div className="loan-draw-lot-details">
                    {(income.lotBreakdown || []).map((entry) => (
                      <div key={entry.lot} className="loan-draw-lot-detail">
                        <div><strong>{entry.lot}</strong><strong>{currency.format(entry.amount || 0)}</strong></div>
                        {entry.address ? <p>{entry.address}</p> : null}
                        <small>
                          {[
                            entry.inspectionDate ? `Inspected ${entry.inspectionDate}` : '',
                            entry.advancePercentage != null ? `${entry.advancePercentage}% this draw` : '',
                            entry.completionPercentage != null ? `${entry.completionPercentage}% complete` : '',
                            entry.amountAdvancedToDate != null ? `${currency.format(entry.amountAdvancedToDate)} advanced to date` : '',
                          ].filter(Boolean).join(' · ')}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div className="button-row loan-draw-detail-actions" aria-label={`Actions for ${income.description}`}>
                    {onOpenDocument && income.attachments?.[0] ? <button type="button" className="secondary-button" onClick={() => openIncomeDocument(income.attachments[0])}>Preview draw sheet</button> : null}
                    {!income.derivedFromCost ? <button type="button" className="secondary-button" onClick={() => handleEdit(income)}>Edit income</button> : null}
                    {!income.derivedFromCost && pendingDeleteId === income.id ? (
                      <>
                        <button type="button" className="danger-button" onClick={() => handleDelete(income.id)}>Confirm delete</button>
                        <button type="button" className="secondary-button" onClick={() => setPendingDeleteId(null)}>Cancel</button>
                      </>
                    ) : !income.derivedFromCost ? <button type="button" className="danger-button" onClick={() => setPendingDeleteId(income.id)}>Delete income</button> : null}
                  </div>
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
              {isPreSaleDeposit && isExpanded ? <div className="deposit-ledger" aria-label={`Deposit ledger for ${income.description}`}>
                <div className="deposit-ledger-summary">
                  <div><span>Original deposit</span><strong>{currency.format(income.amount)}</strong></div>
                  <div><span>Receipts documented</span><strong>{currency.format(depositSummary.received)}</strong></div>
                  <div><span>Receipts unreconciled</span><strong>{currency.format(depositSummary.unreconciled)}</strong></div>
                  <div><span>Applied</span><strong>{currency.format(depositSummary.applied)}</strong></div>
                  <div><span>Refunded</span><strong>{currency.format(depositSummary.refunded)}</strong></div>
                  <div><span>Net adjustments</span><strong>{currency.format(depositSummary.adjustment)}</strong></div>
                  <div className={depositSummary.remaining < 0 ? 'negative' : ''}><span>Remaining balance</span><strong>{currency.format(depositSummary.remaining)}</strong></div>
                </div>
                <div className="deposit-activity-list">
                  {(income.activities || [])
                    .filter((activity) => activity.type !== 'refund' || !activity.relatedActivityId || !(income.activities || []).some((entry) => entry.type === 'receipt' && String(entry.id) === String(activity.relatedActivityId)))
                    .map((activity) => {
                      const linkedRefunds = activity.type === 'receipt' ? (income.activities || [])
                        .filter((entry) => entry.type === 'refund' && String(entry.relatedActivityId) === String(activity.id))
                        .sort((left, right) => String(left.date || '').localeCompare(String(right.date || ''))) : []
                      return <div className="deposit-activity-group" key={activity.id}>
                        {renderDepositActivityCard(income, activity)}
                        {linkedRefunds.length ? <div className="deposit-linked-refunds" aria-label={`Refund payments for ${activity.description}`}>
                          <div className="deposit-linked-refunds-heading">
                            <strong>Refund payments</strong>
                            <span>{linkedRefunds.length} payment{linkedRefunds.length === 1 ? '' : 's'} · {currency.format(linkedRefunds.reduce((sum, refund) => sum + Number(refund.amount || 0), 0))}</span>
                          </div>
                          {linkedRefunds.map((refund) => renderDepositActivityCard(income, refund, { nested: true }))}
                        </div> : null}
                      </div>
                    })}
                  {!income.activities?.length ? <p>No activity recorded yet. The full deposit balance remains available.</p> : null}
                </div>
                {String(activityIncomeId) === String(income.id) ? <form ref={activityFormRef} className="deposit-activity-form" onSubmit={(event) => handleSaveDepositActivity(income, event)}>
                  <h4>{editingActivityId ? 'Edit deposit activity' : activityType === 'refund' && relatedActivityId ? 'Refund buyer deposit' : activityType === 'cancellation' && relatedActivityId ? 'Cancel buyer agreement' : 'Add deposit activity'}</h4>
                  {activityType === 'refund' && relatedActivityId ? <p className="deposit-refund-form-note wide-field">The remaining refundable amount is prefilled. Change it only when recording another partial refund.</p> : null}
                  {error ? <p className="validation-error wide-field" role="alert">{error}</p> : null}
                  <label>Activity type
                    <select aria-label="Deposit activity type" value={activityType} onChange={(event) => setActivityType(event.target.value)}>
                      {Object.entries(depositActivityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label>Amount
                    <input aria-label="Deposit activity amount" type="number" min="0.01" step="0.01" disabled={activityType === 'cancellation'} placeholder={activityType === 'cancellation' ? 'Not applicable' : ''} value={activityType === 'cancellation' ? '' : activityAmount} onChange={(event) => setActivityAmount(event.target.value)} />
                  </label>
                  <label>Date
                    <input aria-label="Deposit activity date" type="date" value={activityDate} onChange={(event) => setActivityDate(event.target.value)} />
                  </label>
                  <label>Lot
                    <select aria-label="Deposit activity lot" value={activityLot} onChange={(event) => setActivityLot(event.target.value)}>
                      <option value="">Not assigned</option>
                      {['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4'].map((lot) => <option key={lot} value={lot}>{lot}</option>)}
                    </select>
                  </label>
                  <label className="wide-field">Details
                    <textarea aria-label="Deposit activity details" rows="2" value={activityDescription} onChange={(event) => setActivityDescription(event.target.value)} placeholder="Buyer, reason, agreement reference, check number, or application details" />
                  </label>
                  <label className="wide-field deposit-activity-document">Supporting document
                    <input aria-label="Deposit activity document" type="file" accept="image/*,.pdf" disabled={uploadingActivityDocument || analyzingActivityDocument} onChange={handleActivityDocument} />
                    <small>{uploadingActivityDocument ? 'Uploading…' : analyzingActivityDocument ? 'Analyzing attachment…' : activityDocument ? `Attached: ${activityDocument.name}` : activityType === 'cancellation' ? 'Required: signed cancellation agreement' : 'Optional refund agreement, receipt, check, or correspondence'}</small>
                    {activityDocument && onOpenDocument ? <button type="button" className="secondary-button" onClick={() => openIncomeDocument(activityDocument)}>Preview attachment</button> : null}
                    {activityAnalysisStatus ? <span className="deposit-activity-analysis-status" role="status">{activityAnalysisStatus}</span> : null}
                  </label>
                  <div className="button-row wide-field">
                    <button type="submit" className="action-button" disabled={savingActivity || uploadingActivityDocument || analyzingActivityDocument}>{savingActivity ? 'Saving activity…' : editingActivityId ? 'Save activity changes' : activityType === 'refund' && relatedActivityId ? 'Record refund' : activityType === 'cancellation' && relatedActivityId ? 'Record cancellation' : 'Save deposit activity'}</button>
                    <button type="button" className="secondary-button" disabled={savingActivity} onClick={resetActivityForm}>Cancel</button>
                  </div>
                </form> : null}
              </div> : null}
            </div>
          })}
        </div>
      </div>
    </section>
  )
}

export default IncomeSection
